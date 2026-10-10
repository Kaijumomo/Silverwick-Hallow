import { canonicalRoles, isCanonicalRole } from "@/data/canonical";
import type { RulesQuery } from "@/stores/rulesQuery";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import { effectIndicators, type EffectIndicatorSummary } from "@/stores/effectRegistry";
import { isEffectActive } from "@/stores/effects";
import type { EffectRecord, RoleDef, STPlayerRecord } from "@/stores/types";

export type OfficialEffectToken = {
  key: string;
  role: RoleDef;
  label: string;
  instances: EffectRecord[];
  detail: string;
};

// Presentation mappings only. A matching word in a notation record never
// creates an Effect. These source/type pairs have verified descriptors
// and publisher reminder labels; unrecognized sources retain semantic text.
const EFFECT_TOKENS = [
  { source: "poisoner", type: "poisoned", label: "Poisoned" },
  { source: "monk", type: "safeFromDemon", label: "Safe" },
  // This existing Storyteller fact deliberately has no functioning source.
  { source: "fortuneteller", type: "fortuneTellerRedHerring", label: "Red Herring" },
] as const;

export function officialEffectPresentation(player: Pick<STPlayerRecord, "effects">, context?: { query: RulesQuery; target: ParticipantBinding }): {
  tokens: OfficialEffectToken[];
  fallback: EffectIndicatorSummary[];
} {
  const tokens = new Map<string, OfficialEffectToken>();
  const remaining: EffectRecord[] = [];
  for (const effect of player.effects) {
    if (!isEffectActive(effect) && !(context && effect.state === "suppressed")) continue;
    const mapping = EFFECT_TOKENS.find(item => item.type === effect.type &&
      (item.type === "fortuneTellerRedHerring" || item.source === effect.sourceCharacter));
    if (!mapping) { remaining.push(effect); continue; }
    const sourceRole = context?.query.roleOf(mapping.source);
    if (context && (!sourceRole || !isCanonicalRole(sourceRole))) { remaining.push(effect); continue; }
    const role = canonicalRoles([mapping.source])[0]!;
    // Keep the catalogue as the authority for the official wording.
    if (!role.reminders?.includes(mapping.label)) { remaining.push(effect); continue; }
    const key = `${mapping.source}:${mapping.type}`;
    const token = tokens.get(key) ?? { key, role, label: mapping.label, instances: [], detail: "" };
    token.instances.push(effect);
    tokens.set(key, token);
  }
  for (const token of tokens.values()) {
    const states = token.instances.map(effect => context ? context.query.effectApplies(context.target, effect) : null);
    const active = states.filter(state => state?.known && state.value).length;
    const uncertain = states.some(state => state && !state.known);
    token.detail = !context ? token.label : `${token.label}: ${uncertain ? "Storyteller decision required"
      : active === token.instances.length ? "Currently affecting this player"
      : active ? `${active} of ${token.instances.length} currently affecting this player`
      : "Not currently affecting this player"}`;
  }
  return { tokens: [...tokens.values()], fallback: effectIndicators({ effects: remaining }) };
}

/** Legacy notation stays stored and editable, but the authoritative fact has
 * the single visible Red Herring token. Removing the fact exposes that inert
 * notation again; no label ever creates, moves or deletes an Effect. */
export function redHerringNotationCovered(reminder: { sourceCharacter?: string; label: string }, tokens: readonly OfficialEffectToken[]): boolean {
  return reminder.sourceCharacter === "fortuneteller" && reminder.label === "Red Herring" &&
    tokens.some(token => token.key === "fortuneteller:fortuneTellerRedHerring");
}

/** Exact publisher label/source lookup for existing inert notation. */
export function officialNotationRole(sourceCharacter: string | undefined, label: string): RoleDef | undefined {
  if (!sourceCharacter) return undefined;
  try {
    const role = canonicalRoles([sourceCharacter])[0]!;
    return role.reminders?.includes(label) || role.remindersGlobal?.includes(label) ? role : undefined;
  } catch { return undefined; }
}
