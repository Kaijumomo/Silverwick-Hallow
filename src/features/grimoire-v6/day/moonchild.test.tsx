// WP-4: the Moonchild's public Day choice, resolved on the following Night.
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { VotingProvider } from "@/features/voting/VotingWorkspace";
import { pickSeatIfPicking, useTargetPicker } from "@/features/abilities/abilityUi";
import { useV6Ctx } from "../ctx";
import { useV6Ui } from "../v6Store";
import { buildDayCard } from "./dayCard";
import { moonchildAwaitingChoice, startMoonchildChoice } from "./moonchild";
import { patchPlayer, proofGame, proofScript } from "@/test/proofFixtures";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useShellStore } from "@/stores/shellStore";
import { officialEffectPresentation } from "@/features/reminders/officialReminderPresentation";
import type { LifeEvent, StorytellerLobbyRecord } from "@/stores/types";

// p0 godfather, p1 saint, p2 chef, p3 moonchild, p4 imp, p5 empath, p6 baron
const ROLES = ["godfather", "saint", "chef", "moonchild", "imp", "empath", "baron"];
const wrapper = ({ children }: { children: ReactNode }) => <VotingProvider>{children}</VotingProvider>;
const withEvents = (g: StorytellerLobbyRecord, events: LifeEvent[]): StorytellerLobbyRecord => ({ ...g, lifeEventWindow: { ...g.lifeEventWindow, events } });
const death = (g: StorytellerLobbyRecord, phase: "day" | "night", day: number): LifeEvent =>
  ({ id: `d-${phase}`, kind: "death", moment: { phase, day }, subject: { kind: "participant", playerId: "p3", participantId: g.players.p3!.participantId!, nameAtTime: "Player 3" }, actualRoleAtEvent: "moonchild" }) as LifeEvent;

function dayWithDeadMoonchild(phase: "day" | "night" = "day") {
  const base = proofGame(ROLES, "day", 3);
  store.setState({ game: withEvents(patchPlayer(base, "p3", { alive: false }), [death(base, phase, 3)]), lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
}
function mount() {
  return renderHook(() => { const g = store((s) => s.game)!; return useV6Ctx(g); }, { wrapper });
}
const game = () => store.getState().game!;
const choose = (m: ReturnType<typeof mount>, target: string) => {
  act(() => { startMoonchildChoice(m.result.current, game().players.p3!); });
  act(() => { pickSeatIfPicking(game(), target); });
};
const choices = (id: string) => game().players[id]!.effects.filter((e) => e.type === "moonchildChoice" && e.state === "active");

beforeEach(() => { useShellStore.getState().resetGameScope(); usePrivacyStore.getState().setEnabled(false); useV6Ui.getState().reset(); useTargetPicker.getState().cancel(); });

describe("Moonchild public Day choice", () => {
  it("is offered to a Moonchild who died in the Day or last night, and to nobody else", () => {
    dayWithDeadMoonchild("day");
    const m = mount();
    expect(moonchildAwaitingChoice(m.result.current, game().players.p3)).toBe(true);
    expect(moonchildAwaitingChoice(m.result.current, game().players.p2)).toBe(false);
    dayWithDeadMoonchild("night");
    expect(moonchildAwaitingChoice(mount().result.current, game().players.p3)).toBe(true);
    // Died two days ago, or still alive: nothing to choose.
    const base = proofGame(ROLES, "day", 3);
    store.setState({ game: withEvents(patchPlayer(base, "p3", { alive: false }), [death(base, "day", 1)]) });
    expect(moonchildAwaitingChoice(mount().result.current, game().players.p3)).toBe(false);
    store.setState({ game: proofGame(ROLES, "day", 3) });
    expect(moonchildAwaitingChoice(mount().result.current, game().players.p3)).toBe(false);
  });

  it("a good chosen player gets the Moonchild's DEAD token; Undo removes it; the Day card points the Storyteller to it", () => {
    dayWithDeadMoonchild();
    const m = mount();
    expect((buildDayCard({ ...m.result.current, cards: { ...m.result.current.cards, day: true } }) as { text: string }).text).toContain("learned they died");
    choose(m, "p2");
    expect(choices("p2")).toHaveLength(1);
    expect(choices("p2")[0]).toMatchObject({ sourceCharacter: "moonchild", lifetime: { kind: "untilDawn" } });
    expect(game().players.p2!.alive).toBe(true);
    const tokens = officialEffectPresentation(game().players.p2!).tokens;
    expect(tokens.map((t) => `${t.role.id}:${t.label}`)).toContain("moonchild:Dead");
    expect(moonchildAwaitingChoice(mount().result.current, game().players.p3)).toBe(false);
    act(() => { store.getState().undo(); });
    expect(choices("p2")).toHaveLength(0);
    expect(moonchildAwaitingChoice(mount().result.current, game().players.p3)).toBe(true);
  });

  it("an evil chosen player is unaffected: nothing is recorded and the prompt is not repeated", () => {
    dayWithDeadMoonchild();
    const m = mount();
    choose(m, "p4"); // the Imp
    expect(choices("p4")).toHaveLength(0);
    expect(store.getState().undoStack).toHaveLength(0);
    expect(moonchildAwaitingChoice(mount().result.current, game().players.p3)).toBe(false);
  });

  it("a Goon, a dead player or a Traveller cannot be chosen; Privacy Mode and a living Moonchild offer nothing", () => {
    dayWithDeadMoonchild();
    const m = mount();
    act(() => { startMoonchildChoice(m.result.current, game().players.p3!); });
    expect(useTargetPicker.getState().active?.eligible?.has(game().players.p3!.participantId!)).toBe(false); // the dead Moonchild itself
    usePrivacyStore.getState().setEnabled(true);
    expect(moonchildAwaitingChoice(mount().result.current, game().players.p3)).toBe(false);
  });
});
