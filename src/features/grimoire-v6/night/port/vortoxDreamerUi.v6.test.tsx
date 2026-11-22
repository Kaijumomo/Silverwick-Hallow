// SV-5j -- the Dreamer's card under a Vortox: the card's Vortox line, both tokens picked by the Storyteller, and the chosen player's
// own character locked in the picker for both picks.
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ModernNightPanel } from "@/test/nightTestGuide";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { useV6Ui } from "@/features/grimoire-v6/v6Store";
import { useInfoShow } from "@/features/grimoire-v6/info/showStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { participantStepKey } from "@/stores/nightProgress";
import { pickSeatIfPicking, useTargetPicker } from "@/features/abilities/abilityUi";
import { openInStore, proofGame, proofScript } from "@/test/proofFixtures";

const game = () => store.getState().game!;
function Guide() { const g = store(s => s.game)!; return <ModernNightPanel game={g} script={proofScript} visible onClose={() => {}} />; }
function show() {
  const g = proofGame(["dreamer", "vortox", "savant", "witch", "sage", "mutant"]);
  openInStore(g);
  useShellStore.getState().setNightCursor({ day: g.day, stepKey: participantStepKey(g.players.p0!.participantId!, g.players.p0!.shownRole!) });
  return render(<StrictMode><Guide /></StrictMode>);
}
const tap = (id: string) => act(() => { pickSeatIfPicking(game(), id); });
const picker = () => { const open = useV6Ui.getState().picker; return open?.mode === "show" ? open : undefined; };
const pickCharacter = (roleId: string) => { let refusal: string | undefined; act(() => { refusal = picker()?.onPick?.(roleId) ?? undefined; }); return refusal; };
beforeEach(() => { localStorage.clear(); store.setState({ game: null, lobby: null, terminalClose: null, undoStack: [] }); useSessionRuntime.setState({ backend: null, status: "idle" }); useShellStore.getState().reset(); usePrivacyStore.setState({ enabled: false }); useTargetPicker.getState().cancel(); useV6Ui.getState().set({ picker: null }); useInfoShow.getState().clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("the Savant chosen: the Vortox pill, the Savant locked for the good pick, then the evil pick; one commit", () => {
  show();
  expect(screen.getByText(/· false info/)).toHaveTextContent(/^Vortox ?· false info$/);
  tap("p2");
  expect(picker()).toMatchObject({ title: "Choose the good character to show", types: ["townsfolk", "outsider"], exclude: ["savant"] });
  expect(screen.getByText("Neither token may be the Savant.")).toBeInTheDocument();
  expect(pickCharacter("savant")).toBeTruthy();
  expect(pickCharacter("philosopher")).toBeUndefined();
  expect(picker()).toMatchObject({ title: "Choose the evil character to show", types: ["minion", "demon"], exclude: ["savant"] });
  expect(pickCharacter("nodashii")).toBeUndefined();
  expect(game().informationDeliveries.at(-1)!.values).toEqual([
    expect.objectContaining({ requirementId: "player" }),
    { requirementId: "goodCharacter", kind: "role", roleId: "philosopher" },
    { requirementId: "evilCharacter", kind: "role", roleId: "nodashii" },
  ]);
  expect(store.getState().undoStack).toHaveLength(1);
});
