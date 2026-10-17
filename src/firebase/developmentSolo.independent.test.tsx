import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RoomBackend } from "./backend";

const connection = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("./session", async original => ({ ...await original<typeof import("./session")>(), connectFirebase: connection.connect }));

import { App } from "@/app/App";
import { __setEnvOverrideForTests } from "./config";
import { DEVELOPMENT_FIREBASE_CONFIG as approved } from "./development";
import { endGameWithIntent } from "./terminal";
import { useSessionRuntime } from "./storytellerSync";
import { captureCharacterActionContext, captureVotingContext, useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useShellStore } from "@/stores/shellStore";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { buildRegistry } from "@/data/roleRegistry";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { deriveNightWork, stepResolved } from "@/features/nightOrder/nightWork";
import { request } from "@/test/proofFixtures";
import { endGameEligibility } from "@/stores/endGameEligibility";

const state = () => store.getState();
const game = () => state().game!;
const environment = { script: troubleBrewing, registry: buildRegistry(troubleBrewing), semantics: CANONICAL_ABILITY_SEMANTICS };
const ok = (result: { ok: boolean; message?: string }) => expect(result, result.message).toMatchObject({ ok: true });
const id = (role: string) => Object.values(game().players).find(player => player.actualRole === role)!.id;
const target = (role: string) => ({ kind: "participant" as const, participants: [{ playerId: id(role), participantId: game().players[id(role)]!.participantId! }] });

beforeEach(() => {
  localStorage.clear(); connection.connect.mockReset(); usePrivacyStore.getState().reset(); useShellStore.getState().reset();
  store.setState({ game: null, lobby: null, view: "home", undoStack: [], localSeq: 0, sync: null, terminalClose: null, finishedGameUndo: null, canUndoFinishedGame: false });
  useSessionRuntime.setState({ backend: null, status: "idle", online: {}, errors: {}, error: null, failure: null, unattachedCleanupFailures: [] });
  __setEnvOverrideForTests({ MODE: "development", VITE_FIREBASE_ENVIRONMENT: "development", VITE_FIREBASE_API_KEY: approved.apiKey,
    VITE_FIREBASE_AUTH_DOMAIN: approved.authDomain, VITE_FIREBASE_DATABASE_URL: approved.databaseURL, VITE_FIREBASE_PROJECT_ID: approved.projectId,
    VITE_FIREBASE_STORAGE_BUCKET: approved.storageBucket, VITE_FIREBASE_MESSAGING_SENDER_ID: approved.messagingSenderId, VITE_FIREBASE_APP_ID: approved.appId });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ media: query, matches: false, addEventListener() {}, removeEventListener() {} })));
});
afterEach(() => { cleanup(); __setEnvOverrideForTests(null); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("independent development preview local game isolation", () => {
  it.each(["authenticated without database grants", "authentication unavailable"])("completes a zero-phone game with %s", async authentication => {
    // This denies every database operation. Auth bootstrap itself is existing
    // application behavior; local play must not depend on hosted admission.
    const denied = vi.fn(() => { throw new Error("Permission denied: no development game grant"); });
    const backend = Object.fromEntries(["get", "set", "update", "transaction", "setIfAbsent", "subscribe", "onDisconnectSet", "subscribeConnection"].map(key => [key, denied])) as unknown as RoomBackend;
    if (authentication === "authentication unavailable") {
      connection.connect.mockRejectedValue(new Error("Authentication unavailable"));
      vi.spyOn(console, "warn").mockImplementation(() => {});
    } else connection.connect.mockResolvedValue({ backend, uid: "unapproved-development-user" });
    render(<App />);
    await waitFor(() => expect(connection.connect).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "New Game" }));
    fireEvent.click(screen.getByRole("button", { name: "Trouble Brewing" }));
    for (let index = 0; index < 5; index++) fireEvent.click(screen.getByRole("button", { name: "One fewer player" })); // 10 -> 5 players
    fireEvent.click(screen.getByRole("button", { name: /Fabled & Loric ›/ }));
    fireEvent.click(screen.getByRole("button", { name: /Skip to players ›/ }));
    fireEvent.click(screen.getByRole("button", { name: /Play offline/ }));
    for (let index = 0; index < 5; index++) fireEvent.change(screen.getByLabelText(`Seat ${["I", "II", "III", "IV", "V"][index]}`), { target: { value: `Local ${index + 1}` } });
    fireEvent.click(screen.getByRole("button", { name: "Begin the night" }));
    await waitFor(() => expect(game()?.phase).toBe("setup"));
    expect(state().lobby).toBeNull();
    expect(Object.values(game().players).filter(player => !player.isEmpty).map(player => player.name)).toEqual(["Local 1", "Local 2", "Local 3", "Local 4", "Local 5"]);
    await act(async () => {
      state().setRolePool(["chef", "soldier", "slayer", "poisoner", "imp"]); ok(state().dealRolePool());
      for (const player of Object.values(game().players)) state().showAssignedRole(player.id);
      ok(state().revealRoles()); ok(state().beginNightOne());
      ok(state().resolveAbility(request(game(), id("poisoner"), "poisoner", { target: target("poisoner") }, { withStep: true, completeStep: true }), undefined, captureCharacterActionContext()));
      ok(state().resolveAbility(request(game(), id("chef"), "chef", {}, { withStep: true, completeStep: true }), undefined, captureCharacterActionContext()));
      for (const step of deriveNightWork(game(), environment).steps) {
        if (stepResolved(game(), step)) continue;
        expect(step.kind).toBe("global"); ok(state().setNightStepStatus(game().day, step.stepKey, "done", captureCharacterActionContext()));
      }
      ok(state().advancePhase(captureVotingContext())); expect(game().phase).toBe("day");
      ok(state().resolveAbility(request(game(), id("slayer"), "slayer", { target: target("imp") }, { invocationPath: "dayEntry" }), undefined, captureCharacterActionContext()));
      expect(endGameEligibility(game(), environment)).toMatchObject({ kind: "verified", team: "good" });
      ok(await endGameWithIntent({ kind: "declare", winner: "good" })); expect(game().phase).toBe("ended");
    });
    const ended = structuredClone(game()), saved = localStorage.getItem("new-blood-st")!;
    await act(async () => {
      store.setState({ game: null, undoStack: [] }); localStorage.setItem("new-blood-st", saved); await store.persist.rehydrate();
      expect(game()).toEqual(ended); ok(state().undoFinishedGame()); expect(game().phase).toBe("day");
      ok(await endGameWithIntent({ kind: "declare", winner: "good" }));
    });
    expect(game().gameSchemaVersion).toBe(28); expect(game().code).toBe(""); expect(game().storytellerUid).toBe("local");
    expect(state().lobby).toBeNull(); expect(useSessionRuntime.getState().status).toBe("idle");
    expect(denied).not.toHaveBeenCalled(); expect(connection.connect).toHaveBeenCalledTimes(1);
  });
});
