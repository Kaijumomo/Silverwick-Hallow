// BM-2d: the Storyteller's screens around the Zombuul's hidden life (planning/BM2_BUILD_PROPOSAL.md; PO decisions 2026-11-25 Q1-Q4).
// The seat keeps looking alive on the Storyteller's own board; shown to a player (Privacy Mode) it shows what the table saw.
import type { ReactNode } from "react";
import { act, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { VotingCard, VotingProvider, useVotingInteraction } from "@/features/voting/VotingWorkspace";
import { usePrivacyStore } from "@/stores/privacyStore";
import { isTrulyAlive } from "@/stores/lifeState";
import { begin, binding, dawn, execute, game, id, nominate, ok, resetStores, setup, state, vote } from "@/test/bmWholeGame";
import { useV6Ctx } from "../ctx";
import { useV6Ui } from "../v6Store";
import { useDayVm } from "../vm/day";
import { useBoardVm } from "../vm/board";
import { dawnText, nightDeaths } from "../night/nightSteps";

// No Pacifist here: with one in play the Zombuul (whose registration the rules leave to the Storyteller) is asked the Pacifist's question.
const TABLE = ["zombuul", "godfather", "tealady", "fool", "professor", "moonchild", "chambermaid"];
const wrapper = ({ children }: { children: ReactNode }) => <VotingProvider>{children}</VotingProvider>;
function mount() {
  return renderHook(() => {
    const g = useStorytellerStore((s) => s.game)!;
    const ctx = useV6Ctx(g);
    return { ctx, day: useDayVm(ctx), board: useBoardVm(ctx).vm as Record<string, any> };
  }, { wrapper });
}
const ns = (m: ReturnType<typeof mount>) => m.result.current.day.vm.ns as Record<string, any>;
const token = (m: ReturnType<typeof mount>, playerId: string) => m.result.current.board.tokens.find((t: any) => t.id === playerId);

beforeEach(() => { resetStores(); useV6Ui.getState().reset(); setup(TABLE); begin(); dawn(["godfather", "chambermaid"]); });

describe("BM-2d: the first execution", () => {
  it("the dock's Execute records it at once and the result line adds one plain sentence (PO Q1 B)", () => {
    const z = id("zombuul");
    expect(nominate("d1", id("godfather"), z).result).toBe("block");
    const m = mount();
    expect(m.result.current.day.advance!.text).toBe(`Execute ${game().players[z]!.name}`);
    act(() => { m.result.current.day.advance!.run(); });
    expect(isTrulyAlive(game().players[z]!)).toBe(true);
    expect(game().players[z]!.alive).toBe(false);
    expect(useV6Ui.getState().toast).toBe(`${game().players[z]!.name} is executed. Announce that they died. Begin the night when ready.`);
  });

  it("any other execution keeps its line", () => {
    const maid = id("chambermaid");
    expect(nominate("d1", id("godfather"), maid).result).toBe("block");
    const m = mount();
    act(() => { m.result.current.day.advance!.run(); });
    expect(useV6Ui.getState().toast).toBe(`${game().players[maid]!.name} is executed. Begin the night when ready.`);
  });
});

describe("BM-2d: the seat that lives on", () => {
  beforeEach(() => { execute(id("zombuul")); });

  it("looks alive on the Storyteller's board (no shroud); shown to a player it looks dead", () => {
    const m = mount();
    const z = id("zombuul");
    expect(token(m, z).dead).toBe(false);
    act(() => { usePrivacyStore.getState().setEnabled(true); });
    expect(token(m, z).dead).toBe(true);
  });

  it("the radial keeps Spend vote (PO Q3) and offers Kill, his real death; the Details switch stands on Alive and Alive changes nothing", () => {
    const m = mount();
    const z = id("zombuul");
    act(() => state().selectPlayer(z));
    const labels = m.result.current.board.rad.items.map((item: any) => item.label);
    expect(labels).toEqual(expect.arrayContaining(["Kill", "Spend vote"]));
    expect(labels).not.toContain("Revive");
    act(() => useV6Ui.getState().set({ card: true }));
    expect(m.result.current.board.pop.dead).toBe(false);
    expect(m.result.current.board.pop.statusText).toMatch(/^Survived/);
    const before = game();
    act(() => m.result.current.board.pop.setAlive());
    expect(game()).toBe(before);
    act(() => m.result.current.board.pop.setDead());   // PO Q2: Died is his real death
    expect(isTrulyAlive(game().players[z]!)).toBe(false);
    expect(token(m, z).dead).toBe(true);
    act(() => { state().undo(); });
    expect(isTrulyAlive(game().players[z]!)).toBe(true);
  });

  it("his second execution asks \"Did X die?\" with the usual answers (PO Q4), not \"already dead\"", () => {
    state().advancePhase(); dawn(["godfather", "chambermaid", "zombuul", "moonchild", "professor"]);
    const z = id("zombuul");
    expect(nominate("d2", id("godfather"), z).result).toBe("block");
    const m = mount();
    act(() => { m.result.current.day.advance!.run(); });
    expect((ns(m).extra as any).props.heading).toBe(`Did ${game().players[z]!.name} die?`);
    expect(isTrulyAlive(game().players[z]!)).toBe(true);
    ok(vote({ kind: "execution", target: binding(z), outcome: "died" }));
    expect(isTrulyAlive(game().players[z]!)).toBe(false);
  });
});

describe("BM-2 independent check: what the table saw stays what is shown", () => {
  it("S1: his real death at night (he already registers as dead) is not hidden in Privacy Mode and is not announced at dawn; a living victim still is", () => {
    const z = id("zombuul"); const maid = id("chambermaid");
    execute(z);
    state().advancePhase();
    ok(state().recordDeath(z));                     // his real death (the Died switch, or any killer)
    ok(state().recordDeath(maid));                  // an ordinary night victim
    expect(isTrulyAlive(game().players[z]!)).toBe(false);
    const m = mount();
    act(() => { usePrivacyStore.getState().setEnabled(true); });
    expect(token(m, z).dead).toBe(true);           // the table already saw him dead
    expect(token(m, maid).dead).toBe(false);       // tonight's victim stays hidden until dawn, as before
    const names = nightDeaths(game())!;
    expect(names).toEqual([game().players[maid]!.name]);
    expect(dawnText(game())).not.toContain(game().players[z]!.name);
  });

  it("S3: Kill on the board records the first death and says so in one sentence; his real death later says nothing extra", () => {
    const z = id("zombuul");
    const m = mount();
    act(() => state().selectPlayer(z));
    const kill = m.result.current.board.rad.items.find((item: any) => item.label === "Kill");
    act(() => kill.onClick());
    expect(isTrulyAlive(game().players[z]!)).toBe(true);
    expect(useV6Ui.getState().toast).toBe(`${game().players[z]!.name} is recorded as dead. Announce that they died.`);
    act(() => useV6Ui.getState().set({ toast: null } as never));
    act(() => state().selectPlayer(null));
    act(() => state().selectPlayer(z));
    const again = m.result.current.board.rad.items.find((item: any) => item.label === "Kill");
    act(() => again.onClick());
    expect(isTrulyAlive(game().players[z]!)).toBe(false);
    expect(useV6Ui.getState().toast ?? null).toBeNull();
  });

  it("S3: the Finish day panel's recorded execution carries the same sentence after the first death only", () => {
    const z = id("zombuul");
    execute(z);
    let show: (() => void) | undefined;
    const Opener = () => { const ui = useVotingInteraction(); show = () => ui?.show("finish"); return null; };
    render(<VotingProvider><Opener /><VotingCard inline /></VotingProvider>);
    act(() => show!());
    expect(screen.getByText(/Execution recorded/)).toBeTruthy();
    expect(screen.getByText(new RegExp(`${game().players[z]!.name} · died. Announce that they died.`))).toBeTruthy();
  });
});
