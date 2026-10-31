// SOL-10F-L6: prose-derived RoleDef.oncePerGame is reference metadata only.
// Usage authority is a VERIFIED AbilityDescriptor (`usage`), enforced by the
// coordinator; generic Night code never suppresses or authorizes an ability
// because ability prose matched "Once per game".
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { computeNightOrder } from "@/features/nightOrder/nightOrder";
import { NightScreen, resetNightUi, selectNightStep } from "@/features/grimoire-v6/night/port/v6Night";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { canonicalRoles } from "@/data/canonical";
import { buildRegistry } from "@/data/roleRegistry";
import { makeSTPlayer } from "@/test/fixtures";
import { FIXTURE_SEMANTICS } from "@/test/abilityFixtures";
import { captureFingerprint, planAbilityResolution } from "@/stores/abilityResolution";
import { usePrivacyStore } from "@/stores/privacyStore";
import { stripCommentsForGuard as stripComments } from "@/test/writerGuard";
import type { Script, StorytellerLobbyRecord } from "@/stores/types";

const script: Script = { id: "opg", name: "Once per game", characters: canonicalRoles(["seamstress", "slayer", "chef", "imp"]) };
const registry = buildRegistry(script);
afterEach(cleanup);

function game(phase: "night" | "day"): StorytellerLobbyRecord {
  const roles = ["seamstress", "slayer", "chef", "imp"];
  const players = roles.map((actualRole, seat) => makeSTPlayer({ id: `p${seat}`, name: `P${seat}`, seat, actualRole, shownRole: actualRole,
    actualAlignment: registry.alignmentOf(actualRole), abilityUsed: true }));
  return { gameSchemaVersion: 29, preparedInformation: [], playerInfoLog: [], gameRuleFacts: [], code: "", storytellerUid: "local", scriptId: script.id, phase, day: 2,
    players: Object.fromEntries(players.map((p) => [p.id, p])), seatOrder: players.map((p) => p.id), plannedPlayerCount: 4, plannedTravelerCount: 0,
    rolePool: [], fabled: [], lorics: [], bluffs: [], notes: "", nightProgress: {}, pendingPlayers: {}, history: [], informationDeliveries: [],
    lifeEventWindow: { coverageFrom: { phase: "night", day: 1 }, events: [] }, setupRolesDealt: true, setupRolesRevealed: true };
}

describe("SOL-10F-L6: oncePerGame authority", () => {
  it("an unverified character whose prose says 'Once per game' stays visible / manual after abilityUsed = true", () => {
    expect(registry.get("seamstress")!.oncePerGame).toBe(true); // the prose-derived reference flag
    const g = game("night");
    const steps = computeNightOrder(g.players, g.seatOrder, script, false, g);
    expect(steps).toContainEqual(expect.objectContaining({ kind: "player", effectiveRoleId: "seamstress", abilityUsed: true }));
    usePrivacyStore.setState({ enabled: false });
    // The unified Night card keeps the step visible and wholly manual: official text, no guided action.
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    useStorytellerStore.setState({ game: g, lobby: null, undoStack: [], localSeq: 0, customScripts: { [script.id]: script } });
    resetNightUi();
    render(<NightScreen />);
    selectNightStep("p0");
    expect(screen.getByText(registry.get("seamstress")!.ability!)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue action" })).toBeNull();
    vi.unstubAllGlobals();
  });

  it("a VERIFIED descriptor with usage oncePerGame is notApplicable once used (descriptor authority)", () => {
    const g = game("day");
    const result = planAbilityResolution(g, { mode: "guided", invocationPath: "dayEntry", fingerprint: captureFingerprint(g, "p1")!, roleId: "slayer",
      inputs: { target: { kind: "participant", participants: [{ playerId: "p3", participantId: g.players.p3!.participantId! }] } } },
    { script, registry, semantics: FIXTURE_SEMANTICS, modifiers: [] });
    expect(result).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("no production module reads RoleDef.oncePerGame as a property; generic Night / ability modules mention it only as descriptor usage", () => {
    const SRC = resolve(__dirname, "..");
    const sources = (dir = SRC): string[] => readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === "test" || name === "node_modules" ? [] : sources(path);
      return /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) ? [relative(SRC, path).split("\\").join("/")] : [];
    });
    const code = (m: string) => stripComments(readFileSync(join(SRC, m), "utf8"));
    expect(sources().filter((m) => /\.oncePerGame\b|\[\s*["']oncePerGame["']\s*\]/.test(code(m)))).toEqual([]);
    const generic = sources().filter((m) => m.startsWith("features/nightOrder/") || m.startsWith("features/abilities/") || m.startsWith("abilities/") ||
      ["stores/abilityResolution.ts", "stores/rulesQuery.ts", "stores/wakeIdentity.ts"].includes(m));
    for (const m of generic) {
      const bare = [...code(m).matchAll(/oncePerGame/g)].filter((match) => code(m)[match.index! - 1] !== '"');
      expect(bare, m).toEqual([]);
    }
    // Planted mechanical read is detected (self-check).
    expect(/\.oncePerGame\b/.test("if (roleDef.oncePerGame && player.abilityUsed) continue;")).toBe(true);
  });
});
