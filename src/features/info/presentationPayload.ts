/**
 * What a player view shows when the Storyteller hands the device over. The Grimoire's Show (grimoire-v6/info,
 * showStore) draws it; the old modal that also drew it was retired (streamlining review F-08).
 */

export type PresentationCharacter = {
  id: string;
  name: string;
  type: string;
  ability?: string;
  icon: string;
};

/** Deliberately excludes game state, ownership badges and delivery operations. */
export type PresentationPayload =
  | { kind: "character"; heading: string; character: PresentationCharacter }
  | { kind: "message"; heading: string; tone?: "good" | "evil"; symbol: "vote" | "nominate" | "good" | "evil" }
  | { kind: "setup"; groups: Array<{ heading: string; names?: string[]; characters?: PresentationCharacter[] }> };

