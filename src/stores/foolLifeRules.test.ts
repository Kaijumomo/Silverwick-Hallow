import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openInStore, pick, proofGame, proofRegistry, request } from "@/test/proofFixtures";
import { captureVotingContext, useStorytellerStore as store } from "./storytellerStore";
import { usePrivacyStore } from "./privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { currentVotingState, freshVotingDay } from "./voting";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "./projections";
import type { VotingIntent } from "./votingTypes";

// LS-1: the Fool's NO ABILITY token is placed through the store, with the ability use, in the same step (tokens are notation;
// abilityUsed stays the authority). https://wiki.bloodontheclocktower.com/Fool -- "mark them with the NO ABILITY reminder".
const state = () => store.getState();
const game = () => state().game!;
const tokens = () => game().players.p1!.reminders.filter(r => r.label === "No Ability" && r.sourceCharacter === "fool");
beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null });
  usePrivacyStore.getState().reset(); useSessionRuntime.setState({ backend: null, status: "idle" });
});
afterEach(() => vi.restoreAllMocks());

describe("Fool: NO ABILITY is placed with the spend", () => {
  it("a Demon attack the Fool survives places the token, nothing dies, and Undo removes both", () => {
    openInStore(proofGame(["imp", "fool", "monk", "chef"]));
    const before = game();
    expect(state().resolveAbility(request(game(), "p0", "imp", { target: pick(game(), "p1") }))).toMatchObject({ ok: true });
    expect(game().players.p1!.alive).toBe(true);
    expect(game().players.p1!.abilityUsed).toBe(true);
    expect(tokens()).toHaveLength(1);
    expect(game().lifeEventWindow.events).toEqual([]);
    state().undo();
    expect(game()).toEqual(before);
  });

  it("an execution recorded as survived places the token with the spend, and Undo removes both", () => {
    openInStore(proofGame(["imp", "fool", "monk", "chef"], "day", 2, { voting: freshVotingDay(2) }));
    const intent = { kind: "execution", target: { playerId: "p1", participantId: game().players.p1!.participantId! }, outcome: "survived",
      code: game().code, day: game().day, expectedRevision: currentVotingState(game()).revision } as VotingIntent;
    const before = game();
    expect(state().resolveVoting(intent, captureVotingContext())).toMatchObject({ ok: true });
    expect(game().players.p1!.alive).toBe(true);
    expect(game().players.p1!.abilityUsed).toBe(true);
    expect(tokens()).toHaveLength(1);
    state().undo();
    expect(game().players.p1!.abilityUsed).toBe(false);
    expect(tokens()).toEqual([]);
    expect(game().lifeEventWindow.events).toEqual(before.lifeEventWindow.events);
  });

  it("nothing about the Fool's hidden survival or the advice reaches the public or player projections", () => {
    openInStore(proofGame(["imp", "fool", "monk", "chef"]));
    expect(state().resolveAbility(request(game(), "p0", "imp", { target: pick(game(), "p1") }))).toMatchObject({ ok: true });
    const text = JSON.stringify([projectLobbyToPublic(game(), {}), projectLobbyToSelfMap(game(), proofRegistry)]);
    expect(text).not.toMatch(/survives|No Ability|abilityUsed|Fool whose/i);
  });
});

describe("execution advice is Storyteller-only", () => {
  // LS-2a: any way of loading the module counts: a static import, a side-effect import, a dynamic import(), a re-export
  // (`export ... from`), an explicit extension and a query suffix such as ?raw. Comments do not count (stripped first).
  const LOADS_ADVICE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["'`][^"'`]*\bexecutionAdvice(?:\.[cm]?[jt]sx?)?(?:\?[^"'`]*)?["'`]/;
  const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const code = (path: string) => strip(readFileSync(path, "utf8"));

  it("the pattern catches every way of loading the module (self-check)", () => {
    for (const line of [
      'import { executionAdvice } from "@/stores/executionAdvice";', "import '../stores/executionAdvice';", 'const m = await import("./executionAdvice");',
      'export { executionAdvice } from "./executionAdvice";', 'export * from "./executionAdvice.ts";', 'import raw from "./executionAdvice.ts?raw";',
      "const m = import(`@/stores/executionAdvice`);",
    ]) expect(LOADS_ADVICE.test(line), line).toBe(true);
    for (const line of ['// see import("./executionAdvice") for the note', '/* from "./executionAdvice" */', 'const name = "executionAdviceNote";', 'import { x } from "./executionAdviceExtra";'])
      expect(LOADS_ADVICE.test(strip(line)), line).toBe(false);
  });

  it("only the two Storyteller day components and the voting plan import it; no phone, player or Public Display file does", () => {
    const root = join(__dirname, "..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx|js|jsx|mts|cts)$/.test(name) && !/\.test\./.test(name) && LOADS_ADVICE.test(code(path))) hits.push(relative(root, path));
      }
    };
    walk(root);
    expect(hits.sort()).toEqual(["features/grimoire-v6/day/nomination.tsx", "features/voting/VotingWorkspace.tsx", "stores/voting.ts"]);
  });

  it("barrel guard: no index file gathers the stores, and none of the three readers passes the advice on", () => {
    for (const name of ["index.ts", "index.tsx", "index.js"]) expect(() => statSync(join(__dirname, name)), name).toThrow();
    const root = join(__dirname, "..");
    for (const file of ["features/grimoire-v6/day/nomination.tsx", "features/voting/VotingWorkspace.tsx", "stores/voting.ts"]) {
      const text = code(join(root, file));
      expect(text, file).not.toMatch(/export\s*\*\s*from/);
      expect(text, file).not.toMatch(/export\s*\{[^}]*\b(executionAdvice|ExecutionAdvice|executionSpendsAbility)\b[^}]*\}/);
    }
  });
});
