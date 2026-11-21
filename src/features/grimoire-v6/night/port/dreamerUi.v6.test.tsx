// SV-5c -- the Dreamer's step on the Night card: tap the player on the board (never the Dreamer or a Traveller), pick the false token
// from the board's character picker (the other team only, tokens only), one commit and one Undo, the Wake row with the two tokens good
// first, and the player-safe screen showing both at once. https://wiki.bloodontheclocktower.com/Dreamer
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ModernNightPanel } from "@/test/nightTestGuide";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { useV6Ui } from "@/features/grimoire-v6/v6Store";
import { useInfoShow } from "@/features/grimoire-v6/info/showStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { participantStepKey } from "@/stores/nightProgress";
import { pickSeatIfPicking, useTargetPicker } from "@/features/abilities/abilityUi";
import { impair, openInStore, patchPlayer, proofGame, proofScript } from "@/test/proofFixtures";


const game = () => store.getState().game!;
function Guide() { const g = store(s => s.game)!; return <ModernNightPanel game={g} script={proofScript} visible onClose={() => {}} />; }
// p0 dreamer, p1 mutant, p2 cerenovus, p3 vigormortis, p4 philosopher, p5 artist
const ROLES = ["dreamer", "mutant", "cerenovus", "vigormortis", "philosopher", "artist"];
function show(g = proofGame(ROLES)) {
  openInStore(g);
  useShellStore.getState().setNightCursor({ day: g.day, stepKey: participantStepKey(g.players.p0!.participantId!, g.players.p0!.shownRole!) });
  return render(<StrictMode><Guide /></StrictMode>);
}
const tap = (id: string) => act(() => { pickSeatIfPicking(game(), id); });
const picker = () => { const open = useV6Ui.getState().picker; return open?.mode === "show" ? open : undefined; };
const pickCharacter = (roleId: string) => { let refusal: string | undefined; act(() => { refusal = picker()?.onPick?.(roleId) ?? undefined; }); return refusal; };
beforeEach(() => { localStorage.clear(); store.setState({ game: null, lobby: null, terminalClose: null, undoStack: [] }); useSessionRuntime.setState({ backend: null, status: "idle" }); useShellStore.getState().reset(); usePrivacyStore.setState({ enabled: false }); useTargetPicker.getState().cancel(); useV6Ui.getState().set({ picker: null }); useInfoShow.getState().clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("tap a good player: the picker offers only Minions and Demons, tokens only; the pick commits once, and Undo takes it back", () => {
  show();
  const eligible = useTargetPicker.getState().active?.eligible;
  expect(eligible?.has(game().players.p0!.participantId!)).toBe(false);
  expect(screen.getByText("Choose a player on the board")).toBeInTheDocument();
  tap("p1");
  expect(picker()).toMatchObject({ title: "Choose a false evil character", types: ["minion", "demon"], tokensOnly: true });
  expect(screen.getByText(`${game().players.p1!.name} is the Mutant.`)).toBeInTheDocument();
  expect(pickCharacter("clockmaker")).toBe("Choose a Minion or a Demon of this script.");
  expect(game().informationDeliveries).toHaveLength(0);
  expect(pickCharacter("cerenovus")).toBeUndefined();
  expect(picker()).toBeUndefined();
  expect(game().informationDeliveries.at(-1)!.values).toEqual([
    expect.objectContaining({ requirementId: "player" }),
    { requirementId: "goodCharacter", kind: "role", roleId: "mutant" },
    { requirementId: "evilCharacter", kind: "role", roleId: "cerenovus" },
  ]);
  expect(store.getState().undoStack).toHaveLength(1);
  expect(screen.getByText("Completed")).toBeInTheDocument();
  store.getState().undo();
  expect(game().informationDeliveries).toHaveLength(0);
});

it("tap an evil player: the picker offers only Townsfolk and Outsiders; the Wake row shows good first, and one screen shows both", () => {
  show();
  tap("p3");
  expect(picker()).toMatchObject({ title: "Choose a false good character", types: ["townsfolk", "outsider"] });
  pickCharacter("artist");
  const row = screen.getByRole("group", { name: `Wake ${game().players.p0!.name}` });
  const tokens = [...row.querySelectorAll(".gv-you-are-token")].map((token) => token.textContent);
  expect(tokens).toEqual(["GoodArtist", "EvilVigormortis"]);
  fireEvent.click(row.querySelectorAll(".gv-you-are-token")[1]!);
  const shownNow = useInfoShow.getState();
  expect(JSON.stringify(shownNow)).toContain("One of These Is Correct");
  expect(JSON.stringify(shownNow).indexOf("Artist")).toBeLessThan(JSON.stringify(shownNow).indexOf("Vigormortis"));
  expect(JSON.stringify(shownNow)).not.toContain("in Play");
});

it("a Traveller cannot be chosen", () => {
  show(patchPlayer(proofGame(ROLES), "p5", { isTraveler: true, actualRole: "harlot", shownRole: "harlot" }));
  expect(useTargetPicker.getState().active?.eligible?.has(game().players.p5!.participantId!)).toBe(false);
});

it("a poisoned Dreamer: the Storyteller picks a good token, then an evil one, and both are recorded in one commit", () => {
  show(impair(proofGame(ROLES), "p0"));
  tap("p1");
  expect(picker()).toMatchObject({ title: "Choose the good character to show", types: ["townsfolk", "outsider"] });
  pickCharacter("sage");
  expect(game().informationDeliveries).toHaveLength(0);
  expect(picker()).toMatchObject({ title: "Choose the evil character to show", types: ["minion", "demon"] });
  pickCharacter("witch");
  expect(game().informationDeliveries.at(-1)!.values).toContainEqual({ requirementId: "goodCharacter", kind: "role", roleId: "sage" });
  expect(game().informationDeliveries.at(-1)!.values).toContainEqual({ requirementId: "evilCharacter", kind: "role", roleId: "witch" });
  expect(store.getState().undoStack).toHaveLength(1);
});

it("closing the picker keeps the chosen player; Choose Evil Character reopens it", () => {
  show();
  tap("p1");
  act(() => { useV6Ui.getState().set({ picker: null }); });
  fireEvent.click(screen.getByRole("button", { name: "Choose Evil Character" }));
  expect(picker()).toMatchObject({ title: "Choose a false evil character" });
});

it("Privacy Mode hides the card", () => {
  show();
  act(() => usePrivacyStore.getState().setEnabled(true));
  expect(screen.queryByText("Choose a player on the board")).toBeNull();
});

