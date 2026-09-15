import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PlayerInformation, commitExtraTextDraft } from "./PlayerInformation";
import { vi } from "vitest";
import { publishPrivatePacket } from "@/firebase/privatePacketCommands";
import { SessionWriter } from "@/firebase/writer";
import { MemoryRoomBackend } from "@/firebase/memoryBackend";
vi.mock("@/firebase/privatePacketCommands", () => ({ publishPrivatePacket: vi.fn() }));
import { PrivateInformation } from "@/features/player/PrivateInformation";
import { SealedCard } from "@/features/player/PlayerScreen";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { usePacketDeliveryState } from "@/firebase/packetDeliveryState";
import { NightOrderPanel } from "@/features/nightOrder/NightOrderPanel";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { usePrivacyStore } from "@/stores/privacyStore";

beforeEach(() => {
  vi.mocked(publishPrivatePacket).mockReset();
  usePrivacyStore.setState({ enabled: false });
  store.setState({ game: null, lobby: null, undoStack: [] });
  useSessionRuntime.setState({ backend: null });
  usePacketDeliveryState.setState({ receipts: {}, queued: {} });
});
afterEach(cleanup);
function player(actual = "lunatic", shown = "imp") {
  store.getState().newGame("tb");
  store.getState().addPlayer("Alice");
  store.getState().addPlayer("Bob");
  const [id, other] = store.getState().game!.seatOrder as [string, string];
  store.getState().assignRole(id, actual);
  if (actual === "lunatic") store.getState().setBehaviorMode(id, "fake_demon_behavior");
  store.getState().setShownRole(id, shown);
  return { id, other };
}
// These tests isolate night/delivery behavior, not setup readiness. Some use
// deliberately partial or off-script identities, so establish the live fixture.
function runningNight() {
  store.setState({ game: { ...store.getState().game!, phase: "night", day: 1 } });
  expect(store.getState().game!.phase).toBe("night");
  expect(store.getState().game!.day).toBe(1);
}
describe("private information workflow UI", () => {
  it("derives a sanitized preview without sending or saving preview state", () => {
    const { id, other } = player();
    store.getState().setFakeMinions(id, [other]);
    render(<PlayerInformation playerId={id} purpose="result" />);
    const before = store.getState().game;
    fireEvent.click(screen.getByText("Player view"));
    expect(store.getState().game).toBe(before);
    fireEvent.change(screen.getByLabelText("Information"), { target: { value: "Choose two players tonight" } });
    const preview = screen.getByText("Player view").closest("details")!;
    expect(preview).toHaveTextContent("Bob · seat 2");
    expect(preview).not.toHaveTextContent(/lunatic|fake|actual|simulated/i);
    expect(publishPrivatePacket).not.toHaveBeenCalled();
    expect(store.getState().game!.players[id]).not.toHaveProperty("packetPreview");
    expect(screen.getByRole("button", { name: "Send to player view" })).toBeDisabled();
  });

  it("player content renders minion names and instructions without deception annotations", () => {
    render(<PrivateInformation payload={{ shownRole: "imp", shownAlignment: "evil",
      minions: [{ id: "bob", name: "Bob", seat: 1 }], extraText: "Your private message" }} />);
    expect(screen.getByText("Your Minions")).toBeInTheDocument();
    expect(screen.getByRole("list")).toHaveTextContent("Bob · seat 2");
    expect(screen.getByText("Your private message")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/lunatic|fake|actual|simulated/i);
  });

  it("the actual player card shows published information only while revealed", () => {
    const props = { self: { shownRole: "imp", shownAlignment: "evil" as const,
      minions: [{ id: "bob", name: "Bob", seat: 1 }], extraText: "Secret message" },
      onReveal: () => {}, onHide: () => {} };
    const view = render(<SealedCard {...props} revealed={false} />);
    expect(screen.queryByText("Secret message")).toBeNull();
    view.rerender(<SealedCard {...props} revealed />);
    expect(screen.getByText("Secret message")).toBeInTheDocument();
    expect(screen.getByRole("list")).toHaveTextContent("Bob · seat 2");
    view.rerender(<SealedCard {...props} revealed={false} />);
    expect(screen.queryByText("Secret message")).toBeNull();
  });

  it("night procedure comes first and Lunatic setup is a collapsed introduction action", () => {
    const { other } = player();
    // This test isolates an already-running night procedure, including a
    // Lunatic not present in the TB fixture script; it does not exercise start.
    store.getState().assignRole(other, "chef");
    store.getState().setFabled(["toymaker"]);
    store.setState({ game: { ...store.getState().game!, phase: "night", day: 1 } });
    const view = render(<NightOrderPanel game={store.getState().game!} script={troubleBrewing} onClose={() => {}} />);
    const body = view.container.querySelector(".night-panel-body")!;
    expect(body.firstElementChild?.querySelector(".step-card")).toBeTruthy();
    expect(screen.queryByLabelText("Private information tasks")).toBeNull();
    const setup = screen.getByText("Setup information — Alice").closest("details")!;
    expect(setup).not.toHaveAttribute("open");
    expect(screen.queryByLabelText("Information")).toBeNull();
    expect(document.body).not.toHaveTextContent(/packet|Published|publication|fingerprint/);
    expect(publishPrivatePacket).not.toHaveBeenCalled();
  });

  it("privacy mode replaces the night sheet with a neutral notice", () => {
    const { id } = player();
    runningNight();
    usePrivacyStore.getState().setEnabled(true);
    render(<NightOrderPanel game={store.getState().game!} script={troubleBrewing} onClose={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("Privacy Mode On");
    expect(screen.getByText("Night details are hidden while Privacy Mode is on.")).toBeInTheDocument();
    expect(screen.queryByText("Imp")).toBeNull();
    expect(screen.queryByText("Fake Demon information")).toBeNull();
    expect(store.getState().game!.players[id]!.publishedPacket).toBeUndefined();
  });
});
it.each([["drunk", "empath"], ["marionette", "fortuneteller"]])("%s has the shown information procedure and can finish physically", (actual, shown) => {
  const { id } = player(actual, shown);
  runningNight();
  const before = structuredClone(store.getState().game!.players[id]!);
  const view = render(<NightOrderPanel game={store.getState().game!} script={troubleBrewing} onClose={() => {}} />);
  const step = view.container.querySelectorAll(".step-card");
  const own = Array.from(step).find(el => el.textContent?.includes("Simulated wake — actually the"))!;
  expect(own).toBeTruthy();
  fireEvent.click(within(own as HTMLElement).getByText("Give information"));
  expect(within(own as HTMLElement).getByLabelText("Information")).toBeInTheDocument();
  fireEvent.click(within(own as HTMLElement).getByRole("button", { name: "Done" }));
  expect(Object.values(store.getState().game!.nightProgress).some(p => p.status === "done")).toBe(true);
  expect(store.getState().game!.players[id]).toEqual(before);
  expect(publishPrivatePacket).not.toHaveBeenCalled();
});

it.each(["soldier", "monk"])("Drunk shown %s has no generic information editor", shown => {
  player("drunk", shown);
  runningNight();
  expect(store.getState().advancePhase().ok).toBe(true);
  expect(store.getState().advancePhase().ok).toBe(true);
  expect(store.getState().game).toMatchObject({ phase: "night", day: 2 });
  render(<NightOrderPanel game={store.getState().game!} script={troubleBrewing} onClose={() => {}} />);
  expect(screen.queryByLabelText("Information")).toBeNull();
  expect(screen.queryByText("Give information")).toBeNull();
});

it("only explicit Send submits the reviewed content, and Sent requires an acknowledgement", async () => {
  const { id } = player("imp", "imp");
  store.getState().setBluffs(id, ["chef"]);
  store.getState().setLobby({ code: "BCDF2345", uid: "host", sessionId: "session", status: "live" });
  useSessionRuntime.setState({ backend: new SessionWriter(new MemoryRoomBackend(), "BCDF2345", "session") });
  let finish!: () => void;
  vi.mocked(publishPrivatePacket).mockImplementation(async (_id, reviewed) => {
    usePacketDeliveryState.setState({ queued: { ["BCDF2345/" + id]: true } });
    await new Promise<void>(resolve => { finish = resolve; });
    const game = store.getState().game!;
    store.setState({ game: { ...game, players: { ...game.players, [id]: { ...game.players[id]!, publishedPacket: { id: "sent", payload: reviewed.payload } } } } });
    usePacketDeliveryState.setState({ queued: {}, receipts: { ["BCDF2345/" + id]: "sent" } });
  });
  render(<PlayerInformation playerId={id} purpose="setup" />);
  expect(publishPrivatePacket).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Send bluffs" }));
  expect(publishPrivatePacket).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status")).toHaveTextContent("Sending");
  expect(screen.queryByText("Sent to player view")).toBeNull();
  await act(async () => finish());
  expect(screen.getByRole("status")).toHaveTextContent("Sent to player view");
  act(() => { runningNight(); store.getState().advancePhase(); store.getState().advancePhase(); });
  expect(store.getState().game).toMatchObject({ phase: "night", day: 2 });
  expect(screen.getByRole("status")).toHaveTextContent("Sent to player view");
  expect(screen.getByRole("button", { name: "Send bluffs" })).toBeDisabled();
  expect(publishPrivatePacket).toHaveBeenCalledTimes(1);
});
it("ordinary poisoned Empath can optionally receive manually chosen information", () => {
  const { id } = player("empath", "empath");
  store.getState().setStatus(id, "poisoned", true);
  runningNight();
  render(<NightOrderPanel game={store.getState().game!} script={troubleBrewing} onClose={() => {}} />);
  fireEvent.click(screen.getByText("Give information"));
  fireEvent.change(screen.getByLabelText("Information"), { target: { value: "0" } });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(publishPrivatePacket).not.toHaveBeenCalled();
});

it("unchanged Demon bluffs are not a task on later nights", () => {
  const { id } = player("imp", "imp");
  store.getState().setBluffs(id, ["chef"]);
  const game = store.getState().game!;
  store.setState({ game: { ...game, day: 2, phase: "night", players: { ...game.players, [id]: { ...game.players[id]!, publishedPacket: {
    id: "sent", forDay: 1, forPhase: "night", payload: { shownRole: "imp", shownAlignment: "evil", bluffs: ["chef"] },
  } } } } });
  render(<NightOrderPanel game={store.getState().game!} script={troubleBrewing} onClose={() => {}} />);
  expect(screen.queryByText(/setup information/i)).toBeNull();
  expect(screen.queryByRole("button", { name: "Send bluffs" })).toBeNull();
});

// Phase 9C.5 (OPUS-005): the private extraText field becomes component-local
// draft state. Typing must never reach the store; blur or Send commits the
// final value exactly once, and Send always publishes from now-authoritative
// (post-commit) state rather than a stale render-time preview.
describe("private extra-text edit-session boundary (Phase 9C.5)", () => {
  it("typing stays local; blur commits exactly once and the live preview reflects the draft before commit", () => {
    const { id, other } = player();
    store.getState().setFakeMinions(id, [other]);
    const seqBefore = store.getState().localSeq;
    const undoLengthBefore = store.getState().undoStack.length;
    render(<PlayerInformation playerId={id} purpose="result" />);
    const info = screen.getByLabelText("Information");
    const gameBeforeTyping = store.getState().game;

    fireEvent.change(info, { target: { value: "Choose t" } });
    fireEvent.change(info, { target: { value: "Choose two players tonight" } });

    // Before blur: authoritative extraText, localSeq, and undo are all
    // untouched, and the `game` reference itself never changed.
    expect(info).toHaveValue("Choose two players tonight");
    expect(store.getState().game!.players[id]!.privateInfo?.extraText).toBeUndefined();
    expect(store.getState().localSeq).toBe(seqBefore);
    expect(store.getState().undoStack.length).toBe(undoLengthBefore);
    expect(store.getState().game).toBe(gameBeforeTyping);

    // The Player View preview is derived live from the uncommitted draft via
    // a transient overlay — never written to the store.
    const preview = screen.getByText("Player view").closest("details")!;
    expect(preview).toHaveTextContent("Choose two players tonight");
    expect(store.getState().game!.players[id]).not.toHaveProperty("packetPreview");

    fireEvent.blur(info);

    expect(store.getState().game!.players[id]!.privateInfo?.extraText).toBe("Choose two players tonight");
    expect(store.getState().localSeq).toBe(seqBefore + 1);
    expect(store.getState().undoStack.length).toBe(undoLengthBefore + 1);
  });

  it("an unchanged extra-text edit session produces zero authoritative mutations", () => {
    const { id, other } = player();
    store.getState().setFakeMinions(id, [other]);
    store.getState().setPrivateText(id, "Steady message");
    const seqBefore = store.getState().localSeq;
    const undoLengthBefore = store.getState().undoStack.length;
    render(<PlayerInformation playerId={id} purpose="result" />);
    const info = screen.getByLabelText("Information");

    fireEvent.change(info, { target: { value: "Steady message!" } });
    fireEvent.change(info, { target: { value: "Steady message" } });
    fireEvent.blur(info);

    expect(store.getState().game!.players[id]!.privateInfo?.extraText).toBe("Steady message");
    expect(store.getState().localSeq).toBe(seqBefore);
    expect(store.getState().undoStack.length).toBe(undoLengthBefore);
  });

  it("clearing previously committed extra text removes it via existing setter semantics, with a single edit-session mutation and no stale preview", () => {
    const { id, other } = player();
    store.getState().setFakeMinions(id, [other]);
    store.getState().setPrivateText(id, "Existing message");
    expect(store.getState().game!.players[id]!.privateInfo?.extraText).toBe("Existing message");
    const seqBefore = store.getState().localSeq;
    const undoLengthBefore = store.getState().undoStack.length;

    render(<PlayerInformation playerId={id} purpose="result" />);
    const info = screen.getByLabelText("Information");
    expect(info).toHaveValue("Existing message");

    fireEvent.change(info, { target: { value: "" } });
    fireEvent.blur(info);

    expect(store.getState().game!.players[id]!.privateInfo?.extraText).toBeUndefined();
    expect(store.getState().localSeq).toBe(seqBefore + 1);
    expect(store.getState().undoStack.length).toBe(undoLengthBefore + 1);
    expect(screen.queryByText("Existing message")).toBeNull();
  });

  it("Send commits a dirty draft exactly once, without requiring blur first, and publishes text built from now-authoritative state", async () => {
    const { id, other } = player();
    store.getState().setFakeMinions(id, [other]);
    store.getState().setLobby({ code: "BCDF2345", uid: "host", sessionId: "session", status: "live" });
    useSessionRuntime.setState({ backend: new SessionWriter(new MemoryRoomBackend(), "BCDF2345", "session") });
    let published: { payload: Record<string, unknown>; fingerprint: string } | undefined;
    vi.mocked(publishPrivatePacket).mockImplementation(async (_id, reviewed) => {
      published = reviewed;
    });

    render(<PlayerInformation playerId={id} purpose="result" />);
    const info = screen.getByLabelText("Information");
    fireEvent.change(info, { target: { value: "Choose two players tonight" } });
    // No blur — the draft is still only local UI state at this point.
    expect(store.getState().game!.players[id]!.privateInfo?.extraText).toBeUndefined();
    const seqBefore = store.getState().localSeq;
    const undoLengthBefore = store.getState().undoStack.length;

    fireEvent.click(screen.getByRole("button", { name: "Send to player view" }));

    // Send committed the dirty draft exactly once — one normal game mutation.
    expect(store.getState().game!.players[id]!.privateInfo?.extraText).toBe("Choose two players tonight");
    expect(store.getState().localSeq).toBe(seqBefore + 1);
    expect(store.getState().undoStack.length).toBe(undoLengthBefore + 1);

    expect(publishPrivatePacket).toHaveBeenCalledTimes(1);
    // The published preview is the canonical one, rebuilt from committed
    // authoritative state — never a stale render-time preview.
    expect(published?.payload.extraText).toBe("Choose two players tonight");
    expect(published?.payload.minions).toEqual([{ id: other, name: "Bob", seat: 1 }]);
  });

  // Luna verification revision: commitExtraTextDraft must dirty-check the
  // *effective* value setPrivateText would store (whitespace-only canonicalizes
  // to absence), not the raw draft string, so a whitespace-only edit against
  // an already-absent value is never treated as a real mutation.
  describe("whitespace-only drafts canonicalize to absence before the dirty check", () => {
    it("entering whitespace-only text when extraText is already absent is a no-op", () => {
      const { id } = player();
      const seqBefore = store.getState().localSeq;
      const undoLengthBefore = store.getState().undoStack.length;
      const gameBefore = store.getState().game;

      commitExtraTextDraft(id, "   ");

      expect(store.getState().game!.players[id]!.privateInfo?.extraText).toBeUndefined();
      expect(store.getState().localSeq).toBe(seqBefore);
      expect(store.getState().undoStack.length).toBe(undoLengthBefore);
      expect(store.getState().game).toBe(gameBefore);
    });

    it("changing existing extraText to whitespace-only removes it with exactly one mutation", () => {
      const { id } = player();
      store.getState().setPrivateText(id, "Existing message");
      expect(store.getState().game!.players[id]!.privateInfo?.extraText).toBe("Existing message");
      const seqBefore = store.getState().localSeq;
      const undoLengthBefore = store.getState().undoStack.length;

      commitExtraTextDraft(id, "   ");

      expect(store.getState().game!.players[id]!.privateInfo?.extraText).toBeUndefined();
      expect(store.getState().localSeq).toBe(seqBefore + 1);
      expect(store.getState().undoStack.length).toBe(undoLengthBefore + 1);
    });

    it("re-running commitExtraTextDraft with the same whitespace draft after removal is a no-op", () => {
      const { id } = player();
      store.getState().setPrivateText(id, "Existing message");

      commitExtraTextDraft(id, "   ");
      expect(store.getState().game!.players[id]!.privateInfo?.extraText).toBeUndefined();
      const seqAfterRemoval = store.getState().localSeq;
      const undoLengthAfterRemoval = store.getState().undoStack.length;

      commitExtraTextDraft(id, "   ");

      expect(store.getState().localSeq).toBe(seqAfterRemoval);
      expect(store.getState().undoStack.length).toBe(undoLengthAfterRemoval);
    });
  });
});
