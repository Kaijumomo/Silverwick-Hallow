// PH-c / PH-d -- the Pit-Hag's arbitrary-death night: the Kill / Protect row, and a Demon's attack asked on its card. The Pit-Hag's Night step in the existing Night panel, in the Cerenovus card's language: the Storyteller taps a player on the
// board, then the board's character picker (all four character types, tokens only, no player names) commits at once (one Undo). Afterwards
// the card shows who became what and the "Wake" row (YOU ARE, the new character, then Good or Evil). https://wiki.bloodontheclocktower.com/Pit-Hag
// board, then the board's character picker (Townsfolk and Outsiders, tokens only, no player names) commits at once (one Undo). Afterwards
// the card shows who is mad about which character and the "Wake" row with the two reveal tokens. https://wiki.bloodontheclocktower.com/Cerenovus
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ModernNightPanel } from "@/test/nightTestGuide";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { useV6Ui } from "@/features/grimoire-v6/v6Store";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { participantStepKey } from "@/stores/nightProgress";
import { pickSeatIfPicking, useTargetPicker } from "@/features/abilities/abilityUi";
import { useInfoShow } from "@/features/grimoire-v6/info/showStore";
import { openInStore, proofGame, proofScript } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

const game = () => store.getState().game!;
function Guide() { const g = store(s => s.game)!; return <ModernNightPanel game={g} script={proofScript} visible onClose={() => {}} />; }
// p0 pithag, p1 imp, p2 chef, p3 empath, p4 monk
const ROLES = ["pithag", "imp", "chef", "empath", "monk"];
const stepKey = (g: StorytellerLobbyRecord) => participantStepKey(g.players.p0!.participantId!, "pithag");
function show(g = proofGame(ROLES)) {
  openInStore(g);
  useShellStore.getState().setNightCursor({ day: g.day, stepKey: stepKey(g) });
  return render(<StrictMode><Guide /></StrictMode>);
}
const tap = (id: string) => act(() => { pickSeatIfPicking(game(), id); });
const picker = () => useV6Ui.getState().picker;
const onPickOf = () => { const open = picker(); return open?.mode === "show" ? open.onPick : undefined; };
const pickCharacter = (roleId: string) => { let refusal: string | undefined; act(() => { refusal = onPickOf()?.(roleId) ?? undefined; }); return refusal; };

beforeEach(() => { localStorage.clear(); store.setState({ game: null, lobby: null, terminalClose: null, undoStack: [] }); useSessionRuntime.setState({ backend: null, status: "idle" }); useShellStore.getState().reset(); usePrivacyStore.setState({ enabled: false }); useTargetPicker.getState().cancel(); useV6Ui.getState().set({ picker: null }); useInfoShow.getState().clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const alive = (id: string) => game().players[id]!.alive;
const protectedBy = (id: string) => game().players[id]!.effects.filter((e) => e.type === "protected" && e.sourceCharacter === "pithag");
const makeVortox = () => { show(); tap("p2"); expect(pickCharacter("vortox")).toBeUndefined(); };
// The Imp is turned into the Vortox: one living Demon, whose attack is asked on its own card. (With two living Demons every kill stays by hand;
// the Kill pill is the way to record those.)
const makeOnlyDemon = () => { show(); tap("p1"); expect(pickCharacter("vortox")).toBeUndefined(); };
const toDemon = () => act(() => { useShellStore.getState().setNightCursor({ day: 2, stepKey: participantStepKey(game().players.p1!.participantId!, "vortox") }); });
const demonDone = () => game().nightProgress[`2:${participantStepKey(game().players.p1!.participantId!, "vortox")}`]?.status;
const pill = (name: string) => screen.getByRole("button", { name });

it("a non-Demon change shows no arbitrary row; a made Demon shows it and kills or protects nobody by itself", () => {
  show();
  tap("p2"); pickCharacter("savant");
  expect(document.querySelector("[data-pithag-arbitrary]")).toBeNull();
  cleanup(); store.setState({ game: null, undoStack: [] });
  makeVortox();
  expect(document.querySelector("[data-pithag-arbitrary]")).not.toBeNull();
  expect(screen.getByText("Deaths are arbitrary tonight")).toBeInTheDocument();
  expect(Object.values(game().players).filter((p) => !p.alive)).toHaveLength(0);
  expect(protectedBy("p0")).toHaveLength(0);
});

it("Kill then a tap on the board: a real death sourced to the Pit-Hag, one Undo; the pill reads on and a second tap on it turns it off", () => {
  makeVortox();
  fireEvent.click(pill("Kill"));
  expect(pill("Kill")).toHaveAttribute("aria-pressed", "true");
  expect(useTargetPicker.getState().active?.label).toBe("Choose who dies");
  const undoBefore = store.getState().undoStack.length;
  tap("p3");
  expect(alive("p3")).toBe(false);
  expect(store.getState().undoStack).toHaveLength(undoBefore + 1);
  const event = game().lifeEventWindow.events.find((e) => e.kind === "death" && e.subject.playerId === "p3")!;
  expect(event.provenance).toMatchObject({ sourceCharacter: "pithag" });
  // The picker comes back for the next tap while the pill stays on.
  expect(useTargetPicker.getState().active?.label).toBe("Choose who dies");
  fireEvent.click(pill("Kill"));
  expect(pill("Kill")).toHaveAttribute("aria-pressed", "false");
  expect(useTargetPicker.getState().active).toBeNull();
  act(() => { store.getState().undo(); });
  expect(alive("p3")).toBe(true);
});

it("Kill on a dead player says so and records nothing", () => {
  makeVortox();
  fireEvent.click(pill("Kill"));
  tap("p3"); tap("p3");
  expect(screen.getByRole("alert")).toHaveTextContent("already dead");
});

it("Protect places the Protected Effect (Pit-Hag source, until dawn); tapping again takes it off; Undo removes it", () => {
  makeVortox();
  fireEvent.click(pill("Protect"));
  expect(useTargetPicker.getState().active?.label).toBe("Choose who is protected");
  tap("p4");
  expect(protectedBy("p4")).toEqual([expect.objectContaining({ lifetime: { kind: "untilDawn" }, sourceCharacter: "pithag" })]);
  tap("p4");
  expect(protectedBy("p4")).toHaveLength(0);
  tap("p4");
  act(() => { store.getState().undo(); });
  expect(protectedBy("p4")).toHaveLength(0);
});

it("the new Demon's own attack is asked on its card, in two answers: They Survive keeps the player alive, They Die kills them", () => {
  makeOnlyDemon();
  toDemon();
  tap("p3");
  expect(screen.getByText("Does Player 3 die?")).toBeInTheDocument();
  expect(screen.queryByText("Resolve")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "They Survive" }));
  expect(alive("p3")).toBe(true);
  expect(demonDone()).toBe("done");
});

it("They Die records the death through the same card, in one Undo", () => {
  makeOnlyDemon();
  toDemon();
  tap("p3");
  const undoBefore = store.getState().undoStack.length;
  fireEvent.click(screen.getByRole("button", { name: "They Die" }));
  expect(alive("p3")).toBe(false);
  expect(store.getState().undoStack).toHaveLength(undoBefore + 1);
  act(() => { store.getState().undo(); });
  expect(alive("p3")).toBe(true);
});

it("Choose again drops the held tap and nothing changes", () => {
  makeOnlyDemon();
  toDemon();
  tap("p3");
  const before = game();
  fireEvent.click(screen.getByRole("button", { name: "Choose again" }));
  expect(game()).toBe(before);
  expect(screen.queryByText("Does Player 3 die?")).toBeNull();
});

it("a player the Pit-Hag protected survives the Demon's attack with no question", () => {
  makeOnlyDemon();
  fireEvent.click(pill("Protect"));
  tap("p4");
  fireEvent.click(pill("Protect"));
  toDemon();
  tap("p4");
  expect(screen.queryByText("Does Player 4 die?")).toBeNull();
  expect(alive("p4")).toBe(true);
  expect(demonDone()).toBe("done");
});

it("the row is on the new Demon's card too", () => {
  makeOnlyDemon();
  toDemon();
  expect(document.querySelector("[data-pithag-arbitrary]")).not.toBeNull();
});

it("Privacy Mode refuses a tap that still arrives", () => {
  makeVortox();
  fireEvent.click(pill("Kill"));
  const onPick = useTargetPicker.getState().active!.onPick;
  act(() => { usePrivacyStore.setState({ enabled: true }); });
  act(() => { onPick({ playerId: "p3", participantId: game().players.p3!.participantId! }); });
  expect(alive("p3")).toBe(true);
});

// Independent review of b6c2ec4: the two-answer ruling is only for a plain kill. The Imp killing itself (the star-pass) or another Demon,
// and the Fang Gu's jump, have more to them than one death, so they stay with the by-hand notice and nothing is recorded.
it("the Imp tapping itself (star-pass) is not turned into a plain death: by hand, nothing recorded", () => {
  show(proofGame(["pithag", "vortox", "poisoner", "empath", "monk"]));
  tap("p1"); expect(pickCharacter("imp")).toBeUndefined();
  act(() => { useShellStore.getState().setNightCursor({ day: 2, stepKey: participantStepKey(game().players.p1!.participantId!, "imp") }); });
  tap("p1");
  expect(screen.queryByText(/die\?/)).toBeNull();
  expect(alive("p1")).toBe(true);
  expect(game().players.p2!.actualRole).toBe("poisoner");
});

it("a made Fang Gu tapping an Outsider is not turned into a plain death: by hand, nothing recorded", () => {
  show(proofGame(["pithag", "imp", "saint", "empath", "monk"]));
  tap("p1"); expect(pickCharacter("fanggu")).toBeUndefined();
  act(() => { useShellStore.getState().setNightCursor({ day: 2, stepKey: participantStepKey(game().players.p1!.participantId!, "fanggu") }); });
  tap("p2");
  expect(screen.queryByText(/die\?/)).toBeNull();
  expect(alive("p2")).toBe(true);
});

it("no Kill / Protect row when the made Demon has no Pit-Hag behind it on the record (an older save): nothing dead-ends the board", () => {
  makeVortox();
  expect(screen.getByRole("button", { name: "Kill" })).toBeInTheDocument();
  act(() => { store.setState({ game: { ...game(), history: game().history.map((record) => record.provenance?.sourceCharacter === "pithag" ? { ...record, provenance: undefined } : record) } as StorytellerLobbyRecord }); });
  expect(screen.queryByRole("button", { name: "Kill" })).toBeNull();
});

it("moving to another step by any route turns Kill off: a board tap never kills while no row is shown", () => {
  makeVortox();
  fireEvent.click(pill("Kill"));
  expect(useTargetPicker.getState().active?.label).toBe("Choose who dies");
  act(() => { useShellStore.getState().setNightCursor({ day: 2, stepKey: participantStepKey(game().players.p4!.participantId!, "monk") }); });
  expect(useTargetPicker.getState().active?.label).not.toBe("Choose who dies");
  tap("p3");
  expect(alive("p3")).toBe(true);
});
