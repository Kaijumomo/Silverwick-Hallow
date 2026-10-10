import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useTargetPicker, pickSeatIfPicking } from "@/features/abilities/abilityUi";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { withRedHerring } from "@/test/redHerringFixture";
import { bind, proofGame, proofQuery } from "@/test/proofFixtures";
import { automationEligibility } from "@/abilities/automationEligibility";
import { FORTUNE_TELLER } from "@/abilities/characters/fortuneteller";
import { PopoverReminders } from "@/features/players/PopoverReminders";
import { PlayersWorkspace } from "@/features/players/PlayersWorkspace";
import { RedHerringPreparation } from "./RedHerringPreparation";
import { redHerringSetup } from "./redHerringSetup";
import { selectSetupContext } from "./setupContext";

const game = () => store.getState().game!;
function View() { const current = store(state => state.game!); return <RedHerringPreparation context={selectSetupContext(current, setupScript)} />; }
beforeEach(() => {
  usePrivacyStore.getState().reset(); useTargetPicker.getState().cancel();
  const initial = setupGame(["fortuneteller", "chef", "monk", "poisoner", "imp"], { setupRolesDealt: true });
  initial.players.p0!.packetEpoch = "original-identity";
  store.setState({ game: initial, lobby: null, undoStack: [], terminalClose: null, customScripts: { [setupScript.id]: setupScript } });
});
afterEach(() => { cleanup(); useTargetPicker.getState().cancel(); });

it("requires an explicit good target, permits self and commits the existing fact with one Undo", () => {
  render(<View />);
  fireEvent.click(screen.getByRole("button", { name: "Choose Red Herring" }));
  expect(useTargetPicker.getState().active?.eligible?.has(game().players.p0!.participantId!)).toBe(true);
  const before = game();
  act(() => { pickSeatIfPicking(game(), "p4"); });
  expect(game()).toBe(before);
  act(() => { pickSeatIfPicking(game(), "p0"); });
  expect(game().players.p0!.effects).toEqual([expect.objectContaining({ type: "fortuneTellerRedHerring", lifetime: { kind: "manual" } })]);
  expect(game().players.p0!.reminders).toEqual([]);
  expect(store.getState().undoStack).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Choose Red Herring" })).toBeNull();
  act(() => store.getState().undo());
  expect(game()).toEqual(before);
});

it("cancels selection on privacy, rejects retained callback after state change, and cancels on unmount", () => {
  const { unmount } = render(<View />);
  fireEvent.click(screen.getByRole("button", { name: "Choose Red Herring" }));
  const callback = useTargetPicker.getState().active!.onPick;
  const target = bind(game(), "p1");
  act(() => usePrivacyStore.setState({ enabled: true }));
  expect(useTargetPicker.getState().active).toBeNull();
  expect(screen.queryByText("Fortune Teller")).toBeNull();
  callback(target); expect(game().players.p1!.effects).toEqual([]);
  act(() => usePrivacyStore.setState({ enabled: false }));
  fireEvent.click(screen.getByRole("button", { name: "Choose Red Herring" }));
  unmount(); expect(useTargetPicker.getState().active).toBeNull();
});

it.each(["players", "details"])("opens the full board from %s while preserving selection above the dismissed panel", surface => {
  render(<PlayersWorkspace enabled roles={setupScript.characters} onMore={vi.fn()} advancedPlayerId={null}>
    <button onClick={() => pickSeatIfPicking(game(), "p1")}>Choose board player</button>
  </PlayersWorkspace>);
  fireEvent.click(screen.getByRole("button", { name: "Players" }));
  if (surface === "details") {
    fireEvent.click(screen.getByRole("button", { name: "Setup details & modifiers" }));
    expect(screen.getByRole("dialog", { name: "Setup details" })).toBeVisible();
  }
  fireEvent.click(screen.getByRole("button", { name: "Choose Red Herring" }));
  expect(screen.getByRole("button", { name: "Players" })).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("dialog", { name: "Setup details" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Choose Red Herring" })).toBeNull();
  expect(useTargetPicker.getState().active?.label).toBe("Red Herring");
  fireEvent.click(screen.getByRole("button", { name: "Choose board player" }));
  expect(game().players.p1!.effects).toHaveLength(1);
  expect(store.getState().undoStack).toHaveLength(1);
});

it("the persistent picker cancels when its owner becomes disabled and rejects old callbacks after game change", () => {
  const view = (enabled = true) => <PlayersWorkspace enabled={enabled} roles={setupScript.characters} onMore={vi.fn()} advancedPlayerId={null}><div>Board</div></PlayersWorkspace>;
  const { rerender, unmount } = render(view());
  fireEvent.click(screen.getByRole("button", { name: "Players" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose Red Herring" }));
  const selected = bind(game(), "p1");
  const old = useTargetPicker.getState().active!.onPick;
  act(() => store.getState().setNotes("p1", "Changed during selection"));
  expect(useTargetPicker.getState().active).toBeNull();
  old(selected); expect(game().players.p1!.effects).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Players" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose Red Herring" }));
  rerender(view(false)); expect(useTargetPicker.getState().active).toBeNull();
  unmount();
});

it("keeps legacy notation stored under one official effect token; exact two-tap removal exposes only the inert note", () => {
  const initial = withRedHerring(game(), "p1");
  initial.players.p1!.reminders = [{ id: "legacy-note", label: "Red Herring", sourceCharacter: "fortuneteller" }];
  store.setState({ game: initial });
  function Reminders() { return <PopoverReminders player={store(state => state.game!.players.p1!)} />; }
  render(<Reminders />);
  const token = screen.getByRole("button", { name: "Remove Red Herring effect from Fortune Teller" });
  expect(screen.queryByRole("button", { name: "Remove Red Herring reminder" })).toBeNull();
  fireEvent.click(token); expect(game()).toBe(initial);
  fireEvent.click(token);
  expect(game().players.p1!.effects).toEqual([]);
  expect(game().players.p1!.reminders).toEqual(initial.players.p1!.reminders);
  expect(screen.getByRole("button", { name: "Remove Red Herring reminder" })).toHaveAttribute("data-reminder-kind", "notation");
});

it("ordinary readiness distinguishes missing, fixed valid, invalid and manual facts without choosing another target", () => {
  const status = (g = game()) => redHerringSetup(selectSetupContext(g, setupScript)).status;
  expect(status()).toBe("missing");
  const ready = withRedHerring(game(), "p1"); expect(status(ready)).toBe("ready");
  const changed = structuredClone(ready); changed.players.p1!.actualAlignment = "evil";
  expect(status(changed)).toBe("invalid");
  changed.players.p1!.actualAlignment = "good"; changed.players.p0!.packetEpoch = "changed";
  expect(status(changed)).toBe("invalid");
  delete changed.players.p1!.effects[0]!.parameters;
  expect(status(changed)).toBe("manual");
  expect(changed.players.p1!.effects[0]!.id).toBe(ready.players.p1!.effects[0]!.id);
});

it("fails closed before asking Night targets for missing, unbound, multiple or changed Fortune Teller identities", () => {
  const initial = withRedHerring(proofGame(["fortuneteller", "chef", "imp"]), "p1");
  const eligibility = (g: typeof initial, actor = "p0") => automationEligibility({ query: proofQuery(g), descriptor: FORTUNE_TELLER,
    roleId: "fortuneteller", actor: bind(g, actor) });
  expect(eligibility(initial).kind).toBe("automated");
  for (const scenario of ["missing", "unbound", "multiple", "epoch", "replacement"]) {
    const changed = structuredClone(initial);
    if (scenario === "missing") changed.players.p1!.effects = [];
    if (scenario === "unbound") delete changed.players.p1!.effects[0]!.parameters;
    if (scenario === "multiple") changed.players.p2!.actualRole = "fortuneteller";
    if (scenario === "epoch") changed.players.p0!.packetEpoch = "changed-away-and-back";
    if (scenario === "replacement") { changed.players.p0!.actualRole = "monk"; changed.players.p2!.actualRole = "fortuneteller"; }
    expect(eligibility(changed, scenario === "replacement" ? "p2" : "p0").kind, scenario).toBe("manual");
  }
});
