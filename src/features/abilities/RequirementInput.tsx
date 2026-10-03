import { useId, useState } from "react";
import { resolvedCharacters } from "@/data/roleRegistry";
import type { AbilityInputRequirement, AbilityInputValue, InputConstraint } from "@/abilities/semantics";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { Alignment, Script, STPlayerRecord, StorytellerLobbyRecord } from "@/stores/types";
import { bindingOf, ORIGIN_LABEL, seatedParticipants, type ValueOrigin } from "./abilityUi";

/**
 * Phase 10F (SOL-10F-L2): renders ONE AbilityInputRequirement faithfully --
 * its own kind, cardinality (`count`, default 1) and constraints -- whether it
 * is a declared ability input or a judgment the coordinator asked for. It emits
 * exactly the typed AbilityInputValue the semantics contract declares, or
 * `undefined` while the answer is incomplete (never a coerced default: an
 * untouched number is not 0, an untouched yes/no is not "no").
 *
 * Option filtering is a convenience; the coordinator's validation of every
 * constraint stays authoritative.
 */

export function OriginTag({ origin }: { origin: ValueOrigin }) {
  return <span className={`origin-tag origin-${origin}`}>{ORIGIN_LABEL[origin]}</span>;
}

const CONSTRAINT_TEXT: Record<InputConstraint, string> = {
  notSelf: "not themself",
  alive: "living players only",
  dead: "dead players only",
  distinct: "all different",
};

/** Whether `player` may be offered for `requirement` (UI filter only). */
export function participantAllowed(player: STPlayerRecord, requirement: Pick<AbilityInputRequirement, "constraints">, actor: ParticipantBinding | null): boolean {
  const constraints = requirement.constraints ?? [];
  if (constraints.includes("notSelf") && actor && player.participantId === actor.participantId) return false;
  if (constraints.includes("alive") && !player.alive) return false;
  if (constraints.includes("dead") && player.alive) return false;
  return true;
}

type Props = {
  requirement: AbilityInputRequirement;
  game: StorytellerLobbyRecord;
  script: Script;
  actor: ParticipantBinding | null;
  /** Called with the complete typed value, or undefined while incomplete. */
  onChange: (value: AbilityInputValue | undefined) => void;
  /** Optional initial answer (e.g. a choice made inline before escalating). */
  initial?: AbilityInputValue;
};

export function RequirementInput({ requirement, game, script, actor, onChange, initial }: Props) {
  const count = Math.max(1, requirement.count ?? 1);
  const groupId = useId();
  const constraints = requirement.constraints ?? [];
  const label = requirement.label;

  // Draft slots (strings) for the multi-slot kinds and the raw number text.
  const initialSlots = initial?.kind === "participant" ? initial.participants.map((b) => b.playerId)
    : initial?.kind === "character" ? initial.roleIds : [];
  const [slots, setSlots] = useState<string[]>(() => Array.from({ length: count }, (_, i) => initialSlots[i] ?? ""));
  const [numberText, setNumberText] = useState(initial?.kind === "number" ? String(initial.value) : "");
  // Slice 7: an explicit "nobody" answer for an allowNone participant choice.
  const [nobody, setNobody] = useState(initial?.kind === "participant" && initial.participants.length === 0 && !!requirement.allowNone);

  const header = (
    <span className="ability-field-label">
      {label} <OriginTag origin={requirement.source} />
      {requirement.kind === "participant" && (count > 1 || constraints.length > 0) && (
        <span className="ability-field-hint">
          {count > 1 ? ` — choose ${count}` : ""}{constraints.length ? ` (${constraints.map((c) => CONSTRAINT_TEXT[c]).join(", ")})` : ""}
        </span>
      )}
      {requirement.kind === "character" && count > 1 && <span className="ability-field-hint"> — choose {count}</span>}
    </span>
  );

  const updateSlots = (index: number, value: string, toValue: (complete: string[]) => AbilityInputValue | undefined) => {
    const next = slots.map((slot, i) => (i === index ? value : slot));
    setSlots(next);
    if (nobody) return;
    onChange(next.every(Boolean) ? toValue(next) : undefined);
  };

  switch (requirement.kind) {
    case "participant": {
      const candidates = seatedParticipants(game).filter((player) => participantAllowed(player, requirement, actor));
      const toValue = (ids: string[]): AbilityInputValue | undefined => {
        if (constraints.includes("distinct") && new Set(ids).size !== ids.length) return undefined;
        const bindings = ids.map((id) => game.players[id]).filter((p): p is STPlayerRecord => !!p && !p.isEmpty && !!p.participantId).map(bindingOf);
        return bindings.length === ids.length ? { kind: "participant", participants: bindings } : undefined;
      };
      const duplicate = constraints.includes("distinct") && slots.filter(Boolean).length !== new Set(slots.filter(Boolean)).size;
      return (
        <fieldset className="ability-field" data-requirement={requirement.id}>
          <legend>{header}</legend>
          {requirement.allowNone && (
            <label className="ability-choice">
              <input type="checkbox" checked={nobody} onChange={(e) => {
                setNobody(e.target.checked);
                onChange(e.target.checked ? { kind: "participant", participants: [] } : (slots.every(Boolean) ? toValue(slots) : undefined));
              }} />
              Nobody
            </label>
          )}
          {slots.map((slot, index) => (
            <select key={index} disabled={nobody} aria-label={count > 1 ? `${label} ${index + 1}` : label} value={slot}
              onChange={(e) => updateSlots(index, e.target.value, toValue)}>
              <option value="">Choose a player…</option>
              {candidates.map((p) => (
                <option key={p.id} value={p.id} disabled={constraints.includes("distinct") && slots.some((s, i) => i !== index && s === p.id)}>
                  {p.name || `Seat ${p.seat + 1}`} · seat {p.seat + 1}
                </option>
              ))}
            </select>
          ))}
          {duplicate && <p className="behavior-help" role="alert">Choose different players.</p>}
        </fieldset>
      );
    }
    case "character": {
      const characters = resolvedCharacters(script);
      const toValue = (ids: string[]): AbilityInputValue => ({ kind: "character", roleIds: ids });
      return (
        <fieldset className="ability-field" data-requirement={requirement.id}>
          <legend>{header}</legend>
          {slots.map((slot, index) => (
            <select key={index} aria-label={count > 1 ? `${label} ${index + 1}` : label} value={slot}
              onChange={(e) => updateSlots(index, e.target.value, toValue)}>
              <option value="">Choose a character…</option>
              {characters.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
          ))}
        </fieldset>
      );
    }
    case "alignment":
    case "boolean": {
      const choices: { value: string; text: string }[] = requirement.kind === "alignment"
        ? [{ value: "good", text: "Good" }, { value: "evil", text: "Evil" }]
        : [{ value: "true", text: "Yes" }, { value: "false", text: "No" }];
      const selected = initial?.kind === "alignment" ? initial.alignment : initial?.kind === "boolean" ? String(initial.value) : undefined;
      return (
        <fieldset className="ability-field" data-requirement={requirement.id} role="radiogroup" aria-label={label}>
          <legend>{header}</legend>
          {choices.map((choice) => (
            <label key={choice.value} className="ability-choice">
              <input type="radio" name={groupId} value={choice.value} defaultChecked={selected === choice.value}
                onChange={() => onChange(requirement.kind === "alignment"
                  ? { kind: "alignment", alignment: choice.value as Alignment }
                  : { kind: "boolean", value: choice.value === "true" })} />
              {choice.text}
            </label>
          ))}
        </fieldset>
      );
    }
    case "number":
      return (
        <label className="ability-field" data-requirement={requirement.id}>
          {header}
          <input type="number" aria-label={label} value={numberText} onChange={(e) => {
            setNumberText(e.target.value);
            const trimmed = e.target.value.trim();
            const parsed = Number(trimmed);
            onChange(trimmed !== "" && Number.isFinite(parsed) ? { kind: "number", value: parsed } : undefined);
          }} />
        </label>
      );
    case "text":
      return (
        <label className="ability-field" data-requirement={requirement.id}>
          {header}
          <input type="text" aria-label={label} defaultValue={initial?.kind === "text" ? initial.value : ""}
            onChange={(e) => onChange(e.target.value === "" ? undefined : { kind: "text", value: e.target.value })} />
        </label>
      );
  }
}
