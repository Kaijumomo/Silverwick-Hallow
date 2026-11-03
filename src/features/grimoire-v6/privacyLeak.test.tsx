// F-14: Hide Tokens keeps the full lock. Cards and overlays opened BEFORE it is switched on must not stay on screen.
import { afterEach, beforeEach, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { VotingProvider } from "@/features/voting/VotingWorkspace";
import { GrimoireV6Screen } from "./GrimoireV6Screen";
import { useV6Ui } from "./v6Store";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { proofGame, proofScript } from "@/test/proofFixtures";

beforeEach(() => {
  useShellStore.getState().reset(); useV6Ui.getState().reset(); usePrivacyStore.setState({ enabled: false });
  store.setState({ game: proofGame(["gambler", "monk", "empath", "chef", "imp", "saint", "poisoner"], "day", 2), lobby: null, undoStack: [], localSeq: 0, selectedPlayerId: null, customScripts: { [proofScript.id]: proofScript } });
});
afterEach(() => { cleanup(); usePrivacyStore.setState({ enabled: false }); });

const text = () => document.body.textContent ?? "";

it("an open player card, character picker and full-screen reveal are gone once tokens are hidden", () => {
  const { rerender } = render(<VotingProvider><GrimoireV6Screen /></VotingProvider>);
  act(() => { store.getState().selectPlayer("p3"); useV6Ui.getState().set({ card: true }); });
  expect(text()).toContain("Chef");
  act(() => { useV6Ui.getState().set({ picker: { mode: "show", title: "This Character" }, show: { kind: "char", title: "You Are", roleId: "imp" } as never }); });
  act(() => { usePrivacyStore.setState({ enabled: true }); });
  rerender(<VotingProvider><GrimoireV6Screen /></VotingProvider>);
  const after = text();
  for (const word of ["Chef", "Imp", "Gambler", "Saint", "Poisoner", "Empath", "Monk"]) expect(after, word).not.toContain(word);
  expect(useV6Ui.getState().card).toBe(false);
  expect(useV6Ui.getState().picker).toBeNull();
  expect(useV6Ui.getState().show).toBeNull();
});
