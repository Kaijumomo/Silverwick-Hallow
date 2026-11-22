import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { VotingProvider } from "@/features/voting/VotingWorkspace";
import { currentVotingState } from "@/stores/voting";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useV6Ctx } from "../ctx";
import { useV6Ui } from "../v6Store";
import { useDayVm } from "../vm/day";
import { buildDayTown, type DayTown } from "@/test/dayFixture";

const wrapper = ({ children }: { children: ReactNode }) => <VotingProvider>{children}</VotingProvider>;
const store = () => useStorytellerStore.getState();
const game = () => store().game!;
let town: DayTown;

function mount() {
  return renderHook(() => {
    const g = useStorytellerStore((s) => s.game)!;
    const ctx = useV6Ctx(g);
    return { ctx, day: useDayVm(ctx) };
  }, { wrapper });
}
const ns = (m: ReturnType<typeof mount>) => m.result.current.day.vm.ns as Record<string, any>;
const tap = (m: ReturnType<typeof mount>, name: string) => act(() => { m.result.current.ctx.voting!.tap(town.ids[name]!); });

/** Bram nominates Greta and every voter says yes, so Greta is on the block. */
function putOnBlock(m: ReturnType<typeof mount>) {
  act(() => { (m.result.current.day.pill as any).nominate(); });
  tap(m, "Bram"); tap(m, "Greta");
  act(() => { ns(m).begin(); });
  const order = currentVotingState(game()).rounds.at(-1)!.order.length;
  for (let i = 0; i < order; i++) act(() => { ns(m).onYes(); });
  act(() => { ns(m).next(); });
}

beforeEach(() => { usePrivacyStore.getState().setEnabled(false); useV6Ui.getState().reset(); });

describe("the dock's Execute when the rules know the execution kills", () => {
  it("records the execution at once with no 'Did they die?' card, then offers Begin Night, and one Undo reverses it", () => {
    town = buildDayTown(2, { traveler: false });
    const m = mount();
    putOnBlock(m);
    expect(m.result.current.day.advance!.text).toBe("Execute Greta");
    act(() => { m.result.current.day.advance!.run(); });
    expect(game().players[town.ids.Greta!]!.alive).toBe(false);
    expect(ns(m).extraOn).toBeFalsy();
    expect(m.result.current.ctx.voting!.open).toBe(false);
    expect(m.result.current.day.advance!.text).toBe("Begin Night 3");
    act(() => { store().undo(); });
    expect(game().players[town.ids.Greta!]!.alive).toBe(true);
    expect(m.result.current.day.advance!.text).toBe("Execute Greta");
  });

  it("still asks when coverage is not verified (a Traveller the rules do not review is in play)", () => {
    town = buildDayTown(2);
    const m = mount();
    putOnBlock(m);
    act(() => { m.result.current.day.advance!.run(); });
    expect(game().players[town.ids.Greta!]!.alive).toBe(true);
    expect((ns(m).extra as any).props.heading).toBe("Did Greta die?");
  });
});
