import { z } from "zod";
import type { RoomBackend } from "./backend";
import { SnapshotValidationError } from "./snapshots";

export const sessionPath = (code: string) => `lobbies/${code}/session`;
export const outcomePath = (code: string, uid: string) => `lobbies/${code}/outcomes/${uid}`;
export const leavePath = (code: string, uid: string) => `lobbies/${code}/leaveRequests/${uid}`;
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
