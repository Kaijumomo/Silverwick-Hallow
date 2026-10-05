import { fireEvent, within } from "@testing-library/react";

/**
 * Phase 10H test helpers: gameplay choices are made on the Table / Roster
 * (ParticipantPicker) or the searchable RolePicker -- never a <select>
 * (10H-AC-014). These drive the REAL interaction a Storyteller performs:
 * open the slot's Roster pick-strip and press the participant, or open the
 * role picker and press the character. Values are addressed by the same ids
 * the former selects used (PlayerId / RoleId), so the assertions about what
 * was chosen are unchanged.
 */
const exact = (label: string) => (text: string) => text === label;

/** The participant slot named `label` inside `container`. */
export function participantSlot(label: string, container: HTMLElement = document.body): HTMLElement {
  const slots = Array.from(container.querySelectorAll<HTMLElement>("[data-pick-slot]")).filter((el) => el.dataset.pickSlot === label);
  if (slots.length !== 1) throw new Error(`Expected one participant slot "${label}", found ${slots.length}`);
  return slots[0]!;
}

/** The PlayerId currently chosen in the slot ("" when none, "stale"). */
export function chosenParticipant(label: string, container: HTMLElement = document.body): string {
  return participantSlot(label, container).dataset.chosenPlayer ?? "";
}

/** Chooses `playerId` for the slot `label` from its Roster pick-strip
 * ("" clears the slot). */
export function chooseParticipant(label: string, playerId: string, container: HTMLElement = document.body) {
  const slot = participantSlot(label, container);
  if (playerId === "") {
    fireEvent.click(within(slot).getByRole("button", { name: `Clear ${label}` }));
    return;
  }
  let option = slot.querySelector<HTMLButtonElement>(`[data-player-id="${CSS.escape(playerId)}"]`);
  if (!option) {
    fireEvent.click(within(slot).getByRole("button", { name: `Change ${label} from the Roster` }));
    option = participantSlot(label, container).querySelector<HTMLButtonElement>(`[data-player-id="${CSS.escape(playerId)}"]`);
  }
  if (!option) throw new Error(`Player ${playerId} is not offered for "${label}"`);
  fireEvent.click(option);
}

/** The role picker named `label` inside `container`. */
export function rolePickerField(label: string, container: HTMLElement = document.body): HTMLElement {
  const fields = Array.from(container.querySelectorAll<HTMLElement>("[data-role-picker]")).filter((el) => el.dataset.rolePicker === label);
  if (fields.length !== 1) throw new Error(`Expected one role picker "${label}", found ${fields.length}`);
  return fields[0]!;
}

export function chosenRole(label: string, container: HTMLElement = document.body): string {
  return rolePickerField(label, container).dataset.chosenRole ?? "";
}

/** Opens the role picker `label` and chooses `roleId`. */
export function chooseRole(label: string, roleId: string, container: HTMLElement = document.body) {
  const field = rolePickerField(label, container);
  let card = field.querySelector<HTMLButtonElement>(`[data-role-id="${CSS.escape(roleId)}"]`);
  if (!card) {
    fireEvent.click(field.querySelector<HTMLButtonElement>(".role-picker-trigger")!);
    card = rolePickerField(label, container).querySelector<HTMLButtonElement>(`[data-role-id="${CSS.escape(roleId)}"]`);
  }
  if (!card) throw new Error(`Character ${roleId} is not offered for "${label}"`);
  fireEvent.click(card);
}

/** Opens the role picker `label` and presses the character card whose
 * accessible name is `name` (e.g. "Chef townsfolk") -- the card the former
 * always-rendered role grid offered under the same name. */
export function pickRoleNamed(label: string, name: string, container: HTMLElement = document.body) {
  let field = rolePickerField(label, container);
  if (!field.querySelector(".role-picker-panel")) {
    fireEvent.click(field.querySelector<HTMLButtonElement>(".role-picker-trigger")!);
    field = rolePickerField(label, container);
  }
  fireEvent.click(within(field.querySelector<HTMLElement>(".role-picker-panel")!).getByRole("button", { name }));
}

/** Presses the option `optionLabel` of the Segmented choice `groupLabel`. */
export function chooseSegment(groupLabel: string, optionLabel: string, container: HTMLElement = document.body) {
  const group = within(container).getByRole("radiogroup", { name: exact(groupLabel) as never });
  fireEvent.click(within(group).getByRole("radio", { name: optionLabel }));
}

/** The Segmented choice `groupLabel` inside `container`. */
export function segmentGroup(groupLabel: string, container: HTMLElement = document.body): HTMLElement {
  return within(container).getByRole("radiogroup", { name: exact(groupLabel) as never });
}

/** The value (not the label) currently chosen in Segmented `groupLabel`. */
export function segmentValue(groupLabel: string, container: HTMLElement = document.body): string | null {
  const checked = segmentGroup(groupLabel, container).querySelector<HTMLElement>('[role="radio"][aria-checked="true"]');
  return checked?.dataset.value ?? null;
}

/** Chooses the option whose VALUE is `value` in Segmented `groupLabel` --
 * the same value the former <select> option carried. */
export function chooseSegmentValue(groupLabel: string, value: string, container: HTMLElement = document.body) {
  const option = segmentGroup(groupLabel, container).querySelector<HTMLButtonElement>(`[role="radio"][data-value="${CSS.escape(value)}"]`);
  if (!option) throw new Error(`Option ${value} is not offered by "${groupLabel}"`);
  fireEvent.click(option);
}

/** One entry point for a former <select>: a participant slot or a role picker
 * named `label` -- chooses `value` (a PlayerId or RoleId; "" clears a slot). */
export function choose(label: string, value: string, container: HTMLElement = document.body) {
  const isSlot = Array.from(container.querySelectorAll<HTMLElement>("[data-pick-slot]")).some((el) => el.dataset.pickSlot === label);
  if (isSlot) chooseParticipant(label, value, container);
  else chooseRole(label, value, container);
}

/** What a participant slot or role picker named `label` currently holds. */
export function chosen(label: string, container: HTMLElement = document.body): string {
  const isSlot = Array.from(container.querySelectorAll<HTMLElement>("[data-pick-slot]")).some((el) => el.dataset.pickSlot === label);
  return isSlot ? chosenParticipant(label, container) : chosenRole(label, container);
}

/** Whether a choice control named `label` is present in `container`. */
export function hasChoice(label: string, container: HTMLElement = document.body): boolean {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-pick-slot],[data-role-picker]"))
    .some((el) => el.dataset.pickSlot === label || el.dataset.rolePicker === label);
}

/** The options a participant slot or role picker offers, in order, opening
 * its Roster strip / role list if needed: `{ value, disabled }` per option. */
export function offered(label: string, container: HTMLElement = document.body): { value: string; disabled: boolean }[] {
  const isSlot = Array.from(container.querySelectorAll<HTMLElement>("[data-pick-slot]")).some((el) => el.dataset.pickSlot === label);
  if (isSlot) {
    let slot = participantSlot(label, container);
    if (!slot.querySelector(".pick-strip")) {
      fireEvent.click(within(slot).getByRole("button", { name: `Change ${label} from the Roster` }));
      slot = participantSlot(label, container);
    }
    return Array.from(slot.querySelectorAll<HTMLButtonElement>("[data-player-id]")).map((b) => ({ value: b.dataset.playerId!, disabled: b.disabled }));
  }
  let field = rolePickerField(label, container);
  if (!field.querySelector(".role-picker-panel")) {
    fireEvent.click(field.querySelector<HTMLButtonElement>(".role-picker-trigger")!);
    field = rolePickerField(label, container);
  }
  return Array.from(field.querySelectorAll<HTMLButtonElement>("[data-role-id]")).map((b) => ({ value: b.dataset.roleId!, disabled: b.disabled }));
}
