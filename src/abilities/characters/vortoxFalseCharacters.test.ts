// @vitest-environment node
// SV-5j: false characters and players under a Vortox (https://wiki.bloodontheclocktower.com/Vortox): the Dreamer's two tokens and the
// Sage's pair. Production semantics and the real coordinator; each expectation names the TRUE answer first.
import { describe, expect, it } from "vitest";
import { bind, impair, patchPlayer, plan, planned, proofGame, request } from "@/test/proofFixtures";
import { SAGE_PLAYERS } from "./sage";
import { FALSE_INFORMATION_REFUSED } from "../falseInformation";
import type { AbilityInputs } from "@/abilities/semantics";
import type { LifeEvent, StorytellerLobbyRecord } from "@/stores/types";

const character = (roleId: string) => ({ kind: "character" as const, roleIds: [roleId] });
const target = (g: StorytellerLobbyRecord, id: string) => ({ kind: "participant" as const, participants: [bind(g, id)] });
const dream = (g: StorytellerLobbyRecord, inputs: AbilityInputs) => plan(g, request(g, "p0", "dreamer", inputs));
/** Picks the good token, then the evil one, each through the question the coordinator asks; returns the final plan. */
function dreamBoth(g: StorytellerLobbyRecord, chosen: string, good: string, evil: string) {
  const base = { target: target(g, chosen) };
  const first = dream(g, base);
  expect(first, JSON.stringify(first)).toMatchObject({ ok: false, code: "needsInput" });
  const goodId = first.ok ? "" : first.requirements![0]!.id;
  const second = dream(g, { ...base, [goodId]: character(good) });
  if (second.ok || second.code !== "needsInput") return { first, final: second };
  const evilId = second.requirements![0]!.id;
  return { first, final: dream(g, { ...base, [goodId]: character(good), [evilId]: character(evil) }) };
}
const tokens = (result: ReturnType<typeof plan>) => planned(result).informationDeliveries.at(-1)!.values!.filter((v) => v.kind === "role").map((v) => v.kind === "role" ? v.roleId : "");

describe("SV-5j Dreamer", () => {
  // p0 dreamer, p1 vortox, p2 savant, p3 witch, p4 sage, p5 mutant
  const ROLES = ["dreamer", "vortox", "savant", "witch", "sage", "mutant"];
  it("the page: a Dreamer who checks the Savant learns the Philosopher and the No Dashii (both wrong)", () => {
    const g = proofGame(ROLES, "night", 2);
    const { first, final } = dreamBoth(g, "p2", "philosopher", "nodashii");
    expect(first).toMatchObject({ requirements: [{ kind: "character", source: "storyteller", exclude: ["savant"] }] });
    expect(tokens(final)).toEqual(["philosopher", "nodashii"]);
  });
  it("the true character is refused as either token", () => {
    const g = proofGame(ROLES, "night", 2);
    expect(dreamBoth(g, "p2", "savant", "nodashii").final).toMatchObject({ ok: false, code: "illegal", message: FALSE_INFORMATION_REFUSED });
    expect(dreamBoth(g, "p3", "philosopher", "witch").final).toMatchObject({ ok: false, code: "illegal" });
    expect(tokens(dreamBoth(g, "p3", "philosopher", "cerenovus").final)).toEqual(["philosopher", "cerenovus"]);
  });
  it("a poisoned Dreamer: still false", () => {
    const g = impair(proofGame(ROLES, "night", 2), "p0");
    expect(dreamBoth(g, "p2", "savant", "nodashii").final).toMatchObject({ ok: false, code: "illegal" });
  });
  it("a healthy Recluse chosen may register as another character: no token is certainly true, so any pair is allowed", () => {
    const g = patchPlayer(proofGame(ROLES, "night", 2), "p5", { actualRole: "recluse" });
    const { first, final } = dreamBoth(g, "p5", "recluse", "nodashii");
    expect(first.ok ? undefined : first.requirements![0]!.exclude).toBeUndefined();
    expect(tokens(final)).toEqual(["recluse", "nodashii"]);
  });
  it("a Drunk shown the Dreamer: free choice, the true token allowed", () => {
    const g = patchPlayer(proofGame(ROLES, "night", 2), "p0", { actualRole: "drunk", shownRole: "dreamer", behaviorMode: "drunk_fake_role_behavior" });
    expect(tokens(dreamBoth(g, "p2", "savant", "nodashii").final)).toEqual(["savant", "nodashii"]);
  });
  it("the Vortox dead: true information again (one token is the Savant)", () => {
    const g = patchPlayer(proofGame(ROLES, "night", 2), "p1", { alive: false });
    const asked = dream(g, { target: target(g, "p2") });
    expect(asked).toMatchObject({ ok: false, code: "needsInput" });
    const id = asked.ok ? "" : asked.requirements![0]!.id;
    expect(tokens(dream(g, { target: target(g, "p2"), [id]: character("witch") }))).toEqual(["savant", "witch"]);
  });
});

/** The Sage (p0) died tonight from `killer`'s Demon attack, recorded as the guided kills record it. */
function killedBy(g: StorytellerLobbyRecord, killer: string): StorytellerLobbyRecord {
  const sage = g.players.p0!, demon = g.players[killer]!;
  const event = { id: "le-sage", kind: "death", moment: { phase: "night", day: g.day }, actualRoleAtEvent: "sage",
    subject: { kind: "participant", participantId: sage.participantId!, playerId: "p0", nameAtTime: sage.name },
    provenance: { sourceCharacter: demon.actualRole, sourceParticipant: { kind: "participant", participantId: demon.participantId!, playerId: killer, nameAtTime: demon.name } } } as LifeEvent;
  return { ...patchPlayer(g, "p0", { alive: false }), lifeEventWindow: { coverageFrom: { phase: "night", day: 1 }, events: [event] } };
}
const sage = (g: StorytellerLobbyRecord, ...ids: string[]) =>
  plan(g, request(g, "p0", "sage", { [SAGE_PLAYERS]: { kind: "participant", participants: ids.map((id) => bind(g, id)) } }, { invocationPath: "nightTrigger", withStep: true, completeStep: true }));

describe("SV-5j Sage", () => {
  // p0 sage, p1 vortox, p2 chef, p3 witch, p4 dreamer, p5 mutant
  const ROLES = ["sage", "vortox", "chef", "witch", "dreamer", "mutant"];
  it("the page: the Sage the Vortox kills learns two players, neither of them the Demon", () => {
    const g = killedBy(proofGame(ROLES, "night", 2), "p1");
    expect(sage(g, "p1", "p2")).toMatchObject({ ok: false, code: "illegal", message: "A Vortox is in play: neither player may be the Demon who killed the Sage." });
    expect(planned(sage(g, "p2", "p3")).informationDeliveries.at(-1)).toMatchObject({ informationActionId: "sage-triggered" });
  });
  it("killed by another Demon while a Vortox lives: neither may be that Demon; the Vortox, who did not kill, may be shown", () => {
    const g = killedBy(proofGame(["sage", "vortox", "chef", "fanggu", "dreamer", "mutant"], "night", 2), "p3");
    expect(sage(g, "p3", "p2")).toMatchObject({ ok: false, code: "illegal" });
    expect(sage(g, "p1", "p2")).toMatchObject({ ok: true, changed: true });
  });
  it("a drunk Sage: still false", () => {
    const g = impair(killedBy(proofGame(ROLES, "night", 2), "p1"), "p0", "drunk");
    expect(sage(g, "p1", "p4")).toMatchObject({ ok: false, code: "illegal" });
  });
});
