import type { RoleDef, Script } from "@/stores/types";
import { RoleDefSchema, ScriptSchema } from "@/stores/schemas";
import { lookupOfficialRole } from "./officialRoles";

export type ParseResult =
  | { ok: true; script: Script }
  | { ok: false; error: string };

const slugify = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

type MetaEntry = { id: "_meta"; name?: unknown; author?: unknown };

const isMeta = (entry: unknown): entry is MetaEntry =>
  typeof entry === "object" &&
  entry !== null &&
  "id" in entry &&
  (entry as { id: unknown }).id === "_meta";

function normalizeRole(
  raw: Record<string, unknown>,
  index: number
): { ok: true; role: RoleDef } | { ok: false; error: string } {
  // clocktower.online uses `team` rather than `type`
  const candidate: Record<string, unknown> = { ...raw };
  // A supplied object is a custom definition, even if it reuses an official ID.
  candidate.provenance = { status: "homebrew" };
  for (const key of ["firstNight", "otherNight"]) {
    const order = candidate[key];
    if (typeof order === "number" && (!Number.isFinite(order) || order < 0)) {
      return { ok: false, error: `Character at index ${index}: ${key} must be finite and nonnegative (0 means no wake).` };
    }
  }
  if (candidate.team !== undefined && candidate.type === undefined) {
    candidate.type = candidate.team;
    delete candidate.team;
  }
  // clocktower.online ability key is sometimes `ability` or `description`
  if (
    candidate.ability === undefined &&
    typeof candidate.description === "string"
  ) {
    candidate.ability = candidate.description;
  }
  // Normalize team aliases used by some script tools
  if (candidate.type === "fabled" || candidate.type === "traveller") {
    if (candidate.type === "traveller") candidate.type = "traveler";
  }

  const result = RoleDefSchema.safeParse(candidate);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => {
        const path = i.path.length > 0 ? i.path.join(".") : "(root)";
        return `${path}: ${i.message}`;
      })
      .join("; ");
    return {
      ok: false,
      error: `Character at index ${index}: ${issues}`,
    };
  }
  return { ok: true, role: result.data as RoleDef };
}

export function parseClocktowerScript(input: unknown): ParseResult {
  if (!Array.isArray(input)) {
    return { ok: false, error: "Expected a JSON array of characters." };
  }

  let scriptName = "Custom script";
  let scriptAuthor: string | undefined;
  let metaId: string | undefined;
  const characters: RoleDef[] = [];

  for (let i = 0; i < input.length; i++) {
    const entry = input[i];

    if (isMeta(entry)) {
      if (typeof entry.name === "string" && entry.name.trim()) {
        scriptName = entry.name.trim();
      }
      if (typeof entry.author === "string" && entry.author.trim()) {
        scriptAuthor = entry.author.trim();
      }
      // Some scripts encode an explicit script id alongside _meta
      const candidateId = (entry as Record<string, unknown>).scriptId;
      if (typeof candidateId === "string" && candidateId.trim()) {
        metaId = candidateId.trim();
      }
      continue;
    }

    if (typeof entry === "string") {
      const role = lookupOfficialRole(entry);
      if (!role) {
        return {
          ok: false,
          error: `Unknown official role id: ${entry}`,
        };
      }
      characters.push(role);
      continue;
    }

    if (typeof entry === "object" && entry !== null) {
      const norm = normalizeRole(entry as Record<string, unknown>, i);
      if (!norm.ok) return { ok: false, error: norm.error };
      characters.push(norm.role);
      continue;
    }

    return {
      ok: false,
      error: `Entry at index ${i} must be a string id, character object, or _meta entry.`,
    };
  }

  if (characters.length === 0) {
    return {
      ok: false,
      error: "Script must contain at least one character.",
    };
  }

  const id =
    metaId ??
    (scriptName !== "Custom script"
      ? slugify(scriptName)
      : `custom-${Date.now()}`);

  const script: Script = {
    id,
    name: scriptName,
    characters,
    ...(scriptAuthor ? { author: scriptAuthor } : {}),
  };

  const validated = ScriptSchema.safeParse(script);
  if (!validated.success) {
    const issues = validated.error.issues
      .map((i) => {
        const path = i.path.length > 0 ? i.path.join(".") : "(root)";
        return `${path}: ${i.message}`;
      })
      .join("; ");
    return { ok: false, error: `Script validation failed: ${issues}` };
  }

  return { ok: true, script };
}
