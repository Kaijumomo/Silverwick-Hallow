// Replaces the retired OfficialReminderToken test (GrimoireCircle): official source art instead of custom condition
// artwork, and an Effect's display follows the current target while old-target notation stays inert notation.
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { iconUrlFor } from "@/data/iconUrl";
import { canonicalRoles } from "@/data/canonical";
import { effectIndicatorOf } from "@/stores/effectRegistry";
import { createRulesQuery } from "@/stores/rulesQuery";
import { useV6Ctx } from "../ctx";
import { playerMarks } from "./marks";

const marksOf = (id: string) => renderHook(() => {
  const game = store((s) => s.game)!;
  const ctx = useV6Ctx(game);
  const query = ctx.script ? createRulesQuery(game, { script: ctx.script, registry: ctx.registry }) : null;
  return playerMarks({ game, script: ctx.script, registry: ctx.registry, query }, game.players[id]!);
}).result.current;

beforeEach(() => {
  usePrivacyStore.setState({ enabled: false });
  const game = setupGame(["chef", "poisoner", "monk"]);
  game.players.p0!.effects = [{ id: "poison", type: "poisoned", sourceCharacter: "poisoner", state: "active", lifetime: { kind: "manual" }, expiry: { kind: "none" } }];
  store.setState({ game, lobby: null, customScripts: { [setupScript.id]: setupScript } });
});

describe("official reminder token art only", () => {
  it("draws a sourced Effect with the source character's official art, never custom condition artwork", () => {
    const [mark] = marksOf("p0");
    expect(mark).toMatchObject({ kind: "effect", label: "Poisoned", src: iconUrlFor(canonicalRoles(["poisoner"])[0]!) });
    expect(JSON.stringify(marksOf("p0"))).not.toMatch(/\/status\//);
  });

  it("no Effect indicator definition carries custom artwork", () => {
    for (const key of ["drunk", "poisoned", "protected"]) expect(effectIndicatorOf(key)).not.toHaveProperty("icon");
  });

  it("moves the display to the current target while old-target notation stays inert notation", () => {
    const game = store.getState().game!;
    const poison = game.players.p0!.effects[0]!;
    store.setState({ game: { ...game, players: { ...game.players,
      p0: { ...game.players.p0!, effects: [], reminders: [{ id: "annotation", label: "Poisoned", sourceCharacter: "poisoner" }] },
      p2: { ...game.players.p2!, effects: [poison] } } } });
    expect(marksOf("p0").map((m) => m.kind)).toEqual(["notation"]);
    expect(marksOf("p2").map((m) => [m.kind, m.label])).toEqual([["effect", "Poisoned"]]);
    expect(store.getState().game!.players.p0!.effects).toEqual([]);
    expect(store.getState().game!.players.p2!.effects).toEqual([poison]);
  });
});
