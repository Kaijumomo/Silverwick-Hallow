// PO 2026-11-14 (SV-1 review, C3): the Slayer's Day action shows only where the script has the Slayer, official or custom.
// A Slayer seated off the script keeps it; an unknown script keeps today's behaviour.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { VotingProvider } from "@/features/voting/VotingWorkspace";
import { GrimoireV6Screen } from "../GrimoireV6Screen";
import { useV6Ui } from "../v6Store";
import { slayerRowShown } from "./slayer";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { canonicalRoles } from "@/data/canonical";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { sectsAndViolets } from "@/data/scripts/sectsAndViolets";
import { proofGame } from "@/test/proofFixtures";
import type { Script } from "@/stores/types";

const custom = (id: string, roles: string[]): Script => ({ id, name: id, characters: canonicalRoles(roles) });
function dayCard(script: Script, roles: string[]) {
  const game = { ...proofGame(roles, "day", 2), scriptId: script.id };
  store.setState({ game, lobby: null, undoStack: [], localSeq: 0, customScripts: { [script.id]: script } });
  useV6Ui.getState().set({ panel: "night" });
  render(<VotingProvider><GrimoireV6Screen /></VotingProvider>);
}
const shotButton = () => screen.queryByRole("button", { name: "Take a shot" });

beforeEach(() => {
  useSessionRuntime.setState({ backend: null });
  useShellStore.getState().reset();
  useV6Ui.getState().reset();
  usePrivacyStore.setState({ enabled: false });
});
afterEach(() => cleanup());

it("Trouble Brewing: the Slayer row shows, and with no Slayer in play any shot is a bluff", () => {
  dayCard(troubleBrewing, ["chef", "imp", "empath", "monk", "poisoner"]);
  expect(shotButton()).toBeInTheDocument();
  expect(screen.getByText("Any shot is a bluff")).toBeInTheDocument();
});

it("Sects & Violets: no Slayer row (and no empty Day actions heading)", () => {
  dayCard(sectsAndViolets, ["clockmaker", "vortox", "dreamer", "oracle", "witch"]);
  expect(shotButton()).toBeNull();
  expect(screen.queryByText("Day actions")).toBeNull();
});

it("custom scripts follow their own list", () => {
  dayCard(custom("with-slayer", ["clockmaker", "slayer", "vortox", "witch"]), ["clockmaker", "vortox", "dreamer", "oracle"]);
  expect(shotButton()).toBeInTheDocument();
  cleanup();
  dayCard(custom("without-slayer", ["clockmaker", "dreamer", "vortox", "witch", "oracle"]), ["clockmaker", "vortox", "dreamer", "oracle"]);
  expect(shotButton()).toBeNull();
});

it("a Slayer seated off the script keeps the row; an unknown script keeps it too", () => {
  dayCard(custom("without-slayer-2", ["clockmaker", "dreamer", "vortox", "witch", "oracle"]), ["slayer", "vortox", "dreamer", "oracle"]);
  expect(shotButton()).toBeInTheDocument();
  expect(slayerRowShown({ script: undefined }, null)).toBe(true);
});
