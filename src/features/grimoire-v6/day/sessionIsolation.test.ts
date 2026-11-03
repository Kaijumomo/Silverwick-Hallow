// WP-2 (F-06): session-local Day/Night UI memory never carries into another Offline game.
import { beforeEach, describe, expect, it } from "vitest";
import { useDayUi } from "./dayUi";
import { useNightPos } from "../night/nightPos";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";

const shot = { code: "", day: 1, shooter: "Ann", target: "Bo", dies: false, real: true };

describe("session isolation across Offline games", () => {
  beforeEach(() => { useStorytellerStore.getState().endGame(); useDayUi.setState({ more: false, log: [] }); });

  it("a new game starts with no Slayer shots, although both games share the room code \"\"", () => {
    expect(useStorytellerStore.getState().newGame("tb")).toBe(true);
    useDayUi.getState().addLog(shot);
    expect(useDayUi.getState().log).toHaveLength(1);
    expect(useStorytellerStore.getState().newGame("tb")).toBe(true);
    expect(useDayUi.getState().log).toEqual([]);
  });

  it("ending or discarding a game clears them, and the shots of the open game are kept while it is played", () => {
    useStorytellerStore.getState().newGame("tb");
    useDayUi.getState().addLog(shot);
    useDayUi.getState().addLog({ ...shot, day: 2 });
    expect(useDayUi.getState().log).toHaveLength(2);
    useStorytellerStore.getState().endGame();
    expect(useDayUi.getState().log).toEqual([]);
  });

  it("the Night strip's Dawn rest of the previous game does not carry over", () => {
    useNightPos.getState().go(3, "dawn", null);
    useShellStore.getState().resetGameScope();
    expect(useNightPos.getState()).toMatchObject({ day: 0, at: null, cursor: null });
  });
});
