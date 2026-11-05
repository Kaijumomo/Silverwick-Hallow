// A Storyteller's mid-game Change character: an ordinary player is told it (the shown token follows); a concealed identity keeps its shown character.
import { beforeEach, describe, expect, it } from "vitest";
import { buildPicker, type PickerEnv } from "./picker";
import { useV6Ui } from "../v6Store";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { patchPlayer, proofGame, proofRegistry, proofScript } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

type Tile = { name: string; click: () => void };
const ROLES = ["imp", "poisoner", "baron", "chef", "monk", "empath", "saint"];
const game = () => store.getState().game as StorytellerLobbyRecord;

function change(playerId: string, roleName: string) {
  useV6Ui.getState().set({ picker: { mode: "choose", playerId }, pickHover: null });
  const picker = buildPicker({ game: game(), script: proofScript, registry: proofRegistry, ui: useV6Ui.getState() } as PickerEnv) as { rows: Array<{ groups: Array<{ tiles: Tile[] }> }> };
  picker.rows.flatMap((r) => r.groups.flatMap((g) => g.tiles)).find((t) => t.name === roleName)!.click();
}
beforeEach(() => {
  useV6Ui.getState().reset();
  store.setState({ game: proofGame(ROLES, "night", 2), lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
});

describe("mid-game Change character", () => {
  it("changes the real and the shown character of an ordinary player together, in one Undo step", () => {
    change("p3", "Fortune Teller");
    expect(game().players.p3!.actualRole).toBe("fortuneteller");
    expect(game().players.p3!.shownRole).toBe("fortuneteller");
    expect(store.getState().undoStack).toHaveLength(1);
    store.getState().undo();
    expect(game().players.p3!.actualRole).toBe("chef");
    expect(game().players.p3!.shownRole).toBe("chef");
  });

  it("leaves a concealed identity's shown character alone", () => {
    store.setState({ game: patchPlayer(game(), "p3", { shownRole: "empath", behaviorMode: "marionette_fake_good_behavior" }) });
    change("p3", "Fortune Teller");
    expect(game().players.p3!.actualRole).toBe("fortuneteller");
    expect(game().players.p3!.shownRole).toBe("empath");
  });
});
