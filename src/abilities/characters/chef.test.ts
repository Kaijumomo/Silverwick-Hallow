import { describe, expect, it } from "vitest";
import { homebrewEnv, impair, num, patchPlayer, plan, planned, proofGame, request } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

const base = () => proofGame(["chef", "imp", "poisoner", "baron", "monk", "saint", "slayer"], "night", 1);
const evaluate = (g: StorytellerLobbyRecord, value?: number) => plan(g, request(g, "p0", "chef", value === undefined ? {} : { communicated: num(value) }));
const result = (g: StorytellerLobbyRecord, value?: number) => {
  const evaluation = evaluate(g, value);
  expect(evaluation, JSON.stringify(evaluation)).toMatchObject({ ok: true });
  return planned(evaluation).informationDeliveries.at(-1)!.values![0];
};
const reseatRing = (g: StorytellerLobbyRecord, seatOrder: string[]) => ({ ...g, seatOrder,
  players: Object.fromEntries(seatOrder.map((id, seat) => [id, { ...g.players[id]!, seat }])) });

describe("B5 Chef official adjacent-pair information", () => {
  it("counts overlapping evil pairs, including the final-to-first seat edge", () => {
    expect(result(base())).toMatchObject({ kind: "number", value: 2 });
    const wrap = reseatRing(base(), ["p2", "p3", "p0", "p4", "p5", "p6", "p1"]);
    expect(result(wrap)).toMatchObject({ value: 2 });
    const separated = reseatRing(base(), ["p0", "p1", "p4", "p2", "p5", "p3", "p6"]);
    expect(result(separated)).toMatchObject({ value: 0 });
  });
  it("uses actual seatOrder, ignoring player-map insertion order and dead status", () => {
    const g = patchPlayer(base(), "p2", { alive: false });
    g.players = Object.fromEntries(Object.entries(g.players).reverse());
    expect(result(g)).toMatchObject({ value: 2 });
  });
  it("skips empty seats but never skips dead occupied seats", () => {
    const g = patchPlayer(base(), "p2", { isEmpty: true, participantId: undefined });
    expect(result(g)).toMatchObject({ value: 1 });
  });
  it("counts each ring edge once when every actual alignment is evil", () => {
    let g = base();
    for (const id of g.seatOrder) g = patchPlayer(g, id, { actualAlignment: "evil" });
    expect(result(g)).toMatchObject({ value: 7 });
  });
  it.each(["spy", "recluse"])("never silently chooses relevant %s registration", role => {
    const g = patchPlayer(base(), "p2", { actualRole: role, shownRole: role, actualAlignment: role === "spy" ? "evil" : "good" });
    expect(evaluate(g)).toMatchObject({ ok: false, code: role === "recluse" ? "needsInput" : "unsupported" });
    if (role === "recluse") expect(result(g, 0)).toMatchObject({ value: 0 });
    else expect(evaluate(g, 0)).toMatchObject({ ok: false, code: "unsupported" });
    expect(result(impair(g, "p2"))).toMatchObject({ value: role === "spy" ? 2 : 0 });
  });
  it("irrelevant discretionary registration cannot alter a known-good edge", () => {
    const g = patchPlayer(base(), "p5", { actualRole: "recluse", shownRole: "recluse" });
    expect(result(g)).toMatchObject({ value: 2 });
  });
  it.each(["poisoned", "drunk"])("%s: accepts true or false chosen information without altering truth", type => {
    const g = impair(base(), "p0", type);
    expect(evaluate(g)).toMatchObject({ ok: false, code: "needsInput", requirements: [{ id: "communicated", kind: "number", source: "storyteller" }] });
    for (const value of [0, 2, 7]) {
      const next = planned(evaluate(g, value));
      expect(next.informationDeliveries.at(-1)!.values![0]).toMatchObject({ value });
      expect(next.players).toBe(g.players);
    }
    for (const value of [-1, 1.5, 8, Infinity, NaN]) expect(evaluate(g, value).ok).toBe(false);
  });
  it("Drunk shown Chef only records a simulated communicated number", () => {
    const g = patchPlayer(base(), "p0", { actualRole: "drunk", shownRole: "chef", shownAlignment: null, behaviorMode: "drunk_fake_role_behavior" });
    const next = planned(evaluate(g, 1));
    expect(next.informationDeliveries.at(-1)).toMatchObject({ actualRole: "drunk", performedRole: "chef" });
    expect(next.players).toBe(g.players);
  });
  it.each(["dead", "abilityLost", "laterNight", "custom", "unknownEffect", "vortox"])("does not invent an automatic answer for %s", variant => {
    let g = base();
    if (variant === "dead") g = patchPlayer(g, "p0", { alive: false });
    if (variant === "abilityLost") g = impair(g, "p0", "abilityLost");
    if (variant === "laterNight") g = { ...g, day: 2 };
    if (variant === "unknownEffect") g = impair(g, "p1", "unsupported-modifier");
    if (variant === "vortox") g = patchPlayer(g, "p1", { actualRole: "vortox", shownRole: "vortox" });
    const snapshot = JSON.stringify(g);
    const resolution = variant === "custom" ? plan(g, request(g, "p0", "chef"), homebrewEnv("chef")) : evaluate(g, 1);
    expect(resolution.ok).toBe(false);
    expect(JSON.stringify(g)).toBe(snapshot);
  });
});
