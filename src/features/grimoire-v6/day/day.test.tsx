import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { VotingProvider } from "@/features/voting/VotingWorkspace";
import { currentVotingState } from "@/stores/voting";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useV6Ctx } from "../ctx";
import { useV6Ui } from "../v6Store";
import { useGrimoireVm } from "../useGrimoireVm";
import { useDayVm } from "../vm/day";
import { dayTokenDecor, dayTokenTap } from "./tokens";
import { evaluateSlayerShot } from "./slayer";
import { impair, patchPlayer, proofGame, proofScript } from "@/test/proofFixtures";
import { buildDayTown, type DayTown } from "@/test/dayFixture";

const wrapper = ({ children }: { children: ReactNode }) => <VotingProvider>{children}</VotingProvider>;
const store = () => useStorytellerStore.getState();
const game = () => store().game!;

let town: DayTown;
beforeEach(() => {
  usePrivacyStore.getState().setEnabled(false);
  useV6Ui.getState().reset();
  town = buildDayTown(2);
});

function mount() {
  return renderHook(() => {
    const g = useStorytellerStore((s) => s.game)!;
    const ctx = useV6Ctx(g);
    const day = useDayVm(ctx);
    return { ctx, day };
  }, { wrapper });
}
type Mounted = ReturnType<typeof mount>;
const ns = (m: Mounted) => m.result.current.day.vm.ns as Record<string, any>;
const tap = (m: Mounted, name: string) => act(() => { m.result.current.ctx.voting!.tap(town.ids[name]!); });
const nominate = (m: Mounted) => act(() => { (m.result.current.day.pill as any).nominate(); });
const respond = (m: Mounted, choice: "yes" | "no") => act(() => { (ns(m)[choice === "yes" ? "onYes" : "onNo"])(); });

/** Opens nominations and runs one full vote: `nominator` accuses `nominee`; `yes` answers per voter, in order. */
function runVote(m: Mounted, nominator: string, nominee: string, yes: (index: number) => boolean) {
  if (!m.result.current.ctx.voting!.open) nominate(m);
  tap(m, nominator);
  tap(m, nominee);
  act(() => { ns(m).begin(); });
  const order = currentVotingState(game()).rounds.at(-1)!.order.length;
  for (let i = 0; i < order; i++) respond(m, yes(i) ? "yes" : "no");
}

describe("Day card", () => {
  it("opens from the Day panel with the living count and the Slayer's row", () => {
    useV6Ui.getState().set({ panel: "night" });
    const m = mount();
    const c = m.result.current.day.vm.dayC as Record<string, any>;
    expect(c).toMatchObject({ on: true, kicker: "Day II", sub: "0 nominated today", hasBlock: false, title: "No one is on the block", text: "6 votes are needed to put a nominee on the block." });
    expect(m.result.current.day.vm.sv).toMatchObject({ status: "Unused", holderText: "Kestrel", btnText: "Take a shot", open: false });
  });

  it("is hidden while a nomination or a shot is open, and never exists outside the Day", () => {
    useV6Ui.getState().set({ panel: "night" });
    const m = mount();
    nominate(m);
    expect((m.result.current.day.vm.dayC as any).on).toBe(false);
    act(() => { store().setPhase("night"); });
    expect(m.result.current.day.advance).toBeUndefined();
  });
});

describe("nominations and the vote", () => {
  it("walks nominator, nominee, accusation, vote and verdict through the Voting engine", () => {
    const m = mount();
    nominate(m);
    expect(ns(m)).toMatchObject({ cardOn: true, slots: true, kicker: "Day 2 · Nomination 1", s1: "Tap a player", s2: "—" });
    tap(m, "Bram");
    expect(ns(m)).toMatchObject({ s1: "Bram", s2: "Tap a player" });
    tap(m, "Greta");
    expect(ns(m)).toMatchObject({ accuse: true, s2: "Greta" });
    act(() => { ns(m).begin(); });
    expect(ns(m)).toMatchObject({ vote: true, voterKicker: "Now voting", voterName: m.result.current.ctx.voting!.voter!.nameAtTime, need: 6, yes: 0 });
    // Tapping the glowing voter's token counts a Yes (the board's seat tap goes through the Day).
    const first = m.result.current.ctx.voting!.voter!;
    act(() => { dayTokenTap(m.result.current.ctx, first.playerId); });
    expect(currentVotingState(game()).rounds[0]!.responses[0]).toMatchObject({ choice: "yes" });
    expect(ns(m).yes).toBe(1);
    act(() => { ns(m).undo(); });
    expect(ns(m).yes).toBe(0);
  });

  it("puts the nominee on the block with enough votes and shows it on the dock", () => {
    const m = mount();
    runVote(m, "Bram", "Greta", (i) => i < 7);
    expect(ns(m)).toMatchObject({ result: true, resultTitle: "Greta is on the block", resultSub: "7 votes, 6 needed.", nextText: "Next nomination" });
    act(() => { ns(m).next(); });
    expect((m.result.current.day.pill as any)).toMatchObject({ blockOn: true, blockText: "On the block · 7" });
    expect(m.result.current.day.advance!.text).toBe("Execute Greta");
  });

  it("a short vote spares the nominee; a later tie clears the block", () => {
    const m = mount();
    runVote(m, "Bram", "Greta", (i) => i < 2);
    expect(ns(m)).toMatchObject({ resultTitle: "Greta is spared", resultSub: "2 of 6 votes needed." });
    act(() => { ns(m).next(); });
    runVote(m, "Cleo", "Felix", (i) => i < 7);
    act(() => { ns(m).next(); });
    runVote(m, "Elspeth", "Jonah", (i) => i < 7);
    expect(ns(m)).toMatchObject({ resultTitle: "A tie", resultSub: "7 votes each. No one is on the block." });
    act(() => { ns(m).next(); });
    expect((m.result.current.day.pill as any).blockOn).toBe(false);
    expect(m.result.current.day.advance!.text).toBe("Begin Night 3");
  });

  it("dims what cannot be picked and marks accuser, accused and the voter whose turn it is", () => {
    const m = mount();
    nominate(m);
    const decor = () => dayTokenDecor(m.result.current.ctx);
    expect(decor()[town.ids.Dmitri!]?.filter).toBeDefined();
    tap(m, "Bram");
    tap(m, "Greta");
    expect(decor()[town.ids.Bram!]).toMatchObject({ tagText: "Nominator", ringOn: true });
    expect(decor()[town.ids.Greta!]).toMatchObject({ tagText: "On trial" });
    act(() => { ns(m).begin(); });
    const voter = m.result.current.ctx.voting!.voter!.playerId;
    expect(decor()[voter]?.glow).toBeTruthy();
  });

  it("refuses to open nominations in Privacy Mode", () => {
    const m = mount();
    act(() => { usePrivacyStore.getState().setEnabled(true); });
    nominate(m);
    expect(ns(m).cardOn).toBe(false);
    expect(useV6Ui.getState().toast).toMatch(/Show tokens/);
  });
});

describe("Virgin, exile and corrections", () => {
  it("resolves a Virgin's first nomination inside the card, then waits for Night on the dock", () => {
    const m = mount();
    nominate(m);
    tap(m, "Ada");
    tap(m, "Iris");
    act(() => { ns(m).begin(); });
    expect(ns(m)).toMatchObject({ result: true, resultTitle: "Iris’s first nomination", nextText: "Execute · died" });
    act(() => { ns(m).next(); });
    expect(game().players[town.ids.Ada!]!.alive).toBe(false);
    expect(ns(m)).toMatchObject({ resultTitle: "Ada was executed", nextText: "Begin Night 3" });
    act(() => { ns(m).next(); });
    expect(game().phase).toBe("night");
    expect(game().day).toBe(3);
  });

  it("offers 'Executed · survived' and 'Continue voting' as the Virgin's other outcomes", () => {
    const m = mount();
    nominate(m);
    tap(m, "Felix");
    tap(m, "Iris");
    act(() => { ns(m).begin(); });
    const extra = ns(m).extra as { props: { actions: Array<{ label: string; onClick: () => void }> } };
    expect(extra.props.actions.map((a) => a.label)).toEqual(["Executed · survived", "Continue voting"]);
    act(() => { extra.props.actions[0]!.onClick(); });
    expect(game().players[town.ids.Felix!]!.alive).toBe(true);
    expect(ns(m).resultTitle).toBe("Felix was executed");
  });

  it("calls an exile for a Traveller and records the outcome the Storyteller confirms", () => {
    const m = mount();
    runVote(m, "Bram", "Lior", (i) => i < 7);
    expect(ns(m)).toMatchObject({ kicker: "Day 2 · Exile 1", resultTitle: "Exile supported", nextText: "Exiled · died", need: 6 });
    act(() => { ns(m).next(); });
    expect(game().players[town.ids.Lior!]!.alive).toBe(false);
  });

  it("corrects a recorded vote from the corrections list", () => {
    const m = mount();
    runVote(m, "Bram", "Greta", (i) => i < 7);
    const round = currentVotingState(game()).rounds[0]!;
    expect(round.result).toBe("block");
    act(() => { m.result.current.ctx.voting!.show("history"); });
    expect(ns(m).kicker).toBe("Day 2 · Nominations");
    const voter = round.responses[0]!.voter;
    act(() => { m.result.current.ctx.voting!.run({ kind: "correctResponse", roundId: round.id, voter, choice: "no" }); });
    expect(currentVotingState(game()).rounds[0]!.tally).toBe(6);
  });
});

describe("executing and beginning the Night", () => {
  it("confirms what actually happened to the executed player, then enters Night", () => {
    const m = mount();
    runVote(m, "Bram", "Greta", (i) => i < 7);
    act(() => { ns(m).next(); });
    act(() => { m.result.current.day.advance!.run(); });
    // The question sits under its heading with all three answers on one row; no explanatory sentence.
    const asked = ns(m).extra as { props: { heading: string; actions: Array<{ label: string; onClick: () => void }> } };
    expect(ns(m)).toMatchObject({ kicker: "Day 2 · Finish day", extraOn: true });
    expect(ns(m).result).toBeFalsy();
    expect(asked.props.heading).toBe("Did Greta die?");
    expect(asked.props.actions.map((a) => a.label)).toEqual(["Yes · died", "No · survived", "No execution"]);
    act(() => { asked.props.actions[0]!.onClick(); });
    expect(game().players[town.ids.Greta!]!.alive).toBe(false);
    expect(m.result.current.day.advance!.text).toBe("Begin Night 3");
    act(() => { m.result.current.day.advance!.run(); });
    expect(game().phase).toBe("night");
    expect(game().day).toBe(3);
    expect(useV6Ui.getState().veil?.label).toBe("Night III");
    expect(useV6Ui.getState().panel).toBe("night");
  });

  it("a survived execution leaves the player alive", () => {
    const m = mount();
    runVote(m, "Bram", "Greta", (i) => i < 7);
    act(() => { ns(m).next(); });
    act(() => { m.result.current.day.advance!.run(); });
    act(() => { m.result.current.ctx.voting!.run({ kind: "execution", target: { playerId: town.ids.Greta!, participantId: game().players[town.ids.Greta!]!.participantId! }, outcome: "survived" }); });
    expect(game().players[town.ids.Greta!]!.alive).toBe(true);
  });

  it("will not leave the Day with a vote under way", () => {
    const m = mount();
    nominate(m);
    tap(m, "Bram");
    tap(m, "Greta");
    act(() => { ns(m).begin(); });
    act(() => { m.result.current.ctx.voting!.close(); });
    act(() => { m.result.current.day.advance!.run(); });
    expect(game().phase).toBe("day");
    expect(useV6Ui.getState().toast).toBe("Finish the vote first.");
  });
});

describe("the Slayer's shot", () => {
  // A Traveller in play puts the table outside verified coverage (the Storyteller rules the shot); these run the verified path.
  beforeEach(() => { useV6Ui.getState().reset(); town = buildDayTown(2, { traveler: false }); });
  const shoot = (m: Mounted, shooter: string, target: string) => {
    act(() => { (m.result.current.day.vm.sv as any).toggle(); });
    act(() => { dayTokenTap(m.result.current.ctx, town.ids[shooter]!); });
    act(() => { dayTokenTap(m.result.current.ctx, town.ids[target]!); });
  };

  it("rules the verified shot at the Demon and records the death and the spent ability", () => {
    expect(evaluateSlayerShot(mount().result.current.ctx, town.ids.Kestrel!, town.ids.Hollis!)).toMatchObject({ real: true, kind: "plan", dies: true });
    const m = mount();
    shoot(m, "Kestrel", "Hollis");
    const sv = m.result.current.day.vm.sv as Record<string, any>;
    expect(sv).toMatchObject({ open: true, result: true, resTitle: "Hollis dies", confirmText: "Confirm death", overrideText: "They survive", s1: "Kestrel", s2: "Hollis" });
    act(() => { sv.confirm(); });
    expect(game().players[town.ids.Hollis!]!.alive).toBe(false);
    expect(game().players[town.ids.Kestrel!]!.abilityUsed).toBe(true);
    expect(useV6Ui.getState().slay).toBeNull();
    expect((m.result.current.day.vm.sv as any)).toMatchObject({ status: "Used" });
    // The Slayer row carries no shot history: the status says Used, and Undo cannot leave a stale line behind.
    expect(m.result.current.day.vm.sv as any).not.toHaveProperty("log");;
  });

  it("a shot at a non-Demon spends the ability and nothing happens", () => {
    const m = mount();
    shoot(m, "Kestrel", "Ada");
    const sv = m.result.current.day.vm.sv as Record<string, any>;
    expect(sv.resTitle).toBe("Nothing happens");
    act(() => { sv.confirm(); });
    expect(game().players[town.ids.Ada!]!.alive).toBe(true);
    expect(game().players[town.ids.Kestrel!]!.abilityUsed).toBe(true);
  });

  it("a bluff by someone else records nothing", () => {
    const m = mount();
    shoot(m, "Ada", "Hollis");
    const sv = m.result.current.day.vm.sv as Record<string, any>;
    expect(sv).toMatchObject({ note: "Ada is not the Slayer.", resTitle: "Nothing happens" });
    act(() => { sv.confirm(); });
    expect(game().players[town.ids.Hollis!]!.alive).toBe(true);
    expect(game().players[town.ids.Kestrel!]!.abilityUsed).toBe(false);
  });

  it("a poisoned Slayer's shot is spent and nothing happens, exactly as the rules say; there is no way to make it kill", () => {
    useStorytellerStore.setState({ game: impair(game(), town.ids.Kestrel!) });
    const m = mount();
    shoot(m, "Kestrel", "Hollis");
    let sv = m.result.current.day.vm.sv as Record<string, any>;
    expect(sv).toMatchObject({ resTitle: "Nothing happens", overrideOn: false });
    act(() => { sv.override(); });
    sv = m.result.current.day.vm.sv as Record<string, any>;
    expect(sv.resTitle).toBe("Nothing happens");
    act(() => { sv.confirm(); });
    expect(game().players[town.ids.Hollis!]!.alive).toBe(true);
    expect(game().players[town.ids.Kestrel!]!.abilityUsed).toBe(true);
  });

  it("the one Storyteller choice left: a healthy Slayer's shot at a Recluse (who may register as the Demon)", () => {
    const withRecluse = () => patchPlayer(game(), town.ids.Ada!, { actualRole: "recluse", shownRole: "recluse" } as never);
    useStorytellerStore.setState({ game: withRecluse() });
    let m = mount();
    shoot(m, "Kestrel", "Ada");
    expect(evaluateSlayerShot(m.result.current.ctx, town.ids.Kestrel!, town.ids.Ada!)).toMatchObject({ kind: "judgment", overridable: true });
    let sv = m.result.current.day.vm.sv as Record<string, any>;
    expect(sv).toMatchObject({ resTitle: "Nothing happens", overrideOn: true, overrideText: "They die" });
    act(() => { sv.override(); });
    sv = m.result.current.day.vm.sv as Record<string, any>;
    expect(sv.resTitle).toBe("Ada dies");
    act(() => { sv.confirm(); });
    expect(game().players[town.ids.Ada!]!.alive).toBe(false);
    expect(game().players[town.ids.Kestrel!]!.abilityUsed).toBe(true);
    // A poisoned Slayer has no such choice: the shot is spent and the Recluse lives.
    useV6Ui.getState().reset();
    town = buildDayTown(2, { traveler: false });
    useStorytellerStore.setState({ game: impair(withRecluse(), town.ids.Kestrel!) });
    m = mount();
    shoot(m, "Kestrel", "Ada");
    sv = m.result.current.day.vm.sv as Record<string, any>;
    expect(sv).toMatchObject({ resTitle: "Nothing happens", overrideOn: false });
  });

  it("a healthy real Slayer's shot is ruled by the rules alone: no override is offered, and a forced one is ignored", () => {
    const m = mount();
    shoot(m, "Kestrel", "Hollis");
    let sv = m.result.current.day.vm.sv as Record<string, any>;
    expect(sv).toMatchObject({ resTitle: "Hollis dies", overrideOn: false });
    act(() => { sv.override(); });
    sv = m.result.current.day.vm.sv as Record<string, any>;
    expect(sv).toMatchObject({ resTitle: "Hollis dies", resSub: "The Slayer’s ability is now spent." });
    act(() => { sv.confirm(); });
    expect(game().players[town.ids.Hollis!]!.alive).toBe(false);
  });

  it("anyone else claiming the Slayer (a bluff, a Drunk, a Marionette) never kills and is never offered the override", () => {
    const concealed = (role: "drunk" | "marionette") => {
      const base = game();
      const next = patchPlayer(base, town.ids.Ada!, { actualRole: role, shownRole: "slayer", behaviorMode: role === "drunk" ? "drunk_fake_role_behavior" : "marionette_fake_good_behavior" } as never);
      useStorytellerStore.setState({ game: next });
    };
    for (const who of ["bluff", "drunk", "marionette"] as const) {
      useV6Ui.getState().reset();
      town = buildDayTown(2, { traveler: false });
      if (who !== "bluff") concealed(who);
      const m = mount();
      shoot(m, "Ada", "Hollis");
      let sv = m.result.current.day.vm.sv as Record<string, any>;
      expect(sv, who).toMatchObject({ resTitle: "Nothing happens", overrideOn: false });
      act(() => { sv.override(); });
      sv = m.result.current.day.vm.sv as Record<string, any>;
      expect(sv.resTitle, who).toBe("Nothing happens");
      act(() => { sv.confirm(); });
      expect(game().players[town.ids.Hollis!]!.alive, who).toBe(true);
    }
  });

  it("the dead may not shoot, and Privacy Mode closes the card", () => {
    const m = mount();
    act(() => { (m.result.current.day.vm.sv as any).toggle(); });
    act(() => { dayTokenTap(m.result.current.ctx, town.ids.Dmitri!); });
    expect(useV6Ui.getState().toast).toBe("The dead may not use day abilities.");
    expect(useV6Ui.getState().slay).toMatchObject({ stage: "shooter" });
    act(() => { usePrivacyStore.getState().setEnabled(true); });
    expect(useV6Ui.getState().slay).toBeNull();
  });
});

describe("a Slayer's shot Silverwick cannot rule on", () => {
  it("leaves the ruling to the Storyteller and records it as such", () => {
    const m = mount();
    act(() => { (m.result.current.day.vm.sv as any).toggle(); });
    act(() => { dayTokenTap(m.result.current.ctx, town.ids.Kestrel!); });
    act(() => { dayTokenTap(m.result.current.ctx, town.ids.Hollis!); });
    expect(evaluateSlayerShot(m.result.current.ctx, town.ids.Kestrel!, town.ids.Hollis!)).toMatchObject({ kind: "manual", dies: false });
    act(() => { (m.result.current.day.vm.sv as any).override(); });
    const sv = m.result.current.day.vm.sv as Record<string, any>;
    expect(sv).toMatchObject({ resTitle: "Hollis dies", overrideText: "Undo override" });
    act(() => { sv.confirm(); });
    expect(game().players[town.ids.Hollis!]!.alive).toBe(false);
    expect(game().players[town.ids.Kestrel!]!.abilityUsed).toBe(true);
  });
});

describe("end of game hints", () => {
  beforeEach(() => { useV6Ui.getState().reset(); town = buildDayTown(2, { traveler: false }); });
  it("the dock's End control names the verified winner once the Demon has died", () => {
    const m = renderHook(() => {
      const g = useStorytellerStore((s) => s.game)!;
      return useGrimoireVm(useV6Ctx(g));
    }, { wrapper });
    expect(m.result.current.winHint).toBe(false);
    act(() => { useV6Ui.getState().set({ slay: { stage: "result", shooter: town.ids.Kestrel!, target: town.ids.Hollis! } }); });
    act(() => { (m.result.current.sv as any).confirm(); });
    expect(m.result.current.winHint).toBe(true);
    expect(m.result.current.endTitle).toBe("End game · The Demon is dead. Good wins");
  });
});

describe("Golem (WP-3)", () => {
  // p0 golem, p1 chef, p2 empath, p3 monk, p4 imp, p5 saint, p6 poisoner (Day 2)
  const ROLES = ["golem", "chef", "empath", "monk", "imp", "saint", "poisoner"];
  beforeEach(() => {
    useStorytellerStore.setState({ game: proofGame(ROLES, "day", 2), lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
  });
  const open = (m: Mounted) => { if (!m.result.current.ctx.voting!.open) nominate(m); };
  const tapId = (m: Mounted, id: string) => act(() => { m.result.current.ctx.voting!.tap(id); });
  const alive = (id: string) => game().players[id]!.alive;
  const rounds = () => currentVotingState(game()).rounds.length;

  it("the first nomination kills a non-Demon and spends the ability by itself; Undo reverses the consequence, then the nomination", () => {
    const m = mount(); open(m); tapId(m, "p0"); tapId(m, "p1");
    expect(ns(m).beginOff).toBeUndefined();
    act(() => { ns(m).begin(); });
    expect(rounds()).toBe(1);
    expect(alive("p1")).toBe(false);
    expect(game().players.p0!.abilityUsed).toBe(true);
    expect(game().players.p0!.reminders.map((r) => r.label)).toContain("May Not Nominate");
    act(() => { store().undo(); });
    expect(alive("p1")).toBe(true);
    expect(game().players.p0!.abilityUsed).toBeFalsy();
    expect(rounds()).toBe(1);
    act(() => { store().undo(); });
    expect(rounds()).toBe(0);
  });

  it("nominating the Demon spends the ability and nobody dies", () => {
    const m = mount(); open(m); tapId(m, "p0"); tapId(m, "p4");
    act(() => { ns(m).begin(); });
    expect(alive("p4")).toBe(true);
    expect(game().players.p0!.abilityUsed).toBe(true);
  });

  it("a spent Golem who tries again: Begin the vote is greyed out and nothing is recorded", () => {
    const m = mount(); open(m); tapId(m, "p0"); tapId(m, "p4");
    act(() => { ns(m).begin(); });
    const voters = currentVotingState(game()).rounds.at(-1)!.order.length;
    for (let i = 0; i < voters; i++) respond(m, "no");
    act(() => { ns(m).next(); });
    tapId(m, "p0"); tapId(m, "p2");
    expect(ns(m).beginOff).toBe(true);
    const before = rounds();
    act(() => { ns(m).begin(); });
    expect(rounds()).toBe(before);
    expect(alive("p2")).toBe(true);
  });

  it("a Recluse nominee is the Storyteller's ruling: nothing is applied until they rule", () => {
    useStorytellerStore.setState({ game: proofGame(["golem", "recluse", "empath", "monk", "imp", "saint", "poisoner"], "day", 2) });
    const m = mount(); open(m); tapId(m, "p0"); tapId(m, "p1");
    act(() => { ns(m).begin(); });
    expect(rounds()).toBe(1);
    expect(alive("p1")).toBe(true);
    expect(game().players.p0!.abilityUsed).toBeFalsy();
  });

  it("a nomination the vote engine refuses does not spend the Golem", () => {
    const m = mount(); open(m); tapId(m, "p2"); tapId(m, "p3");
    act(() => { ns(m).begin(); });
    act(() => { ns(m).next(); });
    tapId(m, "p0"); tapId(m, "p3"); // p3 was already nominated today
    act(() => { ns(m).begin(); });
    expect(game().players.p0!.abilityUsed).toBeFalsy();
    expect(alive("p3")).toBe(true);
  });
});

describe("Witch's curse (WP-9)", () => {
  // p0 witch, p1 chef (cursed), p2 empath, p3 monk, p4 imp, p5 saint, p6 poisoner (Day 2)
  const ROLES = ["witch", "chef", "empath", "monk", "imp", "saint", "poisoner"];
  const base = proofGame(ROLES, "day", 2);
  const cursed = patchPlayer(base, "p1", { effects: [{
    id: "curse", type: "witchCurse", sourceCharacter: "witch", lifetime: { kind: "throughFollowingDay" }, state: "active",
    sourceParticipant: { kind: "participant", playerId: "p0", participantId: base.players.p0!.participantId!, nameAtTime: "Player 0" },
    expiry: { kind: "at", moment: { phase: "night", day: 3 } }, appliedAt: { phase: "night", day: 2 } } as never] });
  beforeEach(() => {
    useStorytellerStore.setState({ game: cursed, lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
  });
  const open = (m: Mounted) => { if (!m.result.current.ctx.voting!.open) nominate(m); };
  const tapId = (m: Mounted, id: string) => act(() => { m.result.current.ctx.voting!.tap(id); });

  it("the cursed nominator dies by themselves as the vote begins, the nomination counts, and Undo restores them first", () => {
    const m = mount(); open(m); tapId(m, "p1"); tapId(m, "p2");
    expect(ns(m).extraOn).toBe(true);
    act(() => { ns(m).begin(); });
    expect(game().players.p1!.alive).toBe(false);
    expect(currentVotingState(game()).rounds).toHaveLength(1);
    act(() => { useStorytellerStore.getState().undo(); });
    expect(game().players.p1!.alive).toBe(true);
    expect(currentVotingState(game()).rounds).toHaveLength(1);
    act(() => { useStorytellerStore.getState().undo(); });
    expect(currentVotingState(game()).rounds).toHaveLength(0);
  });

  it("nobody else dies, and an uncursed nominator is untouched", () => {
    const m = mount(); open(m); tapId(m, "p3"); tapId(m, "p2");
    act(() => { ns(m).begin(); });
    expect(Object.values(game().players).filter((p) => !p.alive)).toHaveLength(0);
  });
});
