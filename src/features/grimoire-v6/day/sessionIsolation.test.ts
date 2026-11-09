// WP-2 (F-06): session-local Day/Night UI memory never carries into another Offline game.
import { beforeEach, describe, expect, it } from "vitest";
import { useDayUi } from "./dayUi";
import { useNightPos } from "../night/nightPos";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";

describe("session isolation across Offline games", () => {
  beforeEach(() => { useStorytellerStore.getState().endGame(); useDayUi.setState({ more: false }); });

  it("a new game starts with the Day's options row closed", () => {
    expect(useStorytellerStore.getState().newGame("tb")).toBe(true);
    useDayUi.getState().setMore(true);
    expect(useStorytellerStore.getState().newGame("tb")).toBe(true);
    expect(useDayUi.getState().more).toBe(false);
  });

  it("the Night strip's Dawn rest of the previous game does not carry over", () => {
    useNightPos.getState().go(3, "dawn", null);
    useShellStore.getState().resetGameScope();
    expect(useNightPos.getState()).toMatchObject({ day: 0, at: null, cursor: null });
  });
});
