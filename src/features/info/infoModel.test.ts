import { beforeEach, describe, expect, it } from "vitest";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { captureInfoContext, changeInfoBluff } from "./infoCommands";
import { bluffChoiceError, infoStatistics, revisedBluffs, setupPayload } from "./infoModel";

beforeEach(() => {
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ status: "idle", backend: null });
  store.setState({ game: setupGame(undefined, { phase: "night", day: 1 }), lobby: null, terminalClose: null, undoStack: [], customScripts: { [setupScript.id]: setupScript } });
});
const game = () => store.getState().game!;
const demon = () => game().seatOrder.find(id => game().players[id]!.actualRole === "imp")!;

describe("Info bluff command boundaries", () => {
  it("sets, exchanges and clears compact per-player drafts with one Undo per change and no publication", () => {
    const id = demon();
    store.getState().setBluffs(id, ["monk", "ravenkeeper", "virgin"]);
    const before = game(), undo = store.getState().undoStack.length;
    expect(changeInfoBluff(captureInfoContext(), id, 0, "virgin")).toBeUndefined();
    expect(game().players[id]!.privateInfo!.bluffs).toEqual(["virgin", "ravenkeeper", "monk"]);
    expect(store.getState().undoStack).toHaveLength(undo + 1);
    expect(game().players[id]!.publishedPacket).toEqual(before.players[id]!.publishedPacket);
    expect(game().nightProgress).toEqual(before.nightProgress);
    expect(game().informationDeliveries).toEqual(before.informationDeliveries);
    expect(changeInfoBluff(captureInfoContext(), id, 1)).toBeUndefined();
    expect(game().players[id]!.privateInfo!.bluffs).toEqual(["virgin", "monk"]);
    store.getState().undo();
    expect(game().players[id]!.privateInfo!.bluffs).toEqual(["virgin", "ravenkeeper", "monk"]);
  });
  it("refuses dead in-play roles and evil characters, while retaining the Pope exception", () => {
    const id = demon(), first = game().seatOrder[0]!;
    store.setState({ game: { ...game(), players: { ...game().players, [first]: { ...game().players[first]!, alive: false } } } });
    expect(bluffChoiceError(game(), setupScript, id, "washerwoman")).toMatch(/in play/);
    expect(bluffChoiceError(game(), setupScript, id, "scarletwoman")).toMatch(/Townsfolk/);
    expect(bluffChoiceError({ ...game(), lorics: ["pope"] }, setupScript, id, "washerwoman")).toBeUndefined();
  });
  it.each(["apparent Demon", "Pope"])("allows an in-play good bluff for %s through the command with reversible private-only state", exception => {
    const id = demon(), original = game();
    store.setState({ game: exception === "Pope" ? { ...original, lorics: ["pope"] } : {
      ...original, players: { ...original.players, [id]: { ...original.players[id]!, actualRole: "lunatic", shownRole: "imp", behaviorMode: "fake_demon_behavior" } },
    } });
    const before = game(), undo = store.getState().undoStack.length;
    expect(changeInfoBluff(captureInfoContext(), id, 0, "washerwoman")).toBeUndefined();
    expect(game().players[id]!.privateInfo?.bluffs).toEqual(["washerwoman"]);
    expect(store.getState().undoStack).toHaveLength(undo + 1);
    expect(game().players[id]!.publishedPacket).toEqual(before.players[id]!.publishedPacket);
    expect(game().informationDeliveries).toEqual(before.informationDeliveries);
    expect(game().nightProgress).toEqual(before.nightProgress);
    expect(changeInfoBluff(captureInfoContext(), id, 1, "imp")).toMatch(/Townsfolk or Outsider/);
    expect(store.getState().undoStack).toHaveLength(undo + 1);
    store.getState().undo();
    expect(game().players[id]!.privateInfo?.bluffs).toEqual(before.players[id]!.privateInfo?.bluffs);
  });
  it("refuses an ordinary in-play bluff through the command without changing state or Undo", () => {
    const before = game(), undo = store.getState().undoStack;
    expect(changeInfoBluff(captureInfoContext(), demon(), 0, "washerwoman")).toMatch(/in play/);
    expect(game()).toBe(before);
    expect(store.getState().undoStack).toBe(undo);
  });
  it.each(["changed", "ended", "closing", "privacy", "connection"])("refuses %s callbacks without Undo or data change", condition => {
    const context = captureInfoContext(), id = demon();
    if (condition === "changed") store.setState({ game: { ...game(), notes: "changed" } });
    if (condition === "ended") store.setState({ game: { ...game(), phase: "ended" } });
    if (condition === "closing") store.setState({ terminalClose: { status: "closing" } as never });
    if (condition === "privacy") usePrivacyStore.setState({ enabled: true });
    if (condition === "connection") store.setState({ lobby: { code: "ABC123", sessionId: "new" } as never });
    const before = game(), undo = store.getState().undoStack;
    expect(changeInfoBluff(context, id, 0, "monk")).toBeTruthy();
    expect(game()).toBe(before); expect(store.getState().undoStack).toBe(undo);
  });
  it("refuses a live writer whose lease has lapsed", () => {
    store.setState({ lobby: { code: "ABC123", sessionId: "same" } as never });
    useSessionRuntime.setState({ status: "live", backend: { leaseMayHaveLapsed: () => true } as never });
    const before = game();
    expect(changeInfoBluff(captureInfoContext(), demon(), 0, "monk")).toBeTruthy();
    expect(game()).toBe(before);
  });
  it("uses compact slots without duplicating a selected bluff", () => {
    expect(revisedBluffs(["monk", "virgin"], 2, "monk")).toEqual(["virgin", "monk"]);
  });
});

describe("Recipient-safe local information", () => {
  it.each(["bluffs", "demon"] as const)("requires review of stale pre-reveal bluffs in the %s view without discarding drafts or Undo", view => {
    store.setState({ game: setupGame(undefined, { setupRolesDealt: true, setupRolesRevealed: false }) });
    const id = demon();
    expect(changeInfoBluff(captureInfoContext(), id, 0, "monk")).toBeUndefined();
    expect(store.getState().replaceSetupRole("p0", "monk").ok).toBe(true);
    const before = game(), snapshot = JSON.stringify(before), undo = store.getState().undoStack;
    expect(before.players[id]!.privateInfo?.bluffs).toEqual(["monk"]);
    expect(() => setupPayload(before, setupScript, view, id)).toThrow(/Review the bluff characters.*Monk is in play/);
    expect(game()).toBe(before);
    expect(JSON.stringify(game())).toBe(snapshot);
    expect(store.getState().undoStack).toBe(undo);
    store.getState().undo();
    expect(game().players.p0!.actualRole).toBe("washerwoman");
    expect(JSON.stringify(setupPayload(game(), setupScript, view, id))).toContain("Monk");
  });
  it.each(["bluffs", "demon"] as const)("preserves apparent-Demon and Pope in-play exceptions in pre-reveal %s presentations", view => {
    const base = setupGame(undefined, { setupRolesDealt: true, setupRolesRevealed: false });
    const player = { ...base.players.p6!, privateInfo: { bluffs: ["washerwoman"], fakeMinions: ["p0"] } };
    const apparent = { ...base, players: { ...base.players, p6: { ...player, actualRole: "lunatic", shownRole: "imp", behaviorMode: "fake_demon_behavior" as const } } };
    const pope = { ...base, lorics: ["pope"], players: { ...base.players, p6: player } };
    expect(JSON.stringify(setupPayload(apparent, setupScript, view, "p6"))).toContain("Washerwoman");
    expect(JSON.stringify(setupPayload(pope, setupScript, view, "p6"))).toContain("Washerwoman");
  });
  it.each(["bluffs", "demon"] as const)("preserves already-revealed and midgame historical bluff semantics in the %s view", view => {
    const base = setupGame(undefined, { setupRolesDealt: true, setupRolesRevealed: true });
    base.players.p6 = { ...base.players.p6!, privateInfo: { bluffs: ["washerwoman"] } };
    expect(JSON.stringify(setupPayload(base, setupScript, view, "p6"))).toContain("Washerwoman");
    expect(JSON.stringify(setupPayload({ ...base, phase: "night", day: 2, setupRolesRevealed: undefined }, setupScript, view, "p6"))).toContain("Washerwoman");
    expect(JSON.stringify(setupPayload({ ...base, phase: "setup", day: 1, setupRolesRevealed: undefined }, setupScript, view, "p6"))).toContain("Washerwoman");
  });
  it("does not infer actual teammates for an apparent Demon", () => {
    const id = demon();
    const apparent = { ...game().players[id]!, actualRole: "lunatic", shownRole: "imp", behaviorMode: "fake_demon_behavior" as const, privateInfo: { bluffs: ["monk"], fakeMinions: ["p0"] } };
    const candidate = { ...game(), players: { ...game().players, [id]: apparent } };
    const payload = setupPayload(candidate, setupScript, "demon", id);
    expect(JSON.stringify(payload)).toContain("Player 0");
    expect(JSON.stringify(payload)).not.toContain("Player 5");
    expect(JSON.stringify(payload)).not.toContain("participantId");
  });
  it("suppresses normal team reveals for small games and Poppy Grower", () => {
    const small = setupGame(["chef", "empath", "monk", "poisoner", "imp"]);
    expect(() => setupPayload(small, setupScript, "demon", "p4")).toThrow(/fewer than 7 residents/);
    const candidate = { ...game(), players: { ...game().players, p0: { ...game().players.p0!, actualRole: "poppygrower" } } };
    expect(() => setupPayload(candidate, setupScript, "demon", demon())).toThrow(/Poppy Grower/);
  });
  it("keeps deceased current teammates in ordinary setup presentations", () => {
    const candidate = { ...game(), players: { ...game().players, p5: { ...game().players.p5!, alive: false }, p6: { ...game().players.p6!, alive: false } } };
    expect(JSON.stringify(setupPayload(candidate, setupScript, "demon", "p6"))).toContain("Player 5");
    expect(JSON.stringify(setupPayload(candidate, setupScript, "minion", "p5"))).toContain("Player 6");
  });
  it("does not mistake Minion wake recipients for a complete team with a concealed Marionette", () => {
    const candidate = { ...game(), players: { ...game().players, p5: { ...game().players.p5!, actualRole: "marionette", shownRole: "chef", behaviorMode: "marionette_fake_good_behavior" as const } } };
    expect(() => setupPayload(candidate, setupScript, "demon", demon())).toThrow(/Storyteller check/);
  });
  it("renders selected bluffs only with no unrelated private fields or mutation", () => {
    const id = demon(); store.getState().setBluffs(id, ["monk", "virgin"]);
    const before = game(); const payload = setupPayload(before, setupScript, "bluffs", id);
    expect(payload.kind).toBe("setup");
    expect(JSON.stringify(payload)).not.toContain("privateInfo");
    expect(JSON.stringify(payload)).not.toContain("Player");
    expect(game()).toBe(before);
  });
  it("counts available ordinary votes, including exiled dead votes and excluding empty seats", () => {
    const candidate = { ...game(), players: { ...game().players,
      p0: { ...game().players.p0!, alive: false, ghostVote: true },
      p1: { ...game().players.p1!, alive: false, ghostVote: false },
      p2: { ...game().players.p2!, alive: false, ghostVote: true, exiled: true },
      p3: { ...game().players.p3!, isEmpty: true },
    } };
    expect(infoStatistics(candidate)).toEqual({ alive: 3, votes: 5, toExecute: 2 });
    candidate.players.p2.ghostVote = false;
    expect(infoStatistics(candidate).votes).toBe(4);
    candidate.players.p0 = { ...candidate.players.p0, alive: true, isTraveler: true };
    expect(infoStatistics(candidate).toExecute).toBe(2);
  });
});
