// Package 1: the Home -> Player name hand-off lands in the EXISTING join form
// only, once, and only for the lobby it was written for. Join logic is mocked
// out: this proves pre-fill, not Firebase behaviour (covered elsewhere).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { usePlayerStore } from "@/stores/playerStore";
import { __setEnvOverrideForTests, clearFirebaseConfig, saveFirebaseConfig } from "@/firebase/config";

vi.mock("@/firebase/playerSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/firebase/playerSync")>();
  return { ...actual, usePlayerSync: () => {}, applyJoinIntent: vi.fn(async () => {}) };
});
vi.mock("@/firebase/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/firebase/session")>();
  return { ...actual, connectFirebase: async () => ({ backend: {} as never, uid: "alice" }) };
});

import { PlayerScreen } from "./PlayerScreen";
import { JOIN_PREFILL_KEY, peekJoinPrefill, writeJoinPrefill } from "@/features/home/joinPrefill";

const CODE = "BCDF2345";
const nameInput = () => screen.getByLabelText("Your name") as HTMLInputElement;

beforeEach(() => {
  __setEnvOverrideForTests({});
  saveFirebaseConfig({ apiKey: "AIzaSyTEST", databaseURL: "https://example-default-rtdb.firebaseio.com", projectId: "example-project" });
  usePlayerStore.getState().reset();
  window.sessionStorage.clear();
});
afterEach(() => { cleanup(); clearFirebaseConfig(); __setEnvOverrideForTests(null); });

describe("join form pre-fill from Home", () => {
  it("pre-fills the name for the matching code (StrictMode-safe) and consumes the hand-off", async () => {
    writeJoinPrefill("Ada", CODE);
    render(<StrictMode><PlayerScreen initialCode={CODE} /></StrictMode>);
    expect(await screen.findByLabelText("Game code")).toHaveValue(CODE);
    expect(nameInput()).toHaveValue("Ada");
    expect(window.sessionStorage.getItem(JOIN_PREFILL_KEY)).toBeNull();
  });

  it("does not leak into a different lobby's join, and is still cleared", async () => {
    writeJoinPrefill("Ada", CODE);
    render(<PlayerScreen initialCode="ZZZZ2345" />);
    await screen.findByLabelText("Game code");
    expect(nameInput()).toHaveValue("");
    expect(peekJoinPrefill(CODE)).toBeNull();
  });

  it("an ordinary ?join= link without a hand-off leaves the name empty", async () => {
    render(<PlayerScreen initialCode={CODE} />);
    await screen.findByLabelText("Game code");
    expect(nameInput()).toHaveValue("");
  });
});
