import { z } from "zod";
import type { RoomBackend } from "./backend";
import { SnapshotValidationError } from "./snapshots";

export const sessionPath = (code: string) => `lobbies/${code}/session`;
export const outcomePath = (code: string, uid: string) => `lobbies/${code}/outcomes/${uid}`;
export const leavePath = (code: string, uid: string) => `lobbies/${code}/leaveRequests/${uid}`;
/** Self-scoped: a player's own chosen Traveler character (Phase 9 Setup
 * finalization B4). Value is a Traveler catalogue role id, never an
 * ordinary character. See applyTravelerChoice in membershipCommands.ts. */
export const travelerChoicePath = (code: string, uid: string) => `lobbies/${code}/travelerChoices/${uid}`;
export const sessionSchema = z.object({ version: z.literal(2), id: z.string().min(1), state: z.enum(["active", "ended"]) }).strict();
export const leaseSchema = z.object({ token: z.string().min(1), expiresAt: z.number().finite() }).strict();
export const guardSchema = z.object({ token: z.string().min(1), revision: z.number().int().nonnegative() }).strict();
export type SessionRecord = z.infer<typeof sessionSchema>;
export function decodeSession(raw: unknown): SessionRecord | null {
  if (raw == null) return null;
  const parsed = sessionSchema.safeParse(raw);
  if (!parsed.success) throw new SnapshotValidationError();
  return parsed.data;
}
export class LifecycleError extends Error {
  constructor(public readonly kind: "notFound" | "ended" | "rejected" | "revoked" | "conflict" | "cancelled" | "invalid", message: string) { super(message); }
}
export async function requireActiveSession(backend: RoomBackend, code: string) {
  const session = decodeSession(await backend.get(sessionPath(code)));
  if (!session) throw new LifecycleError("notFound", "This lobby does not exist or has expired. Ask for a new code.");
  if (session.state === "ended") throw new LifecycleError("ended", "This game has ended.");
  return session;
}
export function isTransient(error: unknown): boolean {
  if (error instanceof LifecycleError || error instanceof SnapshotValidationError) return false;
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === "object" && error ? String((error as { code?: unknown }).code ?? "") : "";
  return /network|offline|unavailable|disconnected|timeout/i.test(code + " " + message) && !/permission|invalid|unauthorized/i.test(code + " " + message);
}
export function lifecycleMessage(error: unknown): string {
  if (error instanceof LifecycleError || error instanceof SnapshotValidationError) return error.message;
  if (isTransient(error)) return "Connection lost. Check your network and retry.";
  if (/permission|denied/i.test(error instanceof Error ? error.message : String(error))) return "This session no longer permits the operation. Reconnect or contact the Storyteller.";
  return "The session operation could not be completed. Please retry.";
}
/** Storyteller-side failure categories for the multiplayer connection status.
 * Each maps to the action the Storyteller can actually take:
 * - "network": transient connectivity loss — retry;
 * - "authority": another Storyteller writer holds the lobby's lease;
 * - "ended": the session is ended or missing — nothing left to reconnect;
 * - "rules": Firebase refused an operation the current security rules grant
 *   the lobby owner — typically deployed rules older than this client;
 * - "expired": a live writer's fenced write was refused — its lease lapsed
 *   or was replaced; reconnecting reclaims it through the normal seam;
 * - "data": a malformed or incompatible remote record;
 * - "unknown": anything else. */
export type SessionFailureCategory = "network" | "authority" | "ended" | "rules" | "expired" | "data" | "unknown";
/** `message` is plain language for the Storyteller; `diagnostic` carries the
 * raw error and, when the production backend attributed it, the failing
 * Firebase operation and path. The diagnostic is for development/testing
 * only and is never rendered in production builds. */
export type SessionFailure = { category: SessionFailureCategory; message: string; diagnostic: string };

/** A Firebase permission denial, recognized by code or message. */
export function isPermissionDenied(error: unknown): boolean {
  if (error instanceof LifecycleError || error instanceof SnapshotValidationError) return false;
  const code = typeof error === "object" && error !== null ? String((error as { code?: unknown }).code ?? "") : "";
  const message = error instanceof Error ? error.message : String(error);
  return /permission[_ -]?denied/i.test(code) || /permission[_ -]?denied/i.test(message);
}

/** The operation and path FirebaseRoomBackend attached to a failed request
 * (see `attributeFirebaseError`), or null when none was attached. */
export function firebaseOperationOf(error: unknown): string | null {
  const value = typeof error === "object" && error !== null ? (error as { firebaseOperation?: unknown }).firebaseOperation : undefined;
  return typeof value === "string" ? value : null;
}

/** Classify a Storyteller multiplayer failure. `phase` is "startup" until the
 * runtime writer has gone live, "live" afterwards: a permission denial while
 * starting up (or on any read) means Firebase refused access the current
 * rules grant the lobby owner, while a denied write from an already-live
 * writer means its fenced lease lapsed or was replaced. `access`, when the
 * caller knows it (e.g. a subscription), overrides the backend attribution. */
export function classifyStorytellerError(error: unknown, phase: "startup" | "live", access?: "read" | "write"): SessionFailure {
  const operation = firebaseOperationOf(error);
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  const diagnostic = [raw, typeof code === "string" && code ? `code=${code}` : "", operation ? `operation=${operation}` : ""].filter(Boolean).join(" | ");
  const result = (category: SessionFailureCategory, message: string): SessionFailure => ({ category, message, diagnostic });
  if (error instanceof LifecycleError) {
    if (error.kind === "conflict") return result("authority", error.message);
    if (error.kind === "ended" || error.kind === "notFound") return result("ended", error.message);
    if (error.kind === "invalid") return result("data", error.message);
    return result("unknown", error.message);
  }
  if (error instanceof SnapshotValidationError) return result("data", error.message);
  if (isTransient(error)) return result("network", "Can't reach Firebase. Check the network connection; the lobby will reconnect when you retry.");
  if (isPermissionDenied(error)) {
    const read = access ? access === "read" : !!operation && /^(get|subscribe) /.test(operation);
    if (phase === "live" && !read) {
      return result("expired", "This device's control of the lobby lapsed (for example, after the device slept). Reconnect to reclaim it.");
    }
    return result("rules", "Firebase refused this device's Storyteller access. The Firebase project's database rules are probably out of date for this version of Silverwick; the host needs to deploy the current rules.");
  }
  return result("unknown", "The multiplayer session operation could not be completed. Please retry.");
}

export async function retryTransient<T>(operation: () => Promise<T>, signal: AbortSignal, onRetry?: (attempt: number) => void): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (signal.aborted) throw new LifecycleError("cancelled", "Session operation cancelled.");
    try { return await operation(); }
    catch (error) {
      if (!isTransient(error) || attempt >= 3 || signal.aborted) throw error;
      onRetry?.(attempt + 1);
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new LifecycleError("cancelled", "Session operation cancelled.")); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 250 * 2 ** attempt);
        signal.addEventListener("abort", abort, { once: true });
      });
    }
  }
}
