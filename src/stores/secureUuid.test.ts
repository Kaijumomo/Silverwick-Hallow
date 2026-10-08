import { afterEach, describe, expect, it, vi } from "vitest";
import { secureUuid } from "./secureUuid";
import { useStorytellerStore as store } from "./storytellerStore";
import { setupGame, setupScript, standardRoles } from "@/test/setupFixtures";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("secure UUID compatibility", () => {
  it("retains the browser's native cryptographic UUID generator when available", () => {
    const randomUUID = vi.fn(() => "00112233-4455-4677-8899-aabbccddeeff");
    const getRandomValues = vi.fn();
    vi.stubGlobal("crypto", { randomUUID, getRandomValues });
    expect(secureUuid()).toBe("00112233-4455-4677-8899-aabbccddeeff");
    expect(randomUUID).toHaveBeenCalledOnce();
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it("uses 16 cryptographic bytes and preserves UUID v4 version/variant bits without randomUUID", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.forEach((_, i) => { bytes[i] = i; });
      return bytes;
    });
    vi.stubGlobal("crypto", { getRandomValues });
    const insecureRandom = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("Not cryptographic"); });
    expect(secureUuid()).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(getRandomValues.mock.calls[0]![0]).toBeInstanceOf(Uint8Array);
    expect(getRandomValues.mock.calls[0]![0]).toHaveLength(16);
    expect(insecureRandom).not.toHaveBeenCalled();
  });

  it("fails explicitly rather than inventing weak identifiers when secure entropy is unavailable", () => {
    vi.stubGlobal("crypto", undefined);
    const insecureRandom = vi.spyOn(Math, "random");
    expect(() => secureUuid()).toThrow("Secure random generation is unavailable");
    expect(insecureRandom).not.toHaveBeenCalled();
  });

  it("completes a fresh private deal using getRandomValues when the tablet HTTP origin has no randomUUID", () => {
    const getRandomValues = vi.fn(globalThis.crypto.getRandomValues.bind(globalThis.crypto));
    vi.stubGlobal("crypto", { getRandomValues });
    const game = setupGame(standardRoles(5), { rolePool: [] });
    for (const player of Object.values(game.players)) {
      player.actualRole = ""; player.shownRole = null; player.shownAlignment = null;
    }
    store.setState({ game, undoStack: [], seatSwapUndo: [], lobby: null, terminalClose: null,
      customScripts: { [setupScript.id]: setupScript } });
    expect(store.getState().dealRolePool(standardRoles(5))).toEqual({ ok: true });
    const after = store.getState();
    expect(after.game).toMatchObject({ setupRolesDealt: true, setupRolesRevealed: false, phase: "setup", rolePool: [] });
    const players = Object.values(after.game!.players);
    expect(players.map(p => p.actualRole).sort()).toEqual(standardRoles(5).sort());
    expect(new Set(players.map(p => p.packetEpoch)).size).toBe(5);
    for (const player of players) expect(player.packetEpoch).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(getRandomValues.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(after.undoStack).toHaveLength(1);
  });
});
