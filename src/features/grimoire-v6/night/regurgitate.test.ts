// WP-6: the Shabaloth's Dusk regurgitation (command level; the board tap is the Night engine's picker).
import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { createRulesQuery } from "@/stores/rulesQuery";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import { bind, patchPlayer, pick, plan, planned, proofGame, proofRegistry, proofScript, request } from "@/test/proofFixtures";
import { duskRegurgitation, regurgitate } from "./regurgitate";
import type { StorytellerLobbyRecord } from "@/stores/types";

// p0 shabaloth, p1 chef, p2 empath, p3 monk, p4 saint, p5 baron, p6 poisoner
const ROLES = ["shabaloth", "chef", "empath", "monk", "saint", "baron", "poisoner"];
const query = (g: StorytellerLobbyRecord) => createRulesQuery(g, { registry: proofRegistry, script: proofScript, semantics: CANONICAL_ABILITY_SEMANTICS, modifiers: [] });
const game = () => store.getState().game!;
const tokens = (id: string, type: string) => game().players[id]!.effects.filter((e) => e.type === type && e.state === "active");

function duskOfNight3(mutate?: (g: StorytellerLobbyRecord) => StorytellerLobbyRecord) {
  const n2 = { ...proofGame(ROLES), day: 2 } as StorytellerLobbyRecord;
  const killed = planned(plan(n2, request(n2, "p0", "shabaloth", { targets: pick(n2, "p1", "p2") })));
  const dusk = { ...killed, day: 3 } as StorytellerLobbyRecord;
  store.setState({ game: mutate ? mutate(dusk) : dusk, lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
}

describe("Shabaloth regurgitation (WP-6)", () => {
  beforeEach(() => duskOfNight3());

  it("offers last night's chosen dead players and nobody else", () => {
    expect(duskRegurgitation(game(), query(game()))?.candidates.map((c) => c.target.playerId).sort()).toEqual(["p1", "p2"]);
  });

  it("brings the player back with vote and ability restored, swaps DEAD for ALIVE, and the other stays dead with its DEAD token", () => {
    duskOfNight3((g) => patchPlayer(g, "p1", { abilityUsed: true }));
    expect(regurgitate(query(game()), game(), bind(game(), "p1"))).toEqual({ ok: true });
    const p1 = game().players.p1!;
    expect(p1).toMatchObject({ alive: true, ghostVote: true, abilityUsed: false });
    expect(tokens("p1", "shabalothChosen")).toHaveLength(0);
    expect(tokens("p1", "shabalothAlive")).toHaveLength(1);
    expect(game().players.p2!.alive).toBe(false);
    expect(tokens("p2", "shabalothChosen")).toHaveLength(1);
    expect(StorytellerGamePersistedSchema.safeParse(JSON.parse(JSON.stringify(game()))).success).toBe(true);
  });

  it("only one player a night, and never someone who is alive or was not chosen last night", () => {
    expect(regurgitate(query(game()), game(), bind(game(), "p1")).ok).toBe(true);
    expect(duskRegurgitation(game(), query(game()))).toBeNull();
    expect(regurgitate(query(game()), game(), bind(game(), "p2"))).toMatchObject({ ok: false });
    expect(regurgitate(query(game()), game(), bind(game(), "p3"))).toMatchObject({ ok: false });
    expect(game().players.p2!.alive).toBe(false);
  });

  it("Undo restores the dead player and the DEAD token (two commands, reversed in order)", () => {
    const before = structuredClone(game());
    regurgitate(query(game()), game(), bind(game(), "p1"));
    store.getState().undo();
    store.getState().undo();
    expect(game()).toEqual(before);
  });

  it("a refused second step rolls the revival back", () => {
    const real = store.getState().resolveEffects;
    store.setState({ resolveEffects: () => ({ ok: false, code: "invalid", message: "No." }) as never });
    const before = structuredClone(game());
    expect(regurgitate(query(game()), game(), bind(game(), "p1"))).toMatchObject({ ok: false, message: "No." });
    store.setState({ resolveEffects: real });
    expect(game()).toEqual(before);
  });

  it("regurgitate then re-kill: the Shabaloth chooses the same player again and the token follows", () => {
    regurgitate(query(game()), game(), bind(game(), "p1"));
    const g = game();
    const again = planned(plan(g, request(g, "p0", "shabaloth", { targets: pick(g, "p1", "p3") })));
    expect(again.players.p1!.alive).toBe(false);
    expect(again.players.p1!.effects.filter((e) => e.type === "shabalothAlive")).toHaveLength(0);
    expect(again.players.p1!.effects.filter((e) => e.type === "shabalothChosen")).toHaveLength(1);
    expect(again.players.p2!.effects.filter((e) => e.type === "shabalothChosen")).toHaveLength(0);
  });
});
