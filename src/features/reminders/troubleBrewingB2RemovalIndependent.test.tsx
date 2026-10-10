import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PopoverReminders } from "@/features/players/PopoverReminders";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { MemoryRoomBackend } from "@/firebase/memoryBackend";
import { SessionWriter } from "@/firebase/writer";
import { createLobby } from "@/firebase/lobby";
import { requireActiveSession } from "@/firebase/lifecycle";
import { bind, pick, plan, planned, proofGame, proofScript, request } from "@/test/proofFixtures";

const game = () => store.getState().game!;
function View({ id = "p1" }: { id?: string }) {
  const value = store(s => s.game)!;
  return <PopoverReminders player={value.players[id]!} />;
}
const effect = () => screen.getByRole("button", { name: "Remove Poisoned effect from Poisoner" });
const writers: SessionWriter[] = [];
beforeEach(() => {
  const base = proofGame(["poisoner", "chef", "soldier", "imp"]);
  const poisoned = planned(plan(base, request(base, "p0", "poisoner", { target: pick(base, "p1") }, { withStep: true, completeStep: true })));
  store.setState({ game: poisoned, lobby: null, undoStack: [], localSeq: 0, terminalClose: null,
    customScripts: { [proofScript.id]: proofScript } });
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ backend: null, status: "idle" });
});
afterEach(async () => {
  cleanup(); vi.restoreAllMocks();
  for (const writer of writers.splice(0)) await writer.dispose();
  useSessionRuntime.setState({ backend: null, status: "idle" });
});

it("notation and mechanical token identifiers cannot arm each other", () => {
  game().players.p1!.reminders = [{ id: "effect:poisoner:poisoned", sourceCharacter: "poisoner", label: "Poisoned" }];
  render(<View />); const before = game();
  fireEvent.click(screen.getByRole("button", { name: "Remove Poisoned reminder" }));
  fireEvent.click(effect());
  expect(game()).toBe(before); expect(game().players.p1!.effects).toHaveLength(1);
  expect(game().players.p1!.reminders).toHaveLength(1); expect(store.getState().undoStack).toHaveLength(0);
  fireEvent.click(effect());
  expect(game().players.p1!.effects).toHaveLength(0); expect(game().players.p1!.reminders).toHaveLength(1);
  expect(game().nightProgress).toEqual(before.nightProgress); expect(game().informationDeliveries).toEqual(before.informationDeliveries);
});

it("changing the inspected participant requires two fresh taps even when group keys match", () => {
  game().players.p2!.effects = [{ ...game().players.p1!.effects[0]!, id: "other-holder" }];
  const view = render(<View />); const before = game();
  fireEvent.click(effect()); view.rerender(<View id="p2" />); fireEvent.click(effect());
  expect(game()).toBe(before); expect(store.getState().undoStack).toHaveLength(0);
  fireEvent.click(effect());
  expect(game().players.p2!.effects).toHaveLength(0); expect(game().players.p1!.effects).toHaveLength(1);
});

it("a script-definition replacement invalidates an armed token without changing game identity", () => {
  const view = render(<View />); const before = game(); fireEvent.click(effect());
  act(() => store.setState({ customScripts: { [proofScript.id]: { ...proofScript, name: "Reviewed replacement" } } }));
  view.rerender(<View />); fireEvent.click(effect());
  expect(game()).toBe(before); expect(store.getState().undoStack).toHaveLength(0);
  fireEvent.click(effect()); expect(game().players.p1!.effects).toHaveLength(0);
});

it("removing poison after later information does not rewrite the completed action or what was communicated", () => {
  expect(store.getState().resolveAbility({ mode: "manual", reason: "Information already communicated", outcome: { operations: [
    { domain: "manualInformation", recipient: bind(game(), "p1"), text: "The Storyteller communicated one evil pair." },
  ] } })).toMatchObject({ ok: true, changed: true });
  const before = game();
  expect(before.informationDeliveries).toHaveLength(1);
  expect(Object.values(before.nightProgress)).toEqual([expect.objectContaining({ status: "done" })]);
  render(<View />); fireEvent.click(effect()); fireEvent.click(effect());
  expect(game().players.p1!.effects).toEqual([]);
  expect(game().informationDeliveries).toEqual(before.informationDeliveries);
  expect(game().nightProgress).toEqual(before.nightProgress);
  expect(game().lifeEventWindow).toEqual(before.lifeEventWindow);
  for (const [id, player] of Object.entries(before.players)) {
    expect(game().players[id]!.alive).toBe(player.alive);
    expect(game().players[id]!.abilityUsed).toBe(player.abilityUsed);
  }
  expect(game().history.slice(0, before.history.length)).toEqual(before.history);
  expect(game().history).toHaveLength(before.history.length + 1);
  expect(game().history.at(-1)).toMatchObject({ category: "effect", effectOperation: "remove" });
  expect(game().history.at(-1)?.correction).not.toBe(true);
});

it("a real same-session writer replacement cannot inherit the previous writer's armed removal", async () => {
  const backend = new MemoryRoomBackend(); const code = "B2ARM234";
  await createLobby(backend, "host", { codeGenerator: () => code });
  const session = await requireActiveSession(backend, code);
  const first = new SessionWriter(backend, code, session.id); writers.push(first); await first.start();
  store.setState({ game: { ...game(), code, storytellerUid: "host" }, lobby: { code, uid: "host", sessionId: session.id, status: "live" } });
  useSessionRuntime.setState({ backend: first, status: "live" });
  const view = render(<View />); const before = game(); fireEvent.click(effect());
  await first.dispose();
  const second = new SessionWriter(backend, code, session.id); writers.push(second); await second.start();
  act(() => useSessionRuntime.setState({ backend: second, status: "live" }));
  view.rerender(<View />); fireEvent.click(effect());
  expect(game()).toBe(before); expect(store.getState().undoStack).toHaveLength(0);
  fireEvent.click(effect());
  expect(game().players.p1!.effects).toHaveLength(0); expect(store.getState().undoStack).toHaveLength(1);
});
