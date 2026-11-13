// LS-2c: the Devil's Advocate through the store (browser storage environment): nothing reaches the projections; Undo restores.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openInStore, pick, proofGame, proofRegistry, request } from "@/test/proofFixtures";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "@/stores/projections";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import type { StorytellerLobbyRecord } from "@/stores/types";
import { SURVIVES_EXECUTION } from "./devilsadvocate";

const ROLES = ["devilsadvocate", "imp", "chef", "empath", "fool", "monk"];
const effects = (g: StorytellerLobbyRecord, id: string, type: string) => g.players[id]!.effects.filter((e) => e.type === type && e.state === "active");

describe("Devil's Advocate: privacy and Undo", () => {
  beforeEach(() => {
    store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null });
    usePrivacyStore.getState().reset(); useSessionRuntime.setState({ backend: null, status: "idle" });
  });
  afterEach(() => vi.restoreAllMocks());

  it("nothing reaches the public or player projections, and Undo restores the game", () => {
    openInStore(proofGame(ROLES, "night", 2));
    const before = store.getState().game!;
    expect(store.getState().resolveAbility(request(before, "p0", "devilsadvocate", { target: pick(before, "p2") }))).toMatchObject({ ok: true });
    const g = store.getState().game!;
    expect(effects(g, "p2", SURVIVES_EXECUTION)).toHaveLength(1);
    const text = JSON.stringify([projectLobbyToPublic(g, {}), projectLobbyToSelfMap(g, proofRegistry)]);
    expect(text).not.toMatch(/survivesExecution|devilsAdvocateChoice|Survives Execution/i);
    store.getState().undo();
    expect(store.getState().game!.players).toEqual(before.players);
  });
});
