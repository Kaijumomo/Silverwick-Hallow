// Phase 9C.6 (OPUS-002): the Public Display device connection flow —
// capturing the UID from connectFirebase() (never the URL), fragment-token
// enrollment BEFORE subscribing, cleaning the URL on success, never blocking
// on a failed/stale fragment, and the new display-specific denial guidance.
// Real rules/real writer enrollment and revocation are proven in
// rules.spec.ts and contract.spec.ts; this file isolates the component's own
// sequencing and rendering contract with connectFirebase, publicDisplayAuth,
// and usePublicLobby all mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { __setEnvOverrideForTests, clearFirebaseConfig, saveFirebaseConfig } from "@/firebase/config";
import { CONNECTION_ERROR_MESSAGE } from "@/firebase/snapshots";
import type { PublicLobbyRecord } from "@/stores/types";
import type { UsePublicLobbyResult } from "@/firebase/publicSync";

const connectFirebaseMock = vi.fn();
vi.mock("@/firebase/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/firebase/session")>();
  return { ...actual, connectFirebase: () => connectFirebaseMock() };
});

const authorizePublicDisplayMock = vi.fn();
vi.mock("@/firebase/publicDisplayAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/firebase/publicDisplayAuth")>();
  return { ...actual, authorizePublicDisplay: (...args: unknown[]) => authorizePublicDisplayMock(...args) };
});

const usePublicLobbyMock = vi.fn<(backend: unknown, code: string | null) => UsePublicLobbyResult>();
vi.mock("@/firebase/publicSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/firebase/publicSync")>();
  return { ...actual, usePublicLobby: (backend: unknown, code: string | null) => usePublicLobbyMock(backend, code) };
});

import { generatePublicDisplayToken } from "@/firebase/publicDisplayAuth";
import { PublicDisplayScreen } from "./PublicDisplayScreen";

const validCfg = {
  apiKey: "AIzaSyTEST",
  databaseURL: "https://example-default-rtdb.firebaseio.com",
  projectId: "example-project",
};
const CODE = "ABCD2345";
const UID = "display-uid-123";
const TOKEN = generatePublicDisplayToken();

function makePublicLobby(): PublicLobbyRecord {
  return {
    code: CODE, scriptId: "tb", phase: "setup", day: 0,
    seatOrder: [], players: {}, fabled: [], lorics: [],
  };
}
const READY_RESULT: UsePublicLobbyResult = { publicLobby: makePublicLobby(), ended: false, loading: false, error: null };
const WAITING_RESULT: UsePublicLobbyResult = { publicLobby: null, ended: false, loading: true, error: null };

function setHash(hash: string) {
  window.history.replaceState(null, "", `?display=public&code=${CODE}${hash}`);
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  __setEnvOverrideForTests({});
  saveFirebaseConfig(validCfg);
  connectFirebaseMock.mockReset();
  connectFirebaseMock.mockResolvedValue({ backend: {} as never, uid: UID });
  authorizePublicDisplayMock.mockReset();
  authorizePublicDisplayMock.mockResolvedValue(undefined);
  usePublicLobbyMock.mockReset();
  usePublicLobbyMock.mockReturnValue(WAITING_RESULT);
  setHash("");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearFirebaseConfig();
  __setEnvOverrideForTests(null);
  setHash("");
});

describe("PublicDisplayScreen device connection flow (Phase 9C.6, OPUS-002)", () => {
  it("captures the UID returned by connectFirebase() and uses it for enrollment — never a UID from the URL", async () => {
    setHash(`#displayToken=${TOKEN}`);
    usePublicLobbyMock.mockReturnValue(READY_RESULT);

    render(<PublicDisplayScreen code={CODE} />);
    await act(async () => {});

    expect(connectFirebaseMock).toHaveBeenCalledTimes(1);
    expect(authorizePublicDisplayMock).toHaveBeenCalledTimes(1);
    const [, calledCode, calledUid, calledToken] = authorizePublicDisplayMock.mock.calls[0]!;
    expect(calledUid).toBe(UID);
    expect(calledCode).toBe(CODE);
    expect(calledToken).toBe(TOKEN);
  });

  it("does not attempt enrollment when no fragment token is present (cleaned-url refresh)", async () => {
    usePublicLobbyMock.mockReturnValue(READY_RESULT);

    render(<PublicDisplayScreen code={CODE} />);
    await act(async () => {});

    expect(connectFirebaseMock).toHaveBeenCalledTimes(1);
    expect(authorizePublicDisplayMock).not.toHaveBeenCalled();
    await waitFor(() => expect(usePublicLobbyMock.mock.calls.some(([b]) => b !== null)).toBe(true));
  });

  it("removes the token from the URL with history.replaceState after successful enrollment, keeping ?display=public&code=", async () => {
    setHash(`#displayToken=${TOKEN}`);
    usePublicLobbyMock.mockReturnValue(READY_RESULT);
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    render(<PublicDisplayScreen code={CODE} />);
    await act(async () => {});

    await waitFor(() => expect(replaceStateSpy).toHaveBeenCalled());
    const [, , cleanedUrl] = replaceStateSpy.mock.calls.at(-1)!;
    expect(String(cleanedUrl)).toBe(`${window.location.pathname}?display=public&code=${CODE}`);
    expect(String(cleanedUrl)).not.toContain(TOKEN);
    expect(window.location.hash).toBe("");
  });

  it("does not let the public subscription race ahead of a pending required enrollment", async () => {
    setHash(`#displayToken=${TOKEN}`);
    let resolveAuth: (() => void) | undefined;
    authorizePublicDisplayMock.mockImplementation(() => new Promise<void>(resolve => { resolveAuth = resolve; }));

    render(<PublicDisplayScreen code={CODE} />);
    await act(async () => {});

    // Enrollment is pending: the subscription must not have been handed a
    // live backend yet.
    expect(authorizePublicDisplayMock).toHaveBeenCalledTimes(1);
    expect(usePublicLobbyMock.mock.calls.every(([b]) => b === null)).toBe(true);

    resolveAuth?.();
    await act(async () => {});

    await waitFor(() => expect(usePublicLobbyMock.mock.calls.some(([b]) => b !== null)).toBe(true));
  });

  it("a failed/stale fragment enrollment does not block the current UID's normal public subscription", async () => {
    setHash(`#displayToken=${TOKEN}`);
    authorizePublicDisplayMock.mockRejectedValue(new Error("permission_denied"));
    usePublicLobbyMock.mockReturnValue(READY_RESULT);

    render(<PublicDisplayScreen code={CODE} />);
    await act(async () => {});

    expect(authorizePublicDisplayMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(usePublicLobbyMock.mock.calls.some(([b]) => b !== null)).toBe(true));
    // The screen is not made terminal by the failed enrollment — the normal
    // (already-authorized-by-a-prior-enrollment) view renders.
    expect(screen.queryByText("Lobby " + CODE + " not found")).toBeNull();
  });

  it("a denied /public read shows display-specific guidance, not the obsolete 'open from the storyteller's tab' text", async () => {
    usePublicLobbyMock.mockReturnValue({ publicLobby: null, ended: false, loading: false, error: CONNECTION_ERROR_MESSAGE });

    render(<PublicDisplayScreen code={CODE} />);
    await act(async () => {});

    expect(await screen.findByText(/no longer authorized/i)).toBeInTheDocument();
    expect(screen.getByText(/fresh Public Display link/i)).toBeInTheDocument();
    expect(screen.queryByText(/storyteller's browser tab/i)).toBeNull();
  });

  it("never renders the capability token, even when enrollment fails", async () => {
    setHash(`#displayToken=${TOKEN}`);
    authorizePublicDisplayMock.mockRejectedValue(new Error("permission_denied"));
    usePublicLobbyMock.mockReturnValue({ publicLobby: null, ended: false, loading: false, error: CONNECTION_ERROR_MESSAGE });

    render(<PublicDisplayScreen code={CODE} />);
    await act(async () => {});
    await screen.findByText(/no longer authorized/i);

    expect(document.body.textContent).not.toContain(TOKEN);
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it("an unrelated (non-authorization) error keeps its own specific message unchanged", async () => {
    usePublicLobbyMock.mockReturnValue({
      publicLobby: null, ended: false, loading: false,
      error: "This lobby does not exist or has expired.",
    });

    render(<PublicDisplayScreen code={CODE} />);
    await act(async () => {});

    expect(await screen.findByText("This lobby does not exist or has expired.")).toBeInTheDocument();
  });
});
