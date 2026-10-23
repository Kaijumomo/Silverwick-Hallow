import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ModernNightPanel } from "./testGuide";
import { FirstInformationPreparation, useFirstInformationPreparation } from "@/features/setup/FirstInformationPreparation";
import { pickSeatIfPicking, useTargetPicker } from "@/features/abilities/abilityUi";
import { PopoverReminders } from "@/features/players/PopoverReminders";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { participantStepKey } from "@/stores/nightProgress";
import { preparedInformationContext } from "@/stores/preparedInformation";
import { proofGame, proofScript, bind, impair } from "@/test/proofFixtures";
import type { PreparedInformationCharacter } from "@/stores/types";

const game = () => store.getState().game!;
function Setup() { const g = store(s => s.game!); const selection = useFirstInformationPreparation(g, proofScript); return <><FirstInformationPreparation selection={selection} />{selection.dialog}{selection.error && <p role="alert">{selection.error}</p>}</>; }
function Guide() { const g = store(s => s.game!); return <ModernNightPanel game={g} script={proofScript} visible onClose={() => {}} />; }
function initial(character: string, target = "chef") {
  const g = proofGame([character, target, "soldier", "poisoner", "imp"], "night", 0);
  g.phase = "setup";
  g.setupRolesDealt = true;
  Object.values(g.players).forEach(p => { p.packetEpoch = `epoch-${p.id}`; });
  store.setState({ game: g, lobby: null, undoStack: [], terminalClose: null, customScripts: { [proofScript.id]: proofScript } });
  return g;
}
function prepare(character: PreparedInformationCharacter, shownCharacter = "chef") {
  return store.getState().prepareInformation({ character, source: bind(game(), "p0"),
    clue: { kind: "pair", candidates: [bind(game(), "p1"), bind(game(), "p2")], qualifyingParticipantId: game().players.p1!.participantId!, shownCharacter },
    expected: preparedInformationContext(game(), proofScript) });
}
function night() {
  act(() => store.setState({ game: { ...game(), phase: "night", day: 1 } }));
  useShellStore.getState().setNightCursor({ day: 1, stepKey: participantStepKey(game().players.p0!.participantId!, game().players.p0!.shownRole!) });
  return render(<StrictMode><Guide /></StrictMode>);
}
const tap = (id: string) => act(() => { pickSeatIfPicking(game(), id); });
const next = () => fireEvent.click(screen.getByRole("button", { name: "Next" }));
beforeEach(() => { usePrivacyStore.getState().reset(); useShellStore.getState().reset(); useSessionRuntime.setState({ backend: null }); useTargetPicker.getState().cancel(); });
afterEach(() => { cleanup(); useTargetPicker.getState().cancel(); vi.restoreAllMocks(); });

it.each([ ["washerwoman", "Washerwoman", "chef", "Chef", "Townsfolk"], ["librarian", "Librarian", "saint", "Saint", "Outsider"], ["investigator", "Investigator", "poisoner", "Poisoner", "Minion"] ] as const)("%s completes direct Setup selection with reminders and no delivery", (character, name, target, targetName, label) => {
  initial(character, target);
  render(<StrictMode><Setup /></StrictMode>);
  fireEvent.click(screen.getByRole("button", { name: `Prepare ${name}` }));
  fireEvent.click(screen.getByRole("button", { name: targetName }));
  tap("p1"); expect(game().preparedInformation).toHaveLength(0);
  tap("p2"); expect(game().preparedInformation).toHaveLength(1);
  expect(game().players.p1!.reminders[0]?.label).toBe(label);
  expect(game().players.p2!.reminders[0]?.label).toBe("Wrong");
  expect(game().informationDeliveries).toHaveLength(0);
  expect(store.getState().undoStack).toHaveLength(1);
});

it("cancels stale Setup callbacks and concealed chooser content", () => {
  initial("washerwoman"); render(<StrictMode><Setup /></StrictMode>);
  fireEvent.click(screen.getByRole("button", { name: "Prepare Washerwoman" }));
  fireEvent.click(screen.getByRole("button", { name: "Chef" }));
  const stale = useTargetPicker.getState().active!.onPick;
  act(() => usePrivacyStore.setState({ enabled: true }));
  expect(useTargetPicker.getState().active).toBeNull();
  stale(bind(game(), "p1")); expect(game().preparedInformation).toHaveLength(0);
  expect(screen.queryByText(/Washerwoman/)).toBeNull();
});

it("keeps unsupported Setup actions manual without offering a preparation picker", () => {
  initial("washerwoman", "clockmaker");
  render(<StrictMode><Setup /></StrictMode>);
  expect(screen.queryByRole("button", { name: "Prepare Washerwoman" })).toBeNull();
  expect(useTargetPicker.getState().active).toBeNull();
  expect(game().preparedInformation).toHaveLength(0);
});

it("Reveal is a preview; Next records one delivery and retains exact reminders, with Undo", () => {
  initial("washerwoman"); expect(prepare("washerwoman").ok).toBe(true); night();
  const before = game(), reminders = before.players.p1!.reminders;
  expect(screen.getByText(/Player 1 or Player 2/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Reveal a Token" }));
  expect(game()).toBe(before);
  fireEvent.click(screen.getByRole("button", { name: "Return to Grimoire" }));
  next(); expect(game().informationDeliveries).toHaveLength(1);
  expect(game().preparedInformation).toHaveLength(0);
  expect(game().players.p1!.reminders).toEqual(reminders);
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  next(); expect(game().informationDeliveries).toHaveLength(1);
  act(() => store.getState().undo()); expect(game()).toEqual(before);
});

it("manual Next without a reveal consumes the pending opportunity without claiming delivery", () => {
  initial("washerwoman"); prepare("washerwoman"); night(); next();
  expect(game().informationDeliveries).toHaveLength(0);
  expect(game().preparedInformation).toHaveLength(0);
});

it("a zero Librarian clue uses no pair or reminders and delivers once through Next", () => {
  initial("librarian"); render(<StrictMode><Setup /></StrictMode>);
  fireEvent.click(screen.getByRole("button", { name: "Show 0 Outsiders" }));
  expect(game().preparedInformation[0]?.clue.kind).toBe("zero-outsiders");
  cleanup(); night(); expect(screen.getByLabelText("Information to communicate")).toHaveTextContent("0");
  next(); expect(game().informationDeliveries).toHaveLength(1);
  expect(Object.values(game().players).flatMap(p => p.reminders)).toEqual([]);
});

it("poisoning after Setup requires a new deliberate choice before verified presentation", () => {
  initial("washerwoman"); prepare("washerwoman");
  store.setState({ game: impair(game(), "p0") }); night();
  expect(screen.queryByText(/Player 1 or Player 2/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Reveal a Token" }));
  fireEvent.click(screen.getByRole("button", { name: "Empath" }));
  expect(game().informationDeliveries).toHaveLength(0);
  expect(game().preparedInformation[0]?.mode).toBe("storyteller");
  fireEvent.click(screen.getByRole("button", { name: "Return to Grimoire" })); next();
  expect(game().informationDeliveries[0]).toMatchObject({ values: expect.arrayContaining([expect.objectContaining({ kind: "role", roleId: "empath" })]) });
});

it("failed Night persistence leaves preparation pending and communication absent", () => {
  initial("washerwoman"); prepare("washerwoman"); night();
  fireEvent.click(screen.getByRole("button", { name: "Reveal a Token" }));
  fireEvent.click(screen.getByRole("button", { name: "Return to Grimoire" }));
  const before = game();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  next(); expect(game()).toBe(before); expect(game().informationDeliveries).toHaveLength(0);
  expect(screen.getByRole("alert")).toBeTruthy();
});

it("groups equivalent tokens but removes only the exact pending generated reminder in two taps", () => {
  initial("washerwoman");
  store.getState().resolveReminders({ intents: [{ kind: "place", target: bind(game(), "p1"), reminder: { label: "Townsfolk", sourceCharacter: "washerwoman" } }] });
  const manual = game().players.p1!.reminders[0]!;
  prepare("washerwoman");
  function Markers() { return <PopoverReminders player={store(s => s.game!.players.p1!)} />; }
  render(<Markers />);
  expect(screen.getAllByRole("button", { name: "Remove Townsfolk reminder" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Remove Townsfolk reminder" }));
  expect(game().preparedInformation).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Remove Townsfolk reminder" }));
  expect(game().preparedInformation).toHaveLength(0);
  expect(game().players.p1!.reminders).toEqual([manual]);
});
