// @vitest-environment node
// F-20: the Gambler's guess picker shows character tokens only; every other "show" picker keeps the holders and bluff marks.
import { beforeEach, describe, expect, it } from "vitest";
import { buildPicker, type PickerEnv } from "./picker";
import { useV6Ui } from "../v6Store";
import { proofGame, proofRegistry, proofScript } from "@/test/proofFixtures";

type Tile = { name: string; hasTag: boolean; tag: string; aria?: string };
const tilesOf = (picker: unknown) => (picker as { rows: Array<{ groups: Array<{ tiles: Tile[] }> }> }).rows.flatMap((r) => r.groups.flatMap((g) => g.tiles));

describe("show picker (F-20)", () => {
  const game = { ...proofGame(["gambler", "chef", "empath", "monk", "imp", "saint", "poisoner"], "night", 2) };
  beforeEach(() => useV6Ui.getState().reset());
  const open = (extra: object) => {
    useV6Ui.getState().set({ picker: { mode: "show", title: "What does the Gambler guess?", ...extra } as never, pickHover: null });
    return buildPicker({ game, script: proofScript, registry: proofRegistry, ui: useV6Ui.getState() } as PickerEnv);
  };

  it("tokensOnly: no tile carries a player's name or a bluff mark", () => {
    const tiles = tilesOf(open({ tokensOnly: true }));
    expect(tiles.length).toBeGreaterThan(20);
    expect(tiles.filter((t) => t.hasTag)).toEqual([]);
  });

  it("the ordinary show picker still names who holds a character", () => {
    const tagged = tilesOf(open({})).filter((t) => t.hasTag);
    expect(tagged.map((t) => t.tag).join(" ")).toContain("Player");
  });
});
