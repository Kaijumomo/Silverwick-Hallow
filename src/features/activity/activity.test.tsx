// Phase 10G, Slice 3: Storyteller Activity + Information Delivery review /
// removal + the Manual workspace "Information told" step (PHASE10G Sections
// 12.4, 13). Traceability: 10G-AC-15..17, 10G-AC-20..22, 10G-AC-31 (Activity);
// proof areas 7 and 9.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { NightOrderPanel } from "@/features/nightOrder/NightOrderPanel";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { stripCommentsForGuard as stripComments } from "@/test/writerGuard";
import { buildRegistry } from "@/data/roleRegistry";
import { PIT_HAG_ARBITRARY_DEATHS } from "@/stores/gameRuleFacts";
import { ActivityPanel } from "./ActivityPanel";
import { buildActivity, describeHistoryRecord } from "./activity";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { GameHistoryRecord, GameInformationDeliveryRecord } from "@/stores/types";
import { chosen } from "@/test/pickers";

const state = () => store.getState();
const game = () => state().game!;
const registry = buildRegistry(setupScript);
// p0 monk, p1 slayer, p2 empath, p3 pithag, p4 imp, p5 chef, p6 drunk (shown as the Empath)
const ROLES = ["monk", "slayer", "empath", "pithag", "imp", "chef", "drunk"];
const NAMES = ["Alice", "Bob", "Carol", "Dave", "Eve", "Finn", "Gail"];

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ backend: null });
  const g = setupGame(ROLES, { phase: "night", day: 2, setupRolesDealt: true, setupRolesRevealed: true });
  for (const [index, p] of Object.values(g.players).entries()) { p.actualAlignment = registry.alignmentOf(p.actualRole); p.name = NAMES[index]!; }
  g.players.p6 = { ...g.players.p6!, shownRole: "empath", shownAlignment: null, behaviorMode: "drunk_fake_role_behavior" };
  store.setState({ game: g, lobby: null, undoStack: [], localSeq: 0, customScripts: { [setupScript.id]: setupScript }, selectedPlayerId: null });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const bind = (id: string): ParticipantBinding => ({ playerId: id, participantId: game().players[id]!.participantId! });
const category = (item: { record: unknown }) => (item.record as GameHistoryRecord).category;
const deliveryKind = (item: { record: unknown }) => (item.record as GameInformationDeliveryRecord).kind;

/** A small, realistic Activity: an uncorrelated death, a correlated manual
 * resolution (death + information told), a structured delivery, a game fact,
 * then a Day-moment change. */
function populate() {
  state().recordDeath("p0");
  state().resolveAbility({ mode: "manual", reason: "Homebrew", roleId: "chef", outcome: { operations: [
    { domain: "life", intents: [{ kind: "death", target: bind("p1") }] },
    { domain: "manualInformation", recipient: bind("p5"), text: "Thumbs down" },
  ] } });
  state().recordInformationDelivery("p2", "empath-other-night", [{ requirementId: "evilNeighbors", kind: "number", value: 1 }]);
  state().resolveGameRuleFacts({ intents: [{ kind: "apply", type: PIT_HAG_ARBITRARY_DEATHS }] });
  state().advancePhase();
  state().setAbilityUsed("p4", true);
}

describe("10G-AC-15 / AC-16 / AC-17: honest Activity derivation", () => {
  it("groups by moment (newest first), keeps one resolution together, and never interleaves the two sources", () => {
    populate();
    const groups = buildActivity(game());
    expect(groups.map((g) => g.label)).toEqual(["Day 2", "Night 2"]);
    const night = groups[1]!;
    expect(night.resolutions).toHaveLength(1);
    expect(night.resolutions[0]!.changes.map(category)).toEqual(["life"]);
    expect(night.resolutions[0]!.told.map(deliveryKind)).toEqual(["manual"]);
    // Uncorrelated records stay in their own source lists, in source order.
    expect(night.changes.map(category)).toEqual(["life", "gameRuleFact"]);
    expect(night.told.map((i) => i.source)).toEqual(["delivery"]);
    // The Day group holds the fact's expiry and the ability use.
    expect(groups[0]!.changes.map(category)).toEqual(["gameRuleFact", "life"]);
  });

  it("filters by participant, kind and moment; game-scoped records have no participant", () => {
    populate();
    const alice = `p:${game().players.p0!.participantId}`;
    expect(buildActivity(game(), { participant: alice }).flatMap((g) => g.changes.map(category))).toEqual(["life"]);
    expect(buildActivity(game(), { category: "gameRuleFact" }).flatMap((g) => g.changes.map(category))).toEqual(["gameRuleFact", "gameRuleFact"]);
    expect(buildActivity(game(), { category: "information" }).flatMap((g) => [...g.told, ...g.resolutions.flatMap((r) => r.told)])).toHaveLength(2);
    expect(buildActivity(game(), { moment: String(3) }).map((g) => g.label)).toEqual(["Night 2"]); // Night 2 ordinal is 3
  });

  it("describes a participant-less game-fact record without inventing anyone", () => {
    populate();
    const fact = game().history.find((h) => h.category === "gameRuleFact")!;
    expect(describeHistoryRecord(fact, registry)).toBe("Game rule fact recorded: Arbitrary deaths tonight");
  });
});

describe("Activity panel (Storyteller-private)", () => {
  const open = (readOnly = false) => render(<ActivityPanel game={game()} registry={registry} readOnly={readOnly} onClose={() => {}} />);

  it("shows Changes and Information told from one surface, grouped honestly", () => {
    populate();
    open();
    const dialog = screen.getByRole("dialog", { name: "Activity" });
    expect(within(dialog).getByRole("region", { name: "Night 2" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Alice: died");
    expect(dialog).toHaveTextContent("Eve: ability marked used");
    expect(dialog).toHaveTextContent('Finn (Chef) was told (manual): "Thumbs down"');
    expect(dialog).toHaveTextContent("Carol (Empath) was told: 1");
    expect(dialog).toHaveTextContent("Game rule fact recorded: Arbitrary deaths tonight");
    expect(dialog).toHaveTextContent("Game rule fact expired: Arbitrary deaths tonight");
    expect(within(dialog).getAllByText("One resolution")).toHaveLength(1);
    expect(dialog).toHaveTextContent(/order between these changes and the information told is not recorded/);
  });

  it("10G-AC-22: removes an OLDER (non-latest) delivery record, with copy that it cannot unsay anything", () => {
    populate();
    const [manual, structured] = game().informationDeliveries;
    const { rerender } = open();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Remove the record: Finn/ }));
    expect(dialog).toHaveTextContent("Removing the stored record does not undo or unsay what was already communicated.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove record" }));
    expect(game().informationDeliveries).toEqual([structured]);
    expect(game().informationDeliveries).not.toContainEqual(manual);
    rerender(<ActivityPanel game={game()} registry={registry} onClose={() => {}} />);
    expect(screen.getByRole("dialog")).not.toHaveTextContent("Thumbs down");
  });

  it("a read-only (ended) review mounts no removal control", () => {
    populate();
    open(true);
    expect(screen.getByRole("dialog", { name: "Activity (final)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  });

  it("proof area 9: under Privacy Mode the panel and all its content are absent from the DOM and never reopen", () => {
    populate();
    const onClose = vi.fn();
    render(<ActivityPanel game={game()} registry={registry} onClose={onClose} />);
    act(() => usePrivacyStore.getState().setEnabled(true));
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body).not.toHaveTextContent(/Thumbs down|Game rule fact|Alice/);
    act(() => usePrivacyStore.getState().setEnabled(false));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("10G-AC-20: the Manual workspace's Information told step", () => {
  it("records bounded text through resolveAbility in the same atomic resolution", () => {
    render(<NightOrderPanel game={game()} script={setupScript} onClose={() => {}} />);
    // The Drunk shown as the Empath (Gail): Guide, then switch to Manual.
    const gail = screen.getAllByText("Empath", { selector: ".step-role-name" }).map((el) => el.closest(".step-card") as HTMLElement)
      .find((el) => el.querySelector(".step-player-name")?.textContent?.startsWith("Gail ·"))!;
    fireEvent.click(within(gail).getByRole("button", { name: "Guide" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Resolve manually / unmodeled interaction" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Reason for manual resolution" }), { target: { value: "Spoken answer" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "+ Information told" }));
    // Defaults to the workflow's actor.
    expect(chosen("Step 1 player", dialog)).toBe("p6");
    expect(dialog).toHaveTextContent("Recorded as the Empath procedure performed (simulated wake).");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Step 1 information told" }), { target: { value: "You learn 2." } });
    expect(within(dialog).getByRole("region", { name: "Result" })).toHaveTextContent('Record what Gail was told (manual): "You learn 2." -- as the Empath');
    const before = state().undoStack.length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm and record" }));
    expect(state().undoStack).toHaveLength(before + 1);
    expect(game().informationDeliveries).toEqual([expect.objectContaining({ kind: "manual", text: "You learn 2.", actualRole: "drunk", performedRole: "empath" })]);
    expect(game().nightProgress[`2:p:${game().players.p6!.participantId}:empath`]?.status).toBe("done");
  });
});

describe("10G-AC-21 / proof area 7: Activity and deliveries are never mechanical sources", () => {
  const root = resolve(__dirname, "../..");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) files.push(path);
    }
  };
  walk(join(root, "stores"));
  walk(join(root, "abilities"));
  const rel = (file: string) => relative(root, file).split(sep).join("/");

  it("no store / rules / ability module imports the Activity presentation", () => {
    const importers = files.filter((file) => /features\/activity/.test(stripComments(readFileSync(file, "utf8")))).map(rel);
    expect(importers).toEqual([]);
  });

  it("Rules Query and every ability module never read Information Delivery or History", () => {
    const mechanical = files.filter((file) => /stores\/rulesQuery\.ts$|abilities\//.test(rel(file)));
    expect(mechanical.length).toBeGreaterThan(5);
    for (const file of mechanical) {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code, rel(file)).not.toMatch(/\.informationDeliveries\b/);
      expect(code, rel(file)).not.toMatch(/\.history\b/);
    }
  });

  it("the Rule Fact seam only APPENDS History (in its one application function) and never reads deliveries", () => {
    const code = stripComments(readFileSync(join(root, "stores/gameRuleFacts.ts"), "utf8"));
    expect(code).not.toMatch(/informationDeliveries/);
    // Exactly the one append expression -- `[...game.history, ...plan.history]`.
    expect(code.match(/\.history\b/g)).toEqual([".history", ".history"]);
    expect(code).toMatch(/history: \[\.\.\.game\.history, \.\.\.plan\.history\]/);
  });
});
