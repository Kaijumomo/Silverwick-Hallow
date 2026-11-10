// @vitest-environment node
// A Drunk or Marionette shown a character works exactly like a poisoned holder for that character's ability:
// the use is spent, nothing else changes, and the night trigger fires on their death.
import { describe, expect, it } from "vitest";
import { bind, impair, patchPlayer, pick, plan, planned, proofGame, request, requirementIds } from "@/test/proofFixtures";
import { SHOWN } from "./ravenkeeper";
import { subjectId } from "./shared";
import type { StorytellerLobbyRecord } from "@/stores/types";

type Variant = "poisoned" | "drunk" | "marionette";
const VARIANTS: Variant[] = ["poisoned", "drunk", "marionette"];
const holder = (g: StorytellerLobbyRecord, variant: Variant, shown: string): StorytellerLobbyRecord =>
  variant === "poisoned" ? impair(g, "p0")
    : patchPlayer(g, "p0", variant === "drunk"
      ? { actualRole: "drunk", shownRole: shown, shownAlignment: null, behaviorMode: "drunk_fake_role_behavior" }
      : { actualRole: "marionette", actualAlignment: "evil", shownRole: shown, shownAlignment: null, behaviorMode: "marionette_fake_good_behavior" });

describe.each(VARIANTS)("%s holder of a once-per-game ability", (variant) => {
  it("the Slayer's shot is spent, nobody dies, and a second shot is refused", () => {
    const base = patchPlayer(proofGame(["slayer", "imp", "chef", "monk", "saint", "empath", "poisoner"], "day", 2), "p0", { abilityUsed: false });
    const g = holder(base, variant, "slayer");
    const shot = plan(g, request(g, "p0", "slayer", { target: pick(g, "p1") }, { invocationPath: "dayEntry" } as never));
    const next = planned(shot);
    expect(next.players.p0!.abilityUsed).toBe(true);
    expect(next.players.p1!.alive).toBe(true);
    expect(plan(next, request(next, "p0", "slayer", { target: pick(next, "p1") }, { invocationPath: "dayEntry" } as never)))
      .toMatchObject({ ok: false, code: "notApplicable", message: expect.stringMatching(/already been used/) });
  });

  it("the Professor's use is spent and nobody returns", () => {
    const base = patchPlayer(proofGame(["professor", "chef", "empath", "monk", "imp", "saint", "baron"], "night", 2), "p1", { alive: false });
    const g = holder(base, variant, "professor");
    const next = planned(plan(g, request(g, "p0", "professor", { target: pick(g, "p1") })));
    expect(next.players.p0!.abilityUsed).toBe(true);
    expect(next.players.p1!.alive).toBe(false);
  });

  it("the Ravenkeeper's night death opens the same 'choose the character shown' prompt", () => {
    const roles = ["ravenkeeper", "imp", "chef", "recluse", "monk", "poisoner", "empath"];
    const killed = (g0: StorytellerLobbyRecord) => planned(plan(g0, request(g0, "p1", "imp", { target: pick(g0, "p0") })));
    const g = killed(holder(proofGame(roles, "night", 2), variant, "ravenkeeper"));
    expect(g.players.p0!.alive).toBe(false);
    const trigger = (inputs = {}) => plan(g, request(g, "p0", "ravenkeeper", { target: pick(g, "p2"), ...inputs }, { invocationPath: "nightTrigger", withStep: true, completeStep: true }));
    expect(requirementIds(trigger())).toEqual([subjectId(SHOWN, bind(g, "p2"))]);
    const shown = trigger({ [subjectId(SHOWN, bind(g, "p2"))]: { kind: "character", roleIds: ["imp"] } });
    expect(planned(shown).informationDeliveries.at(-1)!.values![1]).toEqual({ requirementId: "role", kind: "role", roleId: "imp" });
  });
});

describe("a concealed holder cannot change anything else", () => {
  it("a Drunk shown the Imp still cannot kill", () => {
    const g = patchPlayer(proofGame(["imp", "chef", "empath", "monk", "saint", "slayer", "poisoner"], "night", 2), "p0",
      { actualRole: "drunk", shownRole: "imp", shownAlignment: null, behaviorMode: "drunk_fake_role_behavior" });
    const result = plan(g, request(g, "p0", "imp", { target: pick(g, "p1") }));
    expect(result).toMatchObject({ ok: true });
    if (result.ok && result.changed) expect(result.plan.game.players.p1!.alive).toBe(true);
    expect(g.players.p1!.alive).toBe(true);
  });
});
