import { afterEach, beforeEach, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ModernNightPanel } from "./testGuide";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { proofGame, proofScript } from "@/test/proofFixtures";
import { useV6Ui } from "../../v6Store";
import { useInfoShow } from "../../info/showStore";

const game = () => store.getState().game!;
const base = () => {
  const g = proofGame(["imp", "poisoner", "chef", "empath", "soldier", "virgin", "slayer"], "night", 1);
  g.players.p0!.privateInfo = { bluffs: ["monk", "saint", "ravenkeeper"] };
  return g;
};
function Guide({ visible = true }: { visible?: boolean }) { const g = store(state => state.game)!; return <ModernNightPanel game={g} script={proofScript} visible={visible} onClose={() => {}} />; }
function open(g = base(), stepKey = "minionInfo") {
  store.setState({ game: g, lobby: null, terminalClose: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
  useShellStore.getState().setNightCursor({ day: 1, stepKey });
  return render(<Guide />);
}
beforeEach(() => {
  localStorage.clear(); usePrivacyStore.getState().reset(); useShellStore.getState().reset(); useSessionRuntime.setState({ backend: null, status: "failed" });
  useV6Ui.getState().reset(); useInfoShow.getState().clear();
});
afterEach(cleanup);

it.each(["minionInfo", "demonInfo"])("R2 %s shows player-safe Setup Info locally; Next alone completes with Undo", stepKey => {
  const g = base(); open(g, stepKey);
  fireEvent.click(screen.getByRole("button", { name: stepKey === "minionInfo" ? "Show Minion Information" : "Show Demon Information" }));
  const dialog = screen.getByRole("dialog");
  // PO 2026-10-28: the V2 Reveal (the Information panel's player view), never the older full-screen presentation.
  expect(dialog).toHaveAccessibleName(stepKey === "minionInfo" ? "Minion Information" : "Demon Information");
  expect(dialog.style.zIndex).toBe("90"); expect(document.querySelector(".player-presentation-layer")).toBeNull();
  expect(within(dialog).queryByText(/actually|actual role|Storyteller/i)).toBeNull();
  expect(within(dialog).getByText("Your Minions")).toBeInTheDocument();
  if (stepKey === "minionInfo") expect(within(dialog).getByText("Your Demon")).toBeInTheDocument();
  else expect(within(dialog).getByText("Monk")).toBeInTheDocument();
  expect(game()).toBe(g); expect(store.getState().undoStack).toHaveLength(0);
  fireEvent.click(within(dialog).getByRole("button", { name: "Return to Grimoire" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(game().nightProgress[`1:${stepKey}`]).toMatchObject({ status: "done" });
  expect(game().informationDeliveries).toEqual([]); expect(game().players).toEqual(g.players);
  act(() => store.getState().undo()); expect(game()).toEqual(g);
});

it("R2 six residents plus a Traveller never creates ordinary evil introductions", () => {
  const g = base(); g.players.p6!.isTraveler = true; g.players.p6!.actualRole = "gunslinger"; g.players.p6!.shownRole = "gunslinger";
  open(g);
  expect(screen.queryByRole("button", { name: /Show (Minion|Demon) Information/ })).toBeNull();
  expect(screen.getAllByText("Starting information — small game").length).toBeGreaterThan(0);
});

it("R2 Toymaker keeps the existing small-game starting information exception", () => {
  const g = proofGame(["imp", "poisoner", "chef", "empath", "soldier"], "night", 1, { fabled: ["toymaker"] });
  open(g); fireEvent.click(screen.getByRole("button", { name: "Show Minion Information" }));
  expect(within(screen.getByRole("dialog")).getByText("Your Demon")).toBeInTheDocument();
});

it("R2 Poppy Grower demon introduction only shows bluffs", () => {
  const g = base(); g.players.p2!.actualRole = "poppygrower"; g.players.p2!.shownRole = "poppygrower";
  open(g, "demonInfo"); fireEvent.click(screen.getByRole("button", { name: "Show Demon Bluffs" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Monk")).toBeInTheDocument();
  expect(within(dialog).queryByText("Your Minions")).toBeNull(); expect(game()).toBe(g);
});

it("R2 setup changes invalidate an open reveal and privacy removes it", () => {
  open(); fireEvent.click(screen.getByRole("button", { name: "Show Minion Information" }));
  act(() => store.setState({ game: { ...game(), notes: "changed" } }));
  expect(screen.getByRole("dialog", { name: "Information changed" })).toBeInTheDocument();
  expect(within(screen.getByRole("dialog")).queryByText("Player 0")).toBeNull();
  act(() => usePrivacyStore.getState().setEnabled(true)); expect(screen.queryByRole("dialog")).toBeNull();
});

it("R2 separate Demons retain separate bluff sets", () => {
  const g = base(); g.players.p2!.actualRole = "imp"; g.players.p2!.shownRole = "imp"; g.players.p2!.actualAlignment = "evil";
  g.players.p2!.privateInfo = { bluffs: ["washerwoman", "librarian", "investigator"] };
  open(g, "demonInfo");
  fireEvent.click(screen.getByRole("button", { name: "Show Demon Information to Player 2" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Washerwoman")).toBeInTheDocument(); expect(within(dialog).queryByText("Monk")).toBeNull();
});

it("R2 unavailable bluff characters remain a reviewable refusal", () => {
  const g = base(); g.players.p0!.privateInfo = { bluffs: ["missing-character", "saint", "monk"] };
  open(g, "demonInfo"); fireEvent.click(screen.getByRole("button", { name: "Show Demon Information" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Review the bluff characters"); expect(screen.queryByRole("dialog")).toBeNull();
  expect(game()).toBe(g);
});

it.each([[[]], [["monk"]], [["monk", "saint"]]])("PO 2026-10-28: Demon information waits for all three bluffs (%j)", bluffs => {
  const g = base(); g.players.p0!.privateInfo = { bluffs };
  open(g, "demonInfo"); fireEvent.click(screen.getByRole("button", { name: "Show Demon Information" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Choose all 3 Demon bluffs before showing this information.");
  expect(screen.queryByRole("dialog")).toBeNull(); expect(game()).toBe(g);
});

it("PO 2026-10-28: Demon bluffs wait for all three bluffs", () => {
  const g = base(); g.players.p2!.actualRole = "poppygrower"; g.players.p2!.shownRole = "poppygrower"; g.players.p0!.privateInfo = { bluffs: ["monk", "saint"] };
  open(g, "demonInfo"); fireEvent.click(screen.getByRole("button", { name: "Show Demon Bluffs" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Choose all 3 Demon bluffs");
  expect(screen.queryByRole("dialog")).toBeNull(); expect(game()).toBe(g);
});
