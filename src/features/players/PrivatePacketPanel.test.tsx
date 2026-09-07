import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PrivatePacketPanel } from "./PrivatePacketPanel";
import { PrivateInformation } from "@/features/player/PrivateInformation";
import { SealedCard } from "@/features/player/PlayerScreen";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { usePacketDeliveryState } from "@/firebase/packetDeliveryState";
import { NightOrderPanel } from "@/features/nightOrder/NightOrderPanel";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { usePrivacyStore } from "@/stores/privacyStore";

beforeEach(() => {
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
describe("private information workflow UI", () => {
  it("requires preview, displays only player-safe content, and re-review after edits", () => {
    const { id, other } = player();
    store.getState().setFakeMinions(id, [other]);
    render(<PrivatePacketPanel playerId={id} />);
    fireEvent.change(screen.getByLabelText("Information to send"), { target: { value: "Choose two players tonight" } });
    expect(screen.getByRole("status")).toHaveTextContent("configured");
    expect(screen.queryByLabelText("Player preview")).toBeNull();
    expect(screen.getByRole("button", { name: "Publish packet" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Preview packet" }));
    const preview = screen.getByLabelText("Player preview");
    expect(preview).toHaveTextContent("Imp · evil");
    expect(preview).toHaveTextContent("Bob · seat 2");
    expect(preview).toHaveTextContent("Choose two players tonight");
    expect(preview).not.toHaveTextContent(/lunatic|fake|actual|simulated/i);
    expect(screen.getByRole("status")).toHaveTextContent("Previewed");
    fireEvent.change(screen.getByLabelText("Information to send"), { target: { value: "Changed" } });
    expect(screen.queryByLabelText("Player preview")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("configured");
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

  it("night sheet surfaces an unconfigured Lunatic packet even without a first-night Imp slot", () => {
    const { id } = player();
    store.getState().setPhase("night");
    render(<NightOrderPanel game={store.getState().game!} script={troubleBrewing} onClose={() => {}} />);
    expect(screen.getByRole("region", { name: "Private information for Alice" })).toHaveTextContent("not configured");
    act(() => store.getState().setPrivateText(id, "Pending information"));
    const task = screen.getByRole("region", { name: "Private information for Alice" });
    expect(within(task).getByRole("status")).toHaveTextContent("configured");
    expect(store.getState().game!.players[id]!.publishedPacket).toBeUndefined();
  });

  it("privacy mode replaces the night sheet with a neutral notice", () => {
    const { id } = player();
    store.getState().setPhase("night");
    usePrivacyStore.getState().setEnabled(true);
    render(<NightOrderPanel game={store.getState().game!} script={troubleBrewing} onClose={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("Privacy Mode On");
    expect(screen.getByText("Night details are hidden while Privacy Mode is on.")).toBeInTheDocument();
    expect(screen.queryByText("Imp")).toBeNull();
    expect(screen.queryByText("Fake Demon information")).toBeNull();
    expect(store.getState().game!.players[id]!.publishedPacket).toBeUndefined();
  });
});
