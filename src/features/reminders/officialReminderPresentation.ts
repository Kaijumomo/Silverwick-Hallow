import { canonicalRoles, isCanonicalRole } from "@/data/canonical";
import type { RulesQuery } from "@/stores/rulesQuery";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import { effectIndicators, type EffectIndicatorSummary } from "@/stores/effectRegistry";
import { isEffectActive } from "@/stores/effects";
import type { EffectRecord, ReminderRecord, RoleDef, STPlayerRecord } from "@/stores/types";

export type OfficialEffectToken = {
  key: string;
  role: RoleDef;
  label: string;
  instances: EffectRecord[];
  detail: string;
  /** SV-4a: the character(s) a MAD token says the player is mad about being ("Sage"), or "" for every other token. */
  about: string;
};

// Presentation mappings only. A matching word in a notation record never
// creates an Effect. These source/type pairs have verified descriptors
// and publisher reminder labels; unrecognized sources retain semantic text.
const EFFECT_TOKENS = [
  { source: "poisoner", type: "poisoned", label: "Poisoned" },
  { source: "monk", type: "safeFromDemon", label: "Safe" },
  // Treacherous 30th: each sourced Effect is drawn with its own character's official reminder token.
  { source: "innkeeper", type: "cannotDie", label: "Safe" },
  { source: "innkeeper", type: "drunk", label: "Drunk" },
  { source: "witch", type: "witchCurse", label: "Cursed" },
  { source: "moonchild", type: "moonchildChoice", label: "Dead" },
  { source: "vigormortis", type: "poisoned", label: "Poisoned" },
  { source: "vigormortis", type: "retainsAbility", label: "Has Ability" },
  { source: "shabaloth", type: "shabalothChosen", label: "Dead" },
  { source: "shabaloth", type: "shabalothAlive", label: "Alive" },
  { source: "devilsadvocate", type: "survivesExecution", label: "Survives Execution" },
  // BM-1b: the Sailor's drunkenness, on the Sailor or on the player they chose.
  { source: "sailor", type: "drunk", label: "Drunk" },
  // SV-1b: the Sweetheart's lasting drunkenness.
  { source: "sweetheart", type: "drunk", label: "Drunk" },
  // SV-2a: the Snake Charmer's permanent poison on the old Demon.
  { source: "snakecharmer", type: "poisoned", label: "Poisoned" },
  // SV-4a: the Cerenovus's MAD. Its detail line names the character the player is mad about being.
  { source: "cerenovus", type: "mad", label: "Mad" },
  // This existing Storyteller fact deliberately has no functioning source.
  { source: "fortuneteller", type: "fortuneTellerRedHerring", label: "Red Herring" },
  // SV-4c: the Evil Twin's TWIN reminder on the other Twin. A source-free Storyteller fact (the Red Herring's pattern): it names the Evil Twin.
  { source: "eviltwin", type: "twin", label: "Twin" },
  // SV-5f: the Juggler's CORRECT token, one per correct guess (an incorrect guess, and the Done record, draw nothing).
  { source: "juggler", type: "jugglerGuess", label: "Correct" },
  // SV-5g: the Mathematician's ABNORMAL mark. Source-free like the TWIN: the app or the Storyteller places it, never a character.
  { source: "mathematician", type: "abnormal", label: "Abnormal" },
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
      (item.type === "fortuneTellerRedHerring" || item.type === "twin" || item.type === "abnormal" || item.source === effect.sourceCharacter));
    if (!mapping) { remaining.push(effect); continue; }
    if (effect.type === "jugglerGuess" && !(effect.parameters?.correct?.kind === "boolean" && effect.parameters.correct.value)) continue;
    const sourceRole = context?.query.roleOf(mapping.source);
    if (context && (!sourceRole || !isCanonicalRole(sourceRole))) { remaining.push(effect); continue; }
    const role = canonicalRoles([mapping.source])[0]!;
    // Keep the catalogue as the authority for the official wording.
    if (!role.reminders?.includes(mapping.label)) { remaining.push(effect); continue; }
    const key = `${mapping.source}:${mapping.type}`;
    const token = tokens.get(key) ?? { key, role, label: mapping.label, instances: [], detail: "", about: "" };
    token.instances.push(effect);
    tokens.set(key, token);
  }
  for (const token of tokens.values()) {
    const states = token.instances.map(effect => context ? context.query.effectApplies(context.target, effect) : null);
    const active = states.filter(state => state?.known && state.value).length;
    const uncertain = states.some(state => state && !state.known);
    const status = uncertain ? "Storyteller decision required"
      : active === token.instances.length ? "Currently affecting this player"
      : active ? `${active} of ${token.instances.length} currently affecting this player`
      : "Not currently affecting this player";
    // SV-4a: the MAD token reads "Mad about being the Sage" (the character rides on the Effect, never on the official token).
    token.about = context ? madCharacters(token.instances, context.query) : "";
    token.detail = !context ? token.label : token.about ? `${token.label} about being the ${token.about}${active === token.instances.length ? "" : `: ${status}`}` : `${token.label}: ${status}`;
  }
  return { tokens: [...tokens.values()], fallback: effectIndicators({ effects: remaining }) };
}

/** The characters the MAD Effects of one token say the player is mad about being ("Sage", "Sage or Chef"), or "". */
function madCharacters(instances: readonly EffectRecord[], query: RulesQuery): string {
  const names = instances.flatMap(effect => {
    const character = effect.type === "mad" ? effect.parameters?.character : undefined;
    const roleId = character?.kind === "role" ? character.roleIds[0] : undefined;
    const name = roleId ? query.roleOf(roleId)?.name : undefined;
    return name ? [name] : [];
  });
  return [...new Set(names)].join(" or ");
}

/** Legacy notation stays stored and editable, but the authoritative fact has
 * the single visible Red Herring token. Removing the fact exposes that inert
 * notation again; no label ever creates, moves or deletes an Effect. */
export function redHerringNotationCovered(reminder: { sourceCharacter?: string; label: string }, tokens: readonly OfficialEffectToken[]): boolean {
  return reminder.sourceCharacter === "fortuneteller" && reminder.label === "Red Herring" &&
    tokens.some(token => token.key === "fortuneteller:fortuneTellerRedHerring") ||
    // SV-4c: a hand-placed TWIN notation yields to the authoritative TWIN token the same way.
    reminder.sourceCharacter === "eviltwin" && reminder.label === "Twin" && tokens.some(token => token.key === "eviltwin:twin");
}

/** Exact publisher label/source lookup for existing inert notation. */
export function officialNotationRole(sourceCharacter: string | undefined, label: string): RoleDef | undefined {
  if (!sourceCharacter) return undefined;
  try {
    const role = canonicalRoles([sourceCharacter])[0]!;
    return role.reminders?.includes(label) || role.remindersGlobal?.includes(label) ? role : undefined;
  } catch { return undefined; }
}

/** Official notation presentation grouping only. Every source remains independently
 * addressable; this grouping never authorizes a bulk mutation. Custom notes
 * remain separate even when their visible wording resembles an official token. */
export function firstInformationReminderGroups(reminders: readonly ReminderRecord[]): ReminderRecord[][] {
  const groups = new Map<string, ReminderRecord[]>();
  for (const reminder of reminders) {
    const official = ["washerwoman", "librarian", "investigator", "virgin", "slayer", "butler"].includes(reminder.sourceCharacter ?? "")
      && !reminder.note && officialNotationRole(reminder.sourceCharacter, reminder.label);
    const key = official ? `official:${reminder.sourceCharacter}:${reminder.label}` : `instance:${reminder.id}`;
    const group = groups.get(key) ?? [];
    group.push(reminder); groups.set(key, group);
  }
  return [...groups.values()];
}
