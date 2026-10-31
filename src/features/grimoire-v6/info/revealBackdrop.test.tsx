import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { makeSTPlayer } from "@/test/fixtures";
import { setupGame, setupScript, standardRoles } from "@/test/setupFixtures";
import { GrimoireV6Screen } from "../GrimoireV6Screen";
import { GRAIN_MULTIPLY, GRAIN_OVERLAY, REVEAL_BACKDROP } from "../revealGrain";
import { useV6Ui } from "../v6Store";
import { presentCharacter } from "./actions";
import { useInfoShow } from "./showStore";

function reset() {
  const base = setupGame(standardRoles(9), { phase: "night", day: 2 });
  const players = Object.fromEntries(Object.entries(base.players).map(([id, p]) => [id, makeSTPlayer({ ...p })]));
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ status: "idle", backend: null });
  useV6Ui.getState().reset();
  useInfoShow.getState().clear();
  store.setState({ game: { ...base, players }, lobby: null, terminalClose: null, undoStack: [], selectedPlayerId: null, customScripts: { [setupScript.id]: setupScript } });
}
beforeEach(reset);
afterEach(cleanup);

describe("Reveal backdrop (tablet paint fix)", () => {
  it("draws the grain inside one backdrop element and keeps the glow flicker, with no blend-mode layer", () => {
    render(<GrimoireV6Screen />);
    act(() => { presentCharacter("This Character", "soldier"); });
    const dialog = screen.getByRole("dialog", { name: "This Character" });
    const blended = [dialog, ...Array.from(dialog.querySelectorAll<HTMLElement>("*"))].filter((el) => /mix-blend-mode/i.test(el.getAttribute("style") ?? ""));
    expect(blended).toEqual([]);

    const backdrop = dialog.firstElementChild as HTMLElement;
    expect(backdrop.style.backgroundBlendMode).toBe("multiply, overlay, normal, normal, normal");
    expect(backdrop.style.backgroundImage).toContain(GRAIN_MULTIPLY);
    expect(backdrop.style.backgroundImage).toContain(GRAIN_OVERLAY);
    expect(backdrop.style.backgroundImage.match(/radial-gradient/g)).toHaveLength(3);

    const flickering = Array.from(dialog.children).filter((el) => /swFlicker/.test(el.getAttribute("style") ?? ""));
    expect(flickering).toHaveLength(1);
    expect(within(dialog).getByText("Soldier")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: /Return to Grimoire/ }));
    expect(screen.queryByRole("dialog", { name: "This Character" })).toBeNull();
  });

  it("points at textures that ship with the app and keeps the V2 backdrop's base colour", () => {
    for (const url of [GRAIN_OVERLAY, GRAIN_MULTIPLY]) {
      const file = `public${url.replace(/^\/?/, "/")}`;
      expect(existsSync(file), file).toBe(true);
      expect(readFileSync(file).subarray(0, 4).toString("latin1")).toBe("RIFF");
    }
    expect(REVEAL_BACKDROP.backgroundColor).toBe("#0d0607");
  });
});
