import { z } from "zod";
import { PlayerSelfRecordSchema, PublicLobbyRecordSchema } from "@/stores/schemas";
import type { PlayerSelfRecord, PublicLobbyRecord } from "@/stores/types";
import type { RoomBackend, Unsubscribe } from "./backend";

export type SnapshotIssue = { path: (string | number)[]; code: string };
export type Snapshot<T> =
  | { status: "ready"; data: T }
  | { status: "waiting" }
  | { status: "invalid"; issues: SnapshotIssue[] };
export type PublicSnapshot = Snapshot<PublicLobbyRecord> | { status: "ended" };
export const WAITING = { status: "waiting" } as const;
export const DATA_ERROR_MESSAGE = "We couldn't read the latest game data. Waiting for an update from the Storyteller.";
export const CONNECTION_ERROR_MESSAGE = "We couldn't receive game data. Check your connection and try again.";
const isDevRuntime = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;

// Omission/null means an absent RTDB node, not a type-coercion opportunity.
const emptyNode = <T extends z.ZodTypeAny>(schema: T, fallback: unknown) =>
  z.preprocess((value) => value == null ? fallback : value, schema);
const optionalNode = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => value === null ? undefined : value, schema.optional());
const id = z.string().min(1).refine((value) => value.trim().length > 0);
const list = z.array(id);
const publicPlayer = PublicLobbyRecordSchema.shape.players.valueSchema.extend({
  id, name: id,
  publicDisplayRole: optionalNode(id),
});
const publicShape = PublicLobbyRecordSchema.extend({
  code: id,
  scriptId: id,
  players: emptyNode(z.record(id, publicPlayer), {}),
  seatOrder: emptyNode(list, []),
  fabled: emptyNode(list, []),
  lorics: emptyNode(list, []),
  winner: optionalNode(PublicLobbyRecordSchema.shape.winner.unwrap()),
  status: optionalNode(z.literal("ended")),
});
const selfShape = PlayerSelfRecordSchema.extend({
  shownRole: id,
  bluffs: optionalNode(list),
  minions: optionalNode(PlayerSelfRecordSchema.shape.minions.unwrap()),
  extraText: optionalNode(z.string()),
});
const request = z.string().min(1).max(20).refine((value) =>
  value.trim().length > 0 && !value.startsWith(" ") && !value.endsWith(" ") && !/[\r\n\t]/.test(value));
const presence = z.record(id, z.object({
  online: z.boolean(), lastSeen: z.number().int().nonnegative(),
}));
export type PresenceMap = z.infer<typeof presence>;

function invalid(error: z.ZodError): { status: "invalid"; issues: SnapshotIssue[] } {
  // Keep field locations/codes for developers, never raw values or Zod messages
  // (enum errors may embed private input in their text).
  return { status: "invalid", issues: error.issues.map(({ path, code }) => ({ path, code })) };
}
function invalidField(field: string, code: string): { status: "invalid"; issues: SnapshotIssue[] } {
  return { status: "invalid", issues: [{ path: [field], code }] };
}
function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, raw: unknown): Snapshot<T> {
  const result = schema.safeParse(raw);
  return result.success ? { status: "ready", data: result.data } : invalid(result.error);
}

export function decodePublicSnapshot(raw: unknown, expectedCode?: string): PublicSnapshot {
  if (raw == null) return WAITING;
  // Validate present fields even in a partial record. Missing root scalars are
  // incomplete data; wrong types/values and broken player records are invalid.
  const partial = publicShape.partial().safeParse(raw);
  if (!partial.success) return invalid(partial.error);
  if (partial.data.code !== undefined && expectedCode !== undefined && partial.data.code !== expectedCode) {
    return invalidField("code", "lobby_mismatch");
  }
  const complete = publicShape.safeParse(raw);
  if (!complete.success) {
    // endLobby may publish only this validated signal before other fields exist.
    if (partial.data.status === "ended") return { status: "ended" };
    return WAITING;
  }
  const data = complete.data;
  for (const [key, player] of Object.entries(data.players)) {
    if (key !== player.id) return invalidField("players", "id_mismatch");
  }
  if (new Set(data.seatOrder).size !== data.seatOrder.length) return invalidField("seatOrder", "duplicate_id");
  // References can arrive before their records; don't expose a partial model.
  if (data.seatOrder.some((key) => !Object.hasOwn(data.players, key))) return WAITING;
  return { status: "ready", data };
}

export function decodeSelfSnapshot(raw: unknown): Snapshot<PlayerSelfRecord> {
  if (raw == null) return WAITING;
  const partial = selfShape.partial().safeParse(raw);
  if (!partial.success) return invalid(partial.error);
  if (partial.data.shownRole === undefined || partial.data.shownAlignment === undefined) return WAITING;
  return parse(selfShape, raw);
}
export const decodeRosterEntry = (raw: unknown): Snapshot<string> => raw == null ? WAITING : parse(id, raw);
export const decodeJoinRequest = (raw: unknown): Snapshot<string> => raw == null ? WAITING : parse(request, raw);
export const decodeRoster = (raw: unknown): Snapshot<Record<string, string>> => parse(emptyNode(z.record(id, id), {}), raw);
export const decodeJoinRequests = (raw: unknown): Snapshot<Record<string, string>> => parse(emptyNode(z.record(id, request), {}), raw);
export const decodePresence = (raw: unknown): Snapshot<PresenceMap> => parse(emptyNode(presence, {}), raw);
export const decodeLobbyStatus = (raw: unknown): Snapshot<"active" | "ended"> =>
  raw == null ? { status: "ready", data: "active" } : parse(z.enum(["active", "ended"]), raw);

export function reportSnapshotProblem(scope: string, issues: SnapshotIssue[]) {
  if (isDevRuntime) console.warn("[remote snapshot]", scope, issues);
}
export class SnapshotValidationError extends Error {
  constructor() { super(DATA_ERROR_MESSAGE); }
}

/** One subscription boundary: decode every event; keep listening after bad data. */
export function subscribeDecoded<T extends { status: string }>(
  backend: RoomBackend, path: string, decode: (raw: unknown) => T, receive: (value: T) => void,
  onReadError?: () => void,
): Unsubscribe {
  return backend.subscribe(path, (raw) => {
    const decoded = decode(raw);
    if ("issues" in decoded && Array.isArray(decoded.issues)) {
      // Generic transport diagnostics are supplied by concrete decoders below.
      if (isDevRuntime) console.warn("[remote snapshot]", path, decoded.issues);
    }
    receive(decoded);
  }, () => {
    reportSnapshotProblem(path, [{ path: [], code: "read_failed" }]);
    onReadError?.();
  });
}
