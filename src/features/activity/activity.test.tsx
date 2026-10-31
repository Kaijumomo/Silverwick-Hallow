// Phase 10G, Slice 3: the Manual workspace "Information told" step and the rule that Activity / deliveries are never
// mechanical sources (PHASE10G Sections 12.4, 13). Traceability: 10G-AC-20, 10G-AC-21; proof area 7.
//
// Package 4: the Activity panel and its derivation (activity.ts) are retired, along with the Night Order dashboard
// that hosted the Manual step. History and Information Deliveries are still RECORDED in the store; only the Storyteller-facing
// review surface is gone (see the Gate 2 retirement ledger). The recording and the architecture guards stay.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { stripCommentsForGuard as stripComments } from "@/test/writerGuard";
import { buildRegistry } from "@/data/roleRegistry";
import { captureFingerprint, type ParticipantBinding } from "@/stores/abilityResolution";
import { participantStepKey } from "@/stores/nightProgress";

const state = () => store.getState();
const game = () => state().game!;
const registry = buildRegistry(setupScript);
// p0 monk, p1 slayer, p2 empath, p3 pithag, p4 imp, p5 chef, p6 drunk (shown as the Empath)
const ROLES = ["monk", "slayer", "empath", "pithag", "imp", "chef", "drunk"];
const NAMES = ["Alice", "Bob", "Carol", "Dave", "Eve", "Finn", "Gail"];

beforeEach(() => {
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ backend: null });
  const g = setupGame(ROLES, { phase: "night", day: 2, setupRolesDealt: true, setupRolesRevealed: true });
  for (const [index, p] of Object.values(g.players).entries()) { p.actualAlignment = registry.alignmentOf(p.actualRole); p.name = NAMES[index]!; }
  g.players.p6 = { ...g.players.p6!, shownRole: "empath", shownAlignment: null, behaviorMode: "drunk_fake_role_behavior" };
  store.setState({ game: g, lobby: null, undoStack: [], localSeq: 0, customScripts: { [setupScript.id]: setupScript }, selectedPlayerId: null });
});
afterEach(cleanup);

const bind = (id: string): ParticipantBinding => ({ playerId: id, participantId: game().players[id]!.participantId! });

describe("10G-AC-20: the Manual workspace's Information told step", () => {
  it("records bounded text through resolveAbility in the same atomic resolution", () => {
    // The Drunk shown as the Empath (Gail): a manual outcome that tells her what the Storyteller said.
    const stepKey = participantStepKey(game().players.p6!.participantId!, "empath");
    const before = state().undoStack.length;
    const result = state().resolveAbility({ mode: "manual", reason: "Spoken answer", roleId: "empath", completeStep: true,
      fingerprint: captureFingerprint(game(), "p6", { day: 2, stepKey })!,
      outcome: { operations: [{ domain: "manualInformation", recipient: bind("p6"), text: "You learn 2.", performedRole: "empath" }] } } as never);
    expect(result.ok).toBe(true);
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
