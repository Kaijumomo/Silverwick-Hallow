import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { captureCharacterActionContext, useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { clearNightActionCorrections } from "@/stores/nightActionCorrection";
import { participantStepKey } from "@/stores/nightProgress";
import { pickSeatIfPicking, useTargetPicker } from "@/features/abilities/abilityUi";
import { VotingProvider } from "@/features/voting/VotingWorkspace";
import { proofGame, proofScript } from "@/test/proofFixtures";
import { GrimoireV6Screen } from "../GrimoireV6Screen";
import { useV6Ui } from "../v6Store";
import { useNightPos } from "./nightPos";

const Screen = () => <VotingProvider><GrimoireV6Screen /></VotingProvider>;
const game = () => store.getState().game!;
const cursorKey = () => useShellStore.getState().nightCursor?.stepKey;
const key = (id: string) => participantStepKey(game().players[id]!.participantId!, game().players[id]!.shownRole!);
const tap = (id: string) => act(() => { pickSeatIfPicking(game(), id); });
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const openAt = (stepKey: string) => useShellStore.getState().setNightCursor({ day: game().day, stepKey });

beforeEach(() => {
  vi.useFakeTimers();
  store.setState({ game: proofGame(["poisoner", "monk", "imp", "empath", "chef"]), lobby: null, undoStack: [], localSeq: 0,
    customScripts: { [proofScript.id]: proofScript } });
  useSessionRuntime.setState({ backend: null });
  useShellStore.getState().reset();
  useNightPos.getState().go(0, null, null);
  usePrivacyStore.setState({ enabled: false });
  useTargetPicker.getState().cancel(); clearNightActionCorrections();
  useV6Ui.getState().reset();
  useV6Ui.getState().set({ panel: "night" });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const pos = () => screen.getByText(/^\d+ \/ \d+$/).textContent;

it("starts on Dusk, and Next walks Dusk, tonight's steps, then Dawn", () => {
  render(<Screen />);
  expect(screen.getByText("Everyone closes their eyes. The night begins.")).toBeInTheDocument();
  expect(pos()).toBe("1 / 6");
  press("Next");
  expect(cursorKey()).toBe(key("p0"));
  expect(pos()).toBe("2 / 6");
  for (let i = 0; i < 4; i++) press("Next");
  expect(pos()).toBe("6 / 6");
  expect(screen.getByText("No one died tonight. Everyone may open their eyes.")).toBeInTheDocument();
  press("Previous");
  expect(cursorKey()).toBe(key("p3"));
  for (let i = 0; i < 4; i++) press("Previous");
  expect(pos()).toBe("1 / 6");
});

it("Begin Day with unfinished work goes to Dawn first; continuing there is explicit and advances the phase", () => {
  render(<Screen />);
  press(/^Begin Day 2$/);
  expect(game().phase).toBe("night");
  expect(pos()).toBe("6 / 6");
  expect(screen.getByRole("group", { name: "Night work not finished" })).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("group", { name: "Night work not finished" })).getAllByRole("button")[0]!);
  expect(pos()).not.toBe("6 / 6");
  press(/^Begin Day 2$/);
  expect(pos()).toBe("6 / 6");
  press("Continue to Day anyway");
  expect(game().phase).toBe("day");
});

it("Begin Day with every step resolved advances at once", () => {
  const g = game();
  for (const id of g.seatOrder) g.nightProgress[`2:${key(id)}`] = { status: "done", notes: "" };
  store.setState({ game: { ...g, nightProgress: { ...g.nightProgress } } });
  render(<Screen />);
  expect(pos()).toBe("6 / 6");
  press(/^Begin Day 2$/);
  expect(game().phase).toBe("day");
});

it("the dock's Begin Day takes the same route as the card's", () => {
  render(<Screen />);
  press(/^Begin Day$/);
  expect(game().phase).toBe("night");
  expect(pos()).toBe("6 / 6");
});

it("Undo puts the strip back on the step it reopened", () => {
  render(<Screen />); press("Next"); tap("p4");
  press("Next");
  expect(cursorKey()).toBe(key("p1"));
  act(() => { fireEvent.click(screen.getByRole("button", { name: /^Undo/ })); });
  expect(cursorKey()).toBe(key("p0"));
  expect(game().players.p4!.effects).toEqual([]);
});

it("Undo takes the strip off a checkpoint", () => {
  render(<Screen />); press("Next"); tap("p4");
  press("Begin Day 2");
  expect(pos()).toBe("6 / 6");
  act(() => { fireEvent.click(screen.getByRole("button", { name: /^Undo/ })); });
  expect(cursorKey()).toBe(key("p0"));
  expect(pos()).toBe("2 / 6");
});

it("arrow keys move along the strip and Privacy Mode removes the card", () => {
  render(<Screen />);
  fireEvent.keyDown(document.body, { key: "ArrowRight" });
  expect(cursorKey()).toBe(key("p0"));
  fireEvent.keyDown(document.body, { key: "ArrowLeft" });
  expect(pos()).toBe("1 / 6");
  act(() => usePrivacyStore.getState().setEnabled(true));
  expect(screen.queryByText("Everyone closes their eyes. The night begins.")).toBeNull();
  expect(useShellStore.getState().litActor).toBeNull();
});

it("a manual step completed elsewhere moves on by itself after 2.2 s", () => {
  store.setState({ game: proofGame(["scarletwoman", "poisoner", "imp", "empath", "chef"]) });
  openAt(key("p0"));
  render(<Screen />);
  const scarlet = cursorKey()!;
  act(() => { store.getState().setNightStepStatus(2, scarlet, "done", captureCharacterActionContext()); });
  act(() => vi.advanceTimersByTime(2300));
  expect(cursorKey()).not.toBe(scarlet);
});
