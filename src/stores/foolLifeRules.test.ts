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

  it("an execution recorded as survived places the token with the spend; a second survival is not offered again", () => {
    openInStore(proofGame(["imp", "fool", "monk", "chef"], "day", 2, { voting: freshVotingDay(2) }));
    const intent = { kind: "execution", target: { playerId: "p1", participantId: game().players.p1!.participantId! }, outcome: "survived",
      code: game().code, day: game().day, expectedRevision: currentVotingState(game()).revision } as VotingIntent;
    expect(state().resolveVoting(intent, captureVotingContext())).toMatchObject({ ok: true });
    expect(game().players.p1!.alive).toBe(true);
    expect(game().players.p1!.abilityUsed).toBe(true);
    expect(tokens()).toHaveLength(1);
  });

  it("nothing about the Fool's hidden survival or the advice reaches the public or player projections", () => {
    openInStore(proofGame(["imp", "fool", "monk", "chef"]));
    expect(state().resolveAbility(request(game(), "p0", "imp", { target: pick(game(), "p1") }))).toMatchObject({ ok: true });
    const text = JSON.stringify([projectLobbyToPublic(game(), {}), projectLobbyToSelfMap(game(), proofRegistry)]);
    expect(text).not.toMatch(/survives|No Ability|abilityUsed|Fool whose/i);
  });
});

describe("execution advice is Storyteller-only", () => {
  it("only the two Storyteller day components import it; no phone, player or Public Display file does", () => {
    const root = join(__dirname, "..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) && /executionAdvice/.test(readFileSync(path, "utf8"))) hits.push(relative(root, path));
      }
    };
    walk(root);
    expect(hits.sort()).toEqual(["features/grimoire-v6/day/nomination.tsx", "features/voting/VotingWorkspace.tsx", "stores/executionAdvice.ts", "stores/voting.ts"]);
  });
});
