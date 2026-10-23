import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { buildRS15, buildRS20 } from "@/test/representativeStates";
import type { PlayerId, StorytellerLobbyRecord } from "@/stores/types";
import { useV6Ctx } from "../ctx";
import { useV6Ui } from "../v6Store";
import { useTokenDecorations, clearTokenTapInterceptors, useTokenTapInterceptor } from "../board/overlay";
import { useBoardVm } from "./board";

const store = () => useStorytellerStore.getState();
const holder = (role: string): PlayerId => {
  const game = store().game!;
  return game.seatOrder.find((id) => game.players[id]?.actualRole === role)!;
};

function mount() {
  return renderHook(() => {
    const game = useStorytellerStore((s) => s.game) as StorytellerLobbyRecord;
    const ctx = useV6Ctx(game);
    return { ctx, board: useBoardVm(ctx).vm as Record<string, any> };
  });
}

/** The representative states leave one seat selected; these tests start from a clean table. */
const seed15 = () => { buildRS15(); store().selectPlayer(null); };
const seed20 = () => { buildRS20(); store().selectPlayer(null); };

const tokenOf = (vm: Record<string, any>, id: PlayerId) => vm.tokens.find((t: any) => t.id === id);

beforeEach(() => {
  useV6Ui.getState().reset();
  usePrivacyStore.getState().setEnabled(false);
  useTokenDecorations.setState({ bySource: {} });
  clearTokenTapInterceptors();
});
afterEach(() => { vi.restoreAllMocks(); });

describe("slice 4B: effects without an official token", () => {
  it("are never drawn on the board but stay listed, and removable, in Details", () => {
    seed15();
    const empath = holder("empath");
    const { result } = mount();
    expect(tokenOf(result.current.board, empath).rems.some((r: any) => /Poisoned/.test(r.label))).toBe(false);
    act(() => { store().selectPlayer(empath); useV6Ui.getState().set({ card: true }); });
    const listed = result.current.board.pop.unsourced as Array<{ label: string; remove: () => void }>;
    expect(result.current.board.pop.hasUnsourced).toBe(true);
    expect(listed.map((u) => u.label)).toEqual([expect.stringMatching(/^Poisoned · no source character/)]);
    // Tap twice (arm, then confirm) takes the authoritative Effect away through its command.
    act(() => listed[0]!.remove());
    act(() => (result.current.board.pop.unsourced as Array<{ remove: () => void }>)[0]!.remove());
    expect(store().game!.players[empath]!.effects.filter((e) => e.type === "poisoned" && e.state !== "removed")).toHaveLength(0);
  });

  it("hides the list in Privacy Mode", () => {
    seed15();
    const empath = holder("empath");
    act(() => usePrivacyStore.getState().setEnabled(true));
    const { result } = mount();
    act(() => { store().selectPlayer(empath); useV6Ui.getState().set({ card: true }); });
    expect(result.current.board.pop.hasUnsourced ?? false).toBe(false);
  });
});

describe("slice 4B: board view-model", () => {
  it("draws one token per occupied seat with the shown character, Life and reminders", () => {
    seed15();
    const { result } = mount();
    const vm = result.current.board;
    expect(vm.tokens).toHaveLength(15);
    const drunk = tokenOf(vm, holder("drunk"));
    expect(drunk.showArt).toBe(true);
    // The Drunk shows the character they believe they are, never the actual one.
    expect(drunk.initial).toBe("V");
    const dead = tokenOf(vm, holder("washerwoman"));
    expect(dead.dead).toBe(true);
    expect(dead.dsTorn).toBe(true);
    const empath = tokenOf(vm, holder("empath"));
    // The placed notation is drawn; the source-free Poisoned Effect has no official token, so no disc is invented for it.
    expect(empath.rems.length).toBeGreaterThanOrEqual(3);
    expect(empath.rems.some((r: any) => r.label === "Poisoned")).toBe(false);
    expect(empath.aria).toContain("reminder");
  });

  it("shows no character, reminder or Effect under Privacy Mode", () => {
    seed15();
    usePrivacyStore.getState().setEnabled(true);
    const { result } = mount();
    for (const token of result.current.board.tokens) {
      expect(token.showArt).toBe(false);
      expect(token.img).toBe("");
      expect(token.rems).toEqual([]);
      expect(token.arc).toBeNull();
      expect(token.aria).not.toMatch(/Empath|Imp|Drunk|reminder/);
    }
  });

  it("keeps at most one reminder disc plus a count on a crowded table", () => {
    seed20();
    const { result } = mount();
    const empath = tokenOf(result.current.board, holder("empath"));
    expect(empath.rems.length).toBeLessThanOrEqual(2);
    expect(empath.rems.at(-1).more).toBe(true);
    expect(empath.rems.at(-1).moreText).toMatch(/^\+\d+$/);
  });

  it("selects on tap, shows the radial menu, and opens Details", () => {
    seed15();
    const { result } = mount();
    const id = holder("chef");
    act(() => { result.current.board.tokens.find((t: any) => t.id === id).onKey({ key: "Enter", preventDefault() {} }); });
    expect(store().selectedPlayerId).toBe(id);
    const labels = result.current.board.rad.items.map((i: any) => i.label);
    expect(labels).toEqual(expect.arrayContaining(["Kill", "Character", "Swap seat", "Details"]));
    expect(result.current.board.pop.open).toBe(false);
    act(() => { result.current.board.rad.items.find((i: any) => i.label === "Details").onClick(); });
    expect(result.current.board.pop.open).toBe(true);
    expect(result.current.board.rad.on).toBe(false);
  });

  it("kills and revives through the Life commands, from the radial menu and the Details card", () => {
    seed15();
    const { result } = mount();
    const id = holder("chef");
    act(() => store().selectPlayer(id));
    act(() => { result.current.board.rad.items.find((i: any) => i.label === "Kill").onClick(); });
    expect(store().game!.players[id]!.alive).toBe(false);
    expect(result.current.board.rad.items.map((i: any) => i.label)).toEqual(expect.arrayContaining(["Revive"]));
    act(() => useV6Ui.getState().set({ card: true }));
    expect(result.current.board.pop.dead).toBe(true);
    act(() => result.current.board.pop.toggleGhost());
    expect(store().game!.players[id]!.ghostVote).toBe(false);
    act(() => result.current.board.pop.setAlive());
    expect(store().game!.players[id]!.alive).toBe(true);
  });

  it("places a notation reminder and removes it with two taps", () => {
    seed15();
    const { result } = mount();
    const id = holder("chef");
    act(() => { store().selectPlayer(id); useV6Ui.getState().set({ card: true }); });
    const before = store().game!.players[id]!.reminders.length;
    const add = result.current.board.pop.addRems[0];
    act(() => add.add());
    const after = store().game!.players[id]!.reminders;
    expect(after.length).toBe(before + 1);
    const placed = result.current.board.pop.rems.find((r: any) => r.label === add.label);
    expect(placed).toBeTruthy();
    act(() => placed.remove());
    expect(store().game!.players[id]!.reminders.length).toBe(before + 1);
    expect(useV6Ui.getState().remArm).not.toBeNull();
    const armed = result.current.board.pop.rems.find((r: any) => r.shown === "Tap to remove");
    act(() => armed.remove());
    expect(store().game!.players[id]!.reminders.length).toBe(before);
  });

  it("keeps Privacy Mode's Details card free of character and reminders", () => {
    seed15();
    usePrivacyStore.getState().setEnabled(true);
    const { result } = mount();
    const id = holder("chef");
    act(() => { store().selectPlayer(id); useV6Ui.getState().set({ card: true }); });
    const pop = result.current.board.pop;
    expect(pop.open).toBe(true);
    expect(pop.priv).toBe(true);
    expect(pop.showRole).toBe(false);
    expect(pop.showRems).toBe(false);
    expect(pop.actions).toBe(false);
    expect(pop.roleName).toBe("");
    expect(pop.ability).toBe("");
    expect(pop.rems).toEqual([]);
    const labels = result.current.board.rad?.items?.map((i: any) => i.label) ?? [];
    expect(labels).not.toContain("Character");
    expect(labels).not.toContain("Show");
  });

  it("closes every private surface when Privacy Mode turns on", () => {
    seed15();
    const { result } = mount();
    act(() => useV6Ui.getState().set({ picker: { mode: "choose", playerId: holder("chef") }, remAll: true }));
    expect(result.current.board.pk.open).toBe(true);
    act(() => usePrivacyStore.getState().setEnabled(true));
    expect(useV6Ui.getState().picker).toBeNull();
    expect(result.current.board.pk.open).toBe(false);
  });

  it("swaps seats through the seat-swap command and carries token positions with them", () => {
    seed15();
    const { result } = mount();
    const a = holder("chef"), b = holder("monk");
    const seatA = store().game!.players[a]!.seat, seatB = store().game!.players[b]!.seat;
    act(() => { store().selectPlayer(a); });
    act(() => { result.current.board.rad.items.find((i: any) => i.label === "Swap seat").onClick(); });
    expect(useV6Ui.getState().swapFrom).toBe(a);
    expect(store().selectedPlayerId).toBeNull();
    act(() => { result.current.board.tokens.find((t: any) => t.id === b).onKey({ key: " ", preventDefault() {} }); });
    expect(useV6Ui.getState().swapFrom).toBeNull();
    expect(store().game!.players[a]!.seat).toBe(seatB);
    expect(store().game!.players[b]!.seat).toBe(seatA);
  });

  it("lets another slice claim a seat tap and decorate a seat", () => {
    seed15();
    const id = holder("chef");
    const claimed: PlayerId[] = [];
    const { result } = renderHook(() => {
      const game = useStorytellerStore((s) => s.game) as StorytellerLobbyRecord;
      const ctx = useV6Ctx(game);
      useTokenTapInterceptor("test", (tapped) => { claimed.push(tapped); return true; });
      return useBoardVm(ctx).vm as Record<string, any>;
    });
    act(() => { result.current.tokens.find((t: any) => t.id === id).onKey({ key: "Enter", preventDefault() {} }); });
    expect(claimed).toEqual([id]);
    expect(store().selectedPlayerId).not.toBe(id);
    act(() => useTokenDecorations.getState().set("day", { [id]: { ringOn: true, ringColor: "red", tagOn: true, tagText: "On trial", handOn: true, filter: "none" } }));
    const token = tokenOf(result.current, id);
    expect(token.tagText).toBe("On trial");
    expect(token.handOn).toBe(true);
    expect(token.ringOn).toBe(true);
    expect(token.ringColor).toBe("red");
  });

  it("changes a character from the picker through the role command", () => {
    seed15();
    const { result } = mount();
    const id = holder("monk");
    act(() => useV6Ui.getState().set({ picker: { mode: "choose", playerId: id } }));
    const pk = result.current.board.pk;
    expect(pk.isChoose).toBe(true);
    const tiles = pk.rows.flatMap((r: any) => r.groups.flatMap((g: any) => g.tiles));
    const mayor = tiles.find((t: any) => t.name === "Mayor");
    expect(mayor).toBeTruthy();
    act(() => mayor.click());
    expect(store().game!.players[id]!.actualRole).toBe("mayor");
    expect(useV6Ui.getState().picker).toBeNull();
  });

  it("only offers out-of-play Townsfolk for the Drunk and out-of-play characters for bluffs", () => {
    seed15();
    const { result } = mount();
    act(() => useV6Ui.getState().set({ picker: { mode: "bluff", slot: 0 } }));
    const tiles = result.current.board.pk.rows.flatMap((r: any) => r.groups.flatMap((g: any) => g.tiles));
    const imp = tiles.find((t: any) => t.name === "Imp");
    // A character in play carries its holder's name and cannot be a bluff.
    expect(imp.tag).toBeTruthy();
    act(() => imp.click());
    expect(store().game!.players[holder("imp")]!.privateInfo?.bluffs ?? []).toEqual([]);
    expect(useV6Ui.getState().picker).not.toBeNull();
    const soldier = tiles.find((t: any) => t.name === "Soldier");
    act(() => soldier.click());
    const demon = store().game!.players[holder("imp")]!;
    expect(demon.privateInfo?.bluffs).toEqual(["soldier"]);
    expect(useV6Ui.getState().picker).toBeNull();
  });

  describe("free token dragging", () => {
    const fire = (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
      Object.defineProperty(event, "pointerId", { value: 1 });
      window.dispatchEvent(event);
    };
    const press = (vm: Record<string, any>, id: PlayerId, x: number, y: number) =>
      vm.tokens.find((t: any) => t.id === id).onDown({ button: 0, pointerType: "mouse", pointerId: 1, isPrimary: true, clientX: x, clientY: y, preventDefault() {} });

    it("saves the dropped position through the layout command, relative to the board centre", () => {
      seed15();
      const { result } = mount();
      const id = holder("chef");
      const start = result.current.ctx.positions[id]!;
      const { w, h } = result.current.ctx.layout;
      act(() => press(result.current.board, id, 500, 400));
      act(() => fire("pointermove", 540, 430));
      expect(tokenOf(result.current.board, id).transition).toBe("none");
      act(() => fire("pointerup", 560, 450));
      const saved = store().tokenPositions[id]!;
      expect(saved.x).toBeCloseTo(start.x + 60 - w / 2, 5);
      expect(saved.y).toBeCloseTo(start.y + 50 - h / 2, 5);
      expect(store().selectedPlayerId).toBeNull();
    });

    it("treats a press that barely moves as a tap, never a move", () => {
      seed15();
      const { result } = mount();
      const id = holder("chef");
      act(() => press(result.current.board, id, 500, 400));
      act(() => fire("pointerup", 503, 402));
      expect(store().tokenPositions[id]).toBeUndefined();
      expect(store().selectedPlayerId).toBe(id);
    });

    it("keeps a dropped token on the board", () => {
      seed15();
      const { result } = mount();
      const id = holder("chef");
      act(() => press(result.current.board, id, 500, 400));
      act(() => fire("pointerup", 90000, 90000));
      const { w, h, S } = result.current.ctx.layout;
      const saved = store().tokenPositions[id]!;
      expect(saved.x + w / 2).toBeLessThanOrEqual(w - S / 2 - 6 + 1e-6);
      expect(saved.y + h / 2).toBeLessThanOrEqual(h - S / 2 - 6 + 1e-6);
    });

    it("resets arranged tokens from the Players card control", () => {
      seed15();
      const { result } = mount();
      const id = holder("chef");
      act(() => press(result.current.board, id, 500, 400));
      act(() => fire("pointerup", 600, 450));
      expect(store().tokenPositions[id]).toBeDefined();
      act(() => result.current.board.resetPositions());
      expect(store().tokenPositions).toEqual({});
    });
  });
});
