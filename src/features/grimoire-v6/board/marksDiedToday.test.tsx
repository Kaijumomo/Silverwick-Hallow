// The Godfather's and the Undertaker's official DIED TODAY tokens: derived from the Life Event Window, never stored.
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { VotingProvider } from "@/features/voting/VotingWorkspace";
import { createRulesQuery } from "@/stores/rulesQuery";
import { usePrivacyStore } from "@/stores/privacyStore";
import { patchPlayer, proofGame, proofRegistry, proofScript, reseat } from "@/test/proofFixtures";
import type { LifeEvent, StorytellerLobbyRecord } from "@/stores/types";
import { useV6Ctx } from "../ctx";
import { useV6Ui } from "../v6Store";
import { playerMarks } from "./marks";
import { useBoardVm } from "../vm/board";

// p0 godfather, p1 saint (outsider), p2 chef, p3 imp, p4 empath, p5 monk, p6 baron
const ROLES = ["godfather", "saint", "chef", "imp", "empath", "monk", "baron"];
const wrapper = ({ children }: { children: ReactNode }) => <VotingProvider>{children}</VotingProvider>;
const died = (g: StorytellerLobbyRecord, id: string, phase: "day" | "night", day: number): LifeEvent =>
  ({ id: `d-${id}-${phase}${day}`, kind: "death", moment: { phase, day }, subject: { kind: "participant", playerId: id, participantId: g.players[id]!.participantId!, nameAtTime: id }, actualRoleAtEvent: g.players[id]!.actualRole }) as LifeEvent;

function setup(phase: "day" | "night", day: number, events: (g: StorytellerLobbyRecord) => LifeEvent[], dead: string[] = ["p1"], godfatherAlive = true, roles: string[] = ROLES) {
  let g = proofGame(roles, phase, day);
  for (const id of dead) g = patchPlayer(g, id, { alive: false });
  if (!godfatherAlive) g = patchPlayer(g, "p0", { alive: false });
  g = { ...g, lifeEventWindow: { ...g.lifeEventWindow, events: events(g) } };
  store.setState({ game: g, lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
}
const label = (id: string) => renderHook(() => {
  const g = store((s) => s.game)!;
  const ctx = useV6Ctx(g);
  const query = createRulesQuery(g, { script: ctx.script!, registry: ctx.registry });
  return playerMarks({ game: g, script: ctx.script, registry: ctx.registry, query }, g.players[id]!).map((m) => m.label);
}, { wrapper }).result.current;

beforeEach(() => { usePrivacyStore.setState({ enabled: false }); useV6Ui.getState().reset(); store.getState().selectPlayer(null); });

describe("Godfather DIED TODAY token", () => {
  it("marks an Outsider who died during the Day, on that Day and through the Night that follows", () => {
    setup("day", 2, (g) => [died(g, "p1", "day", 2)]);
    expect(label("p1")).toContain("Died Today");
    setup("night", 3, (g) => [died(g, "p1", "day", 2)]);
    expect(label("p1")).toContain("Died Today");
  });

  it("is gone by the next Day", () => {
    setup("day", 3, (g) => [died(g, "p1", "day", 2)]);
    expect(label("p1")).not.toContain("Died Today");
  });

  it("does not mark an Outsider who died at night, a non-Outsider, a living Outsider, or any game without a living Godfather", () => {
    setup("day", 2, (g) => [died(g, "p1", "night", 2)]);
    expect(label("p1")).not.toContain("Died Today");
    setup("day", 2, (g) => [died(g, "p2", "day", 2)], ["p2"]);
    expect(label("p2")).not.toContain("Died Today");
    setup("day", 2, () => [], []);
    expect(label("p1")).not.toContain("Died Today");
    setup("day", 2, (g) => [died(g, "p1", "day", 2)], ["p1"], false);
    expect(label("p1")).not.toContain("Died Today");
  });
});

// The Undertaker's official DIED TODAY token: derived from the execution record while a living, real Undertaker is in play.
// p0 undertaker, p1 saint, p2 chef, p3 imp, p4 poisoner, p5 monk, p6 baron
const UT = ["undertaker", "saint", "chef", "imp", "poisoner", "monk", "baron"];
const executed = (g: StorytellerLobbyRecord, id: string, day: number, outcome: "died" | "survived" | "alreadyDead" = "died"): LifeEvent =>
  ({ id: `x-${id}-${day}`, kind: "execution", outcome, moment: { phase: "day", day }, subject: { kind: "participant", playerId: id, participantId: g.players[id]!.participantId!, nameAtTime: id }, actualRoleAtEvent: g.players[id]!.actualRole }) as LifeEvent;
const exiled = (g: StorytellerLobbyRecord, id: string, day: number): LifeEvent =>
  ({ ...executed(g, id, day), id: `e-${id}-${day}`, kind: "exile" }) as LifeEvent;
const utSetup = (phase: "day" | "night", day: number, events: (g: StorytellerLobbyRecord) => LifeEvent[], dead: string[] = ["p1"], roles: string[] = UT) =>
  setup(phase, day, events, dead, true, roles);
const titles = (id: string) => renderHook(() => {
  const g = store((s) => s.game)!;
  const ctx = useV6Ctx(g);
  const query = createRulesQuery(g, { script: ctx.script!, registry: ctx.registry });
  return playerMarks({ game: g, script: ctx.script, registry: ctx.registry, query }, g.players[id]!).map((m) => m.title);
}, { wrapper }).result.current;

describe("Undertaker DIED TODAY token", () => {
  it("marks a player executed to death, on that Day and through the Night that follows, and not by the next Day", () => {
    utSetup("day", 2, (g) => [executed(g, "p1", 2)]);
    expect(titles("p1")).toEqual(["Undertaker: Died Today"]);
    utSetup("night", 3, (g) => [executed(g, "p1", 2)]);
    expect(titles("p1")).toEqual(["Undertaker: Died Today"]);
    utSetup("day", 3, (g) => [executed(g, "p1", 2)]);
    expect(label("p1")).not.toContain("Died Today");
  });

  it("is not drawn on Night 1 or for an execution that did not kill", () => {
    utSetup("night", 1, () => []);
    expect(label("p1")).not.toContain("Died Today");
    utSetup("day", 2, (g) => [executed(g, "p1", 2, "survived")], []);
    expect(label("p1")).not.toContain("Died Today");
    utSetup("day", 2, (g) => [executed(g, "p1", 2, "alreadyDead")]);
    expect(label("p1")).not.toContain("Died Today");
  });

  it("is not drawn for a Day death that is not an execution, a night death, or a Traveller exile", () => {
    utSetup("day", 2, (g) => [died(g, "p1", "day", 2)]);
    expect(label("p1")).not.toContain("Died Today");
    utSetup("day", 2, (g) => [died(g, "p1", "night", 2)]);
    expect(label("p1")).not.toContain("Died Today");
    utSetup("day", 2, (g) => [exiled(g, "p1", 2)]);
    expect(label("p1")).not.toContain("Died Today");
  });

  it("needs a living, real Undertaker: none, a Drunk who believes it is one, a dead one, or an empty seat draw nothing", () => {
    utSetup("day", 2, (g) => [executed(g, "p1", 2)], ["p1"], ["monk", "saint", "chef", "imp", "poisoner", "empath", "baron"]);
    expect(label("p1")).not.toContain("Died Today");
    utSetup("day", 2, (g) => [executed(g, "p1", 2)], ["p1"], ["drunk", "saint", "chef", "imp", "poisoner", "monk", "baron"]);
    store.setState({ game: patchPlayer(store.getState().game!, "p0", { shownRole: "undertaker" } as never) });
    expect(label("p1")).not.toContain("Died Today");
    utSetup("day", 2, (g) => [executed(g, "p1", 2)], ["p1", "p0"]);
    expect(label("p1")).not.toContain("Died Today");
    utSetup("day", 2, (g) => [executed(g, "p1", 2)]);
    store.setState({ game: patchPlayer(store.getState().game!, "p0", { isEmpty: true } as never) });
    expect(label("p1")).not.toContain("Died Today");
  });

  it("is still drawn while the Undertaker is poisoned", () => {
    utSetup("day", 2, (g) => [executed(g, "p1", 2)]);
    const g = store.getState().game!;
    const target = { playerId: "p0", participantId: g.players.p0!.participantId! };
    expect(store.getState().resolveEffects({ intents: [{ kind: "apply", target, effect: { id: "poison", type: "poisoned", sourceCharacter: "poisoner", source: { playerId: "p4", participantId: g.players.p4!.participantId! }, lifetime: { kind: "manual" } } }] } as never).ok).toBe(true);
    expect(titles("p1")).toEqual(["Undertaker: Died Today"]);
  });

  it("sits beside the Godfather's token on an executed Outsider, and alone on an executed Townsfolk", () => {
    const withGodfather = ["undertaker", "saint", "chef", "imp", "godfather", "monk", "baron"];
    utSetup("day", 2, (g) => [executed(g, "p1", 2)], ["p1"], withGodfather);
    expect(titles("p1")).toEqual(["Godfather: Died Today", "Undertaker: Died Today"]);
    utSetup("day", 2, (g) => [executed(g, "p2", 2)], ["p2"], withGodfather);
    expect(titles("p2")).toEqual(["Undertaker: Died Today"]);
  });

  it("is drawn for an executed Spy or Recluse whatever they register as", () => {
    utSetup("day", 2, (g) => [executed(g, "p1", 2)], ["p1"], ["undertaker", "recluse", "chef", "imp", "poisoner", "monk", "baron"]);
    expect(label("p1")).toContain("Died Today");
    utSetup("day", 2, (g) => [executed(g, "p1", 2)], ["p1"], ["undertaker", "spy", "chef", "imp", "poisoner", "monk", "baron"]);
    expect(label("p1")).toContain("Died Today");
  });

  it("marks every player executed to death that Day", () => {
    utSetup("day", 2, (g) => [executed(g, "p1", 2), executed(g, "p2", 2)], ["p1", "p2"]);
    expect(label("p1")).toContain("Died Today");
    expect(label("p2")).toContain("Died Today");
  });

  it("draws nothing when the event window does not cover the Day", () => {
    utSetup("day", 2, (g) => [executed(g, "p1", 2)]);
    const g = store.getState().game!;
    store.setState({ game: { ...g, lifeEventWindow: { ...g.lifeEventWindow, coverageFrom: { phase: "night", day: 3 } } } });
    expect(label("p1")).not.toContain("Died Today");
  });

  it("follows the real execution command: drawn after it, gone after Undo, and the same after a reload of the record", () => {
    store.setState({ game: proofGame(UT, "day", 2), lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
    expect(store.getState().recordExecution("p1", "died").ok).toBe(true);
    expect(label("p1")).toContain("Died Today");
    store.setState({ game: JSON.parse(JSON.stringify(store.getState().game)) });
    expect(label("p1")).toContain("Died Today");
    store.getState().undo();
    expect(label("p1")).not.toContain("Died Today");
    store.getState().recordExecution("p1", "survived");
    expect(label("p1")).not.toContain("Died Today");
  });

  it("is a derived mark the Storyteller cannot remove by hand", () => {
    utSetup("day", 2, (g) => [executed(g, "p1", 2)]);
    const g = store.getState().game!;
    const mark = renderHook(() => {
      const ctx = useV6Ctx(g);
      return playerMarks({ game: g, script: ctx.script, registry: ctx.registry, query: createRulesQuery(g, { script: ctx.script!, registry: ctx.registry }) }, g.players.p1!)[0]!;
    }, { wrapper }).result.current;
    expect(mark.removal.type).toBe("derived");
  });

  it("is a Storyteller-only mark: the board draws it, and Privacy Mode draws no reminder discs at all", () => {
    utSetup("day", 2, (g) => [executed(g, "p1", 2)]);
    const board = () => renderHook(() => {
      const g = store((s) => s.game)!;
      return useBoardVm(useV6Ctx(g)).vm as Record<string, any>;
    }, { wrapper }).result.current;
    const token = (vm: Record<string, any>) => vm.tokens.find((t: any) => t.id === "p1");
    expect(token(board()).rems.map((r: any) => r.label)).toContain("Died Today");
    usePrivacyStore.setState({ enabled: true });
    const hidden = token(board());
    expect(hidden.rems).toEqual([]);
    expect(hidden.aria).not.toMatch(/Died Today|reminder/);
  });

  it("also hides the disc from the Details card under Privacy Mode", () => {
    utSetup("day", 2, (g) => [executed(g, "p1", 2)]);
    const card = (privacy: boolean) => {
      usePrivacyStore.setState({ enabled: privacy });
      useV6Ui.getState().reset();
      const { result } = renderHook(() => {
        const g = store((st) => st.game)!;
        return useBoardVm(useV6Ctx(g)).vm as Record<string, any>;
      }, { wrapper });
      act(() => { store.getState().selectPlayer("p1"); useV6Ui.getState().set({ card: true }); });
      return result.current.pop;
    };
    expect(card(false).rems.map((r: any) => r.label)).toContain("Died Today");
    const hidden = card(true);
    expect(hidden.open).toBe(true);
    expect(hidden.rems).toEqual([]);
  });

  it("follows the participant, not the seat: a replacement in the executed player's seat gets no disc", () => {
    utSetup("day", 2, (g) => [executed(g, "p1", 2)]);
    expect(label("p1")).toContain("Died Today");
    store.setState({ game: reseat(store.getState().game!, "p1") });
    expect(label("p1")).not.toContain("Died Today");
  });

  it("is still drawn while the Undertaker is really drunk (a Drunk Effect from a real Innkeeper)", () => {
    utSetup("day", 2, (g) => [executed(g, "p1", 2)], ["p1"], ["undertaker", "saint", "chef", "imp", "poisoner", "innkeeper", "baron"]);
    const g = store.getState().game!;
    const target = { playerId: "p0", participantId: g.players.p0!.participantId! };
    expect(store.getState().resolveEffects({ intents: [{ kind: "apply", target, effect: { id: "drunk", type: "drunk", sourceCharacter: "innkeeper", source: { playerId: "p5", participantId: g.players.p5!.participantId! }, lifetime: { kind: "manual" } } }] } as never).ok).toBe(true);
    const now = store.getState().game!;
    const query = createRulesQuery(now, { script: proofScript, registry: proofRegistry });
    expect(query.impaired({ playerId: "p0", participantId: now.players.p0!.participantId! })).toMatchObject({ known: true, value: true });
    expect(titles("p1")).toEqual(["Undertaker: Died Today"]);
  });

  it("is drawn for an executed Outsider (a Mutant) recorded through the real execution command", () => {
    store.setState({ game: proofGame(["undertaker", "mutant", "chef", "imp", "poisoner", "monk", "baron"], "day", 2), lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
    expect(store.getState().recordExecution("p1", "died").ok).toBe(true);
    expect(titles("p1")).toEqual(["Undertaker: Died Today"]);
  });
});
