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
import { buildDayTown, type DayTown } from "./dayFixture";

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
    expect(ns(m)).toMatchObject({ kicker: "Day 2 · Finish day", resultTitle: "Did Greta die?", nextText: "Yes · died", result: true });
    act(() => { ns(m).next(); });
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
    expect((m.result.current.day.vm.sv as any)).toMatchObject({ status: "Used", hasLog: true });
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

  it("the Storyteller's override of the rules is recorded as a labelled ruling", () => {
    const m = mount();
    shoot(m, "Kestrel", "Hollis");
    act(() => { (m.result.current.day.vm.sv as any).override(); });
    const sv = m.result.current.day.vm.sv as Record<string, any>;
    expect(sv).toMatchObject({ resTitle: "Nothing happens", resSub: "Storyteller override.", overrideText: "Undo override" });
    act(() => { sv.confirm(); });
    expect(game().players[town.ids.Hollis!]!.alive).toBe(true);
    expect(game().players[town.ids.Kestrel!]!.abilityUsed).toBe(true);
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
