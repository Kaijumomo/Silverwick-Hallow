import { isEffectActive } from "./effects";
import type { EffectRecord, STPlayerRecord } from "./types";

/**
 * Phase 10B: the centralized Effect definition / presentation registry.
 *
 * PRESENTATION ONLY. It says how a semantic Effect type is named and drawn;
 * it never says what the Effect does. It is not a closed legal enum: any
 * other `type` (future, custom, homebrew) stays valid Storyteller
 * bookkeeping and is drawn as its own "custom" indicator, with no invented
 * rules behavior anywhere.
 *
 * Several semantic Effects may share one visual indicator: "Protected" is a
 * visual family, not a mechanic -- `protected` (the generic manual marker),
 * `safeFromDemon` and `cannotDie` all show the Protected indicator while
 * remaining distinct, independently evaluated Effects underneath.
 */

export type EffectVisualFamily =
  | "impairment"
  | "protection"
  | "abilityState"
  | "obligation"
  | "conditional"
  | "registration"
  | "custom";

/** One glanceable Grimoire indicator. Effect instances sharing a `key`
 * aggregate into one indicator (with a multiplicity count). */
export type EffectIndicatorDefinition = {
  key: string;
  label: string;
  family: EffectVisualFamily;
  /** Decorative artwork; the indicator is always also labelled in text. */
  icon?: string;
};

export type EffectDefinition = {
  /** The semantic Effect type stored on EffectRecord.type. */
  type: string;
  /** Display name of this semantic Effect. */
  label: string;
  /** The indicator it is drawn with. */
  indicator: string;
  description?: string;
};

const INDICATORS: Record<string, EffectIndicatorDefinition> = {
  drunk: { key: "drunk", label: "Drunk", family: "impairment", icon: "/status/drunk.png" },
  poisoned: { key: "poisoned", label: "Poisoned", family: "impairment", icon: "/status/poisoned.png" },
  protected: { key: "protected", label: "Protected", family: "protection", icon: "/status/protected.png" },
  soberHealthy: { key: "soberHealthy", label: "Sober & healthy", family: "abilityState" },
  abilityLost: { key: "abilityLost", label: "No ability", family: "abilityState" },
  mad: { key: "mad", label: "Mad", family: "obligation" },
  marked: { key: "marked", label: "Marked", family: "conditional" },
  registration: { key: "registration", label: "Registers falsely", family: "registration" },
};

/** Known semantic Effect types. Adding one here never changes mechanics. */
const DEFINITIONS: Record<string, EffectDefinition> = {
  drunk: { type: "drunk", label: "Drunk", indicator: "drunk", description: "Has no ability but believes they do." },
  poisoned: { type: "poisoned", label: "Poisoned", indicator: "poisoned", description: "Has no ability but believes they do." },
  protected: { type: "protected", label: "Protected", indicator: "protected",
    description: "Generic protection marker. Storyteller bookkeeping only -- Silverwick draws no rules conclusion from it." },
  safeFromDemon: { type: "safeFromDemon", label: "Safe from the Demon", indicator: "protected" },
  cannotDie: { type: "cannotDie", label: "Cannot die", indicator: "protected" },
  soberHealthy: { type: "soberHealthy", label: "Sober & healthy", indicator: "soberHealthy" },
  abilityLost: { type: "abilityLost", label: "No ability", indicator: "abilityLost" },
  mad: { type: "mad", label: "Mad", indicator: "mad" },
  marked: { type: "marked", label: "Marked", indicator: "marked" },
  registersFalsely: { type: "registersFalsely", label: "Registers falsely", indicator: "registration" },
};

/** The order known indicators appear in; unknown ones follow. */
const INDICATOR_ORDER = Object.keys(INDICATORS);

/** The types the Storyteller quick controls manage (one tap each). */
export const QUICK_EFFECT_TYPES = ["drunk", "poisoned", "protected"] as const;

/** Known types offered by the advanced "Add effect" workflow (any other
 * type can still be typed in as a custom Effect). */
export const KNOWN_EFFECT_TYPES: readonly EffectDefinition[] = Object.values(DEFINITIONS);

const own = <T,>(map: Record<string, T>, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;

/** "my-curse_mark" -> "My curse mark"; used for unknown/custom types. */
export function humanizeEffectType(type: string): string {
  const words = type.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-:]+/g, " ").trim().toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : "Effect";
}

/** The definition of a semantic type; an unknown type gets a synthesized
 * "custom" definition (its own indicator), never an error. */
export function effectDefinitionOf(type: string): EffectDefinition {
  return own(DEFINITIONS, type) ?? { type, label: humanizeEffectType(type), indicator: `custom:${type}` };
}

export function effectIndicatorOf(type: string): EffectIndicatorDefinition {
  const definition = effectDefinitionOf(type);
  return own(INDICATORS, definition.indicator)
    ?? { key: definition.indicator, label: definition.label, family: "custom" };
}

export type EffectIndicatorSummary = {
  indicator: EffectIndicatorDefinition;
  /** Currently applying (active) instances. */
  activeCount: number;
  /** Stored but suppressed instances. */
  suppressedCount: number;
  /** Every stored instance behind this indicator, in stored order. */
  instances: EffectRecord[];
};

function groupBy(effects: readonly EffectRecord[]): EffectIndicatorSummary[] {
  const groups = new Map<string, EffectIndicatorSummary>();
  for (const effect of effects) {
    const indicator = effectIndicatorOf(effect.type);
    let group = groups.get(indicator.key);
    if (!group) {
      group = { indicator, activeCount: 0, suppressedCount: 0, instances: [] };
      groups.set(indicator.key, group);
    }
    group.instances.push(effect);
    if (isEffectActive(effect)) group.activeCount++;
    else group.suppressedCount++;
  }
  const rank = (key: string) => {
    const index = INDICATOR_ORDER.indexOf(key);
    return index < 0 ? INDICATOR_ORDER.length : index;
  };
  // Stable: known indicators in registry order, unknown by first appearance.
  return [...groups.values()].sort((a, b) => rank(a.indicator.key) - rank(b.indicator.key));
}

/** Every stored instance grouped by indicator (Player Drawer: "Poisoned ×2",
 * suppressed ones included and counted separately). */
export function effectGroups(player: Pick<STPlayerRecord, "effects">): EffectIndicatorSummary[] {
  return groupBy(player.effects);
}

/** The Grimoire's glanceable indicators: only EFFECTIVE (active) Effects,
 * one indicator per visual key -- never one badge per EffectRecord. */
export function effectIndicators(player: Pick<STPlayerRecord, "effects">): EffectIndicatorSummary[] {
  return groupBy(player.effects.filter(isEffectActive));
}

/** "Poisoned" / "Poisoned, 2 active effects" -- state and multiplicity in
 * words, never color, icon shape or hover alone. */
export function effectIndicatorLabel(summary: Pick<EffectIndicatorSummary, "indicator" | "activeCount" | "suppressedCount">): string {
  const parts = [summary.indicator.label];
  if (summary.activeCount > 1) parts.push(`${summary.activeCount} active effects`);
  if (summary.suppressedCount > 0) parts.push(`${summary.suppressedCount} suppressed`);
  return parts.join(", ");
}

/** The Grimoire token's accessible Effect summary, e.g. "Poisoned, 2 active
 * effects; Drunk" -- or "" when nothing applies. */
export function effectAccessibleSummary(player: Pick<STPlayerRecord, "effects">): string {
  return effectIndicators(player).map(effectIndicatorLabel).join("; ");
}
