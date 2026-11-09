import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FirstInformationPreparation, useFirstInformationPreparation } from "./FirstInformationPreparation";
import { pickSeatIfPicking, useTargetPicker } from "@/features/abilities/abilityUi";
import { captureCharacterActionContext, useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { bind, impair, patchPlayer, proofGame, proofRegistry, proofScript, reseat } from "@/test/proofFixtures";
import { preparedInformationContext, type PrepareInformationRequest } from "@/stores/preparedInformation";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "@/stores/projections";
import type { StorytellerLobbyRecord } from "@/stores/types";

const game = () => store.getState().game!;
const setup = (character: "librarian" | "investigator") => {
  const g = proofGame([character, "recluse", "chef", "imp", "poisoner"], "night", 1, { phase: "setup", day: 0 });
  for (const player of Object.values(g.players)) player.packetEpoch = `epoch-${player.id}`;
  store.setState({ game: g, lobby: null, undoStack: [], terminalClose: null, customScripts: { [proofScript.id]: proofScript } });
  return g;
};
function Setup() { const g = store(state => state.game)!; const selection = useFirstInformationPreparation(g, proofScript);
  return <><FirstInformationPreparation selection={selection} />{selection.dialog}{selection.error && <p role="alert">{selection.error}</p>}</>; }
const tap = (id: string) => act(() => { pickSeatIfPicking(game(), id); });
const request = (character: "librarian" | "investigator", shownCharacter = character === "librarian" ? "recluse" : "poisoner"): PrepareInformationRequest => ({
  character, source: bind(game(), "p0"), expected: preparedInformationContext(game(), proofScript),
  clue: { kind: "pair", candidates: [bind(game(), "p1"), bind(game(), "p2")], qualifyingParticipantId: game().players.p1!.participantId!, shownCharacter },
});
const prepare = (character: "librarian" | "investigator", shown?: string) => store.getState().prepareInformation(request(character, shown), captureCharacterActionContext());
const deliver = () => store.getState().deliverPreparedInformation({ preparationId: game().preparedInformation[0]!.id,
  source: bind(game(), "p0"), expected: preparedInformationContext(game(), proofScript) }, captureCharacterActionContext());
beforeEach(() => { localStorage.clear(); usePrivacyStore.getState().reset(); useTargetPicker.getState().cancel(); useSessionRuntime.setState({ backend: null, status: "failed" }); });
afterEach(() => { cleanup(); useTargetPicker.getState().cancel(); vi.restoreAllMocks(); });

it.each([["librarian", "Librarian", "Recluse"], ["investigator", "Investigator", "Poisoner"]] as const)(
  "Post-R3 %s prepares the explicit Recluse clue through ordinary character selection and board targets", (character, name, shown) => {
    const original = setup(character); render(<Setup />);
    fireEvent.click(screen.getByRole("button", { name: `Prepare ${name}` }));
    fireEvent.click(screen.getByRole("button", { name: shown }));
    tap("p1"); expect(game()).toBe(original); tap("p2");
    expect(screen.queryByRole("alert")).toBeNull(); expect(game().preparedInformation).toHaveLength(1);
    expect(game().informationDeliveries).toEqual([]); expect(store.getState().undoStack).toHaveLength(1);
    expect(game().players.p1).toMatchObject({ actualRole: "recluse", actualAlignment: "good", shownRole: "recluse" });
    expect(game().players.p1!.reminders).toEqual([expect.objectContaining({ label: character === "librarian" ? "Outsider" : "Minion", sourceCharacter: character })]);
  });

it.each(["librarian", "investigator"] as const)("Post-R3 %s prepared choice survives schema-v28 recovery and delivers once, privately, with Undo", async character => {
  const original = setup(character); expect(prepare(character)).toMatchObject({ ok: true });
  const pending = game(), saved = localStorage.getItem("new-blood-st")!;
  expect(StorytellerGamePersistedSchema.safeParse(pending).success).toBe(true);
  store.setState({ game: null, undoStack: [] }); localStorage.setItem("new-blood-st", saved); await store.persist.rehydrate();
  expect(game()).toEqual(pending);
  const projections = () => JSON.stringify([projectLobbyToPublic(game(), {}), projectLobbyToSelfMap(game(), proofRegistry)]);
  expect(projections()).not.toMatch(/preparedInformation|qualifyingParticipantId|sourceIdentityEpoch|informationDeliveries/);
  store.setState({ game: { ...game(), phase: "night", day: 1 } }); const beforeDelivery = game();
  expect(deliver()).toMatchObject({ ok: true }); expect(game().preparedInformation).toEqual([]);
  expect(game().informationDeliveries).toHaveLength(1);
  expect(game().informationDeliveries[0]!.values).toContainEqual({ requirementId: "role", kind: "role", roleId: character === "librarian" ? "recluse" : "poisoner" });
  expect(game().players.p1).toMatchObject({ actualRole: original.players.p1!.actualRole, actualAlignment: "good", shownRole: "recluse", effects: [] });
  expect(game().players.p1!.reminders).toEqual(pending.players.p1!.reminders);
  expect(projections()).not.toMatch(/preparedInformation|qualifyingParticipantId|sourceIdentityEpoch|informationDeliveries/);
  expect(prepare(character)).toMatchObject({ ok: false });
  store.getState().undo(); expect(game()).toEqual(beforeDelivery);
});

it.each(["poisoned", "drunk", "abilityLost"])("Post-R3 %s Recluse remains truthful for Librarian but cannot be an Investigator's Minion", effect => {
  setup("librarian"); store.setState({ game: impair(game(), "p1", effect) });
  expect(prepare("librarian")).toMatchObject({ ok: true });
  setup("investigator"); store.setState({ game: impair(game(), "p1", effect) }); const before = store.getState();
  expect(prepare("investigator")).toMatchObject({ ok: false }); expect(store.getState()).toBe(before);
});

it.each(["soberHealthy", "registersFalsely", "unknown-effect"])("Post-R3 unverified %s never bypasses preparation safety", effect => {
  for (const character of ["librarian", "investigator"] as const) {
    setup(character); store.setState({ game: impair(game(), "p1", effect) }); const before = store.getState();
    expect(prepare(character)).toMatchObject({ ok: false }); expect(store.getState()).toBe(before);
  }
});

it("Post-R3 Librarian cannot turn the Recluse into another Outsider or silently choose zero", () => {
  setup("librarian"); const before = store.getState();
  expect(prepare("librarian", "saint")).toMatchObject({ ok: false });
  expect(store.getState().prepareInformation({ ...request("librarian"), clue: { kind: "zero-outsiders" } }, captureCharacterActionContext())).toMatchObject({ ok: false });
  expect(store.getState()).toBe(before);
});

it.each(["source-poisoned", "recluse-poisoned", "source-replaced", "target-replaced", "role-changed", "reminder-removed"])(
  "Post-R3 pending Investigator clue revalidates %s without partial delivery", change => {
    setup("investigator"); expect(prepare("investigator")).toMatchObject({ ok: true });
    let changed: StorytellerLobbyRecord = { ...game(), phase: "night", day: 1 };
    if (change === "source-poisoned") changed = impair(changed, "p0");
    if (change === "recluse-poisoned") changed = impair(changed, "p1");
    if (change === "source-replaced") changed = reseat(changed, "p0");
    if (change === "target-replaced") changed = reseat(changed, "p1");
    if (change === "role-changed") changed = patchPlayer(changed, "p1", { actualRole: "saint" });
    if (change === "reminder-removed") changed = patchPlayer(changed, "p1", { reminders: [] });
    store.setState({ game: changed }); const before = store.getState();
    expect(deliver()).toMatchObject({ ok: false }); expect(store.getState()).toBe(before);
  });

it.each(["privacy", "recovery", "storage"])("Post-R3 %s prevents partial preparation and delivery", barrier => {
  setup("investigator"); expect(prepare("investigator")).toMatchObject({ ok: true });
  store.setState({ game: { ...game(), phase: "night", day: 1 } });
  if (barrier === "privacy") usePrivacyStore.getState().setEnabled(true);
  if (barrier === "recovery") store.setState({ terminalClose: { intent: { kind: "declare", winner: "good" }, status: "failed", message: "Retry", recoveryPending: true } });
  if (barrier === "storage") vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
  const before = store.getState();
  expect(prepare("investigator", "baron")).toMatchObject({ ok: false }); expect(deliver()).toMatchObject({ ok: false });
  expect(store.getState().game).toBe(before.game); expect(store.getState().undoStack).toBe(before.undoStack);
});

it("Post-R3 preparation follows participant identity through seat swaps", () => {
  setup("investigator"); store.setState({ grimoireMode: "ring", tokenPositions: {} });
  expect(prepare("investigator")).toMatchObject({ ok: true }); const pending = game().preparedInformation;
  expect(store.getState().swapPlayerSeats(bind(game(), "p1"), bind(game(), "p3"))).toMatchObject({ ok: true });
  expect(game().preparedInformation).toEqual(pending);
  expect(game().seatOrder).toEqual(["p0", "p3", "p2", "p1", "p4"]);
  store.setState({ game: { ...game(), phase: "night", day: 1 } });
  expect(deliver()).toMatchObject({ ok: true });
  expect(game().informationDeliveries[0]!.values).toContainEqual(expect.objectContaining({ requirementId: "players", kind: "player",
    participants: [expect.objectContaining({ playerId: "p1", participantId: pending[0]!.clue.kind === "pair" ? pending[0]!.clue.qualifyingParticipantId : "" }), expect.objectContaining({ playerId: "p2" })] }));
});

it("Post-R3 sourced poisoning is re-evaluated rather than persisted as registration", () => {
  setup("investigator"); const g = game();
  const poisoned = patchPlayer(g, "p1", { effects: [{ id: "source-poison", type: "poisoned", state: "active", lifetime: { kind: "manual" }, expiry: { kind: "none" },
    sourceCharacter: "poisoner", sourceParticipant: { kind: "participant", playerId: "p4", participantId: g.players.p4!.participantId!, nameAtTime: "Poisoner" } }] });
  store.setState({ game: poisoned }); expect(prepare("investigator")).toMatchObject({ ok: false });
  store.setState({ game: patchPlayer(poisoned, "p4", { alive: false }) });
  expect(prepare("investigator")).toMatchObject({ ok: true });
  expect(game().players.p1!.effects).toEqual(poisoned.players.p1!.effects);
});

it("Post-R3 homebrew Recluse cannot inherit the canonical optional-registration choice", () => {
  setup("investigator");
  const script = { ...proofScript, characters: proofScript.characters.map(role => role.id === "recluse" ? { ...role, provenance: { status: "homebrew" as const } } : role) };
  store.setState({ customScripts: { [script.id]: script } }); const before = store.getState();
  const result = store.getState().prepareInformation({ ...request("investigator"), expected: preparedInformationContext(game(), script) }, captureCharacterActionContext());
  expect(result).toMatchObject({ ok: false, message: "A character in play has interactions outside verified coverage." });
  expect(store.getState()).toBe(before);
});
