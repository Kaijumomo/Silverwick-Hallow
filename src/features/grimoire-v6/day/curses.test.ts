import { describe, expect, it } from "vitest";
import { proofGame, proofRegistry, proofScript, patchPlayer, impair } from "@/test/proofFixtures";
import { curseNotice } from "./curses";
import type { V6Ctx } from "../ctx";

const ROLES = ["witch", "chef", "empath", "monk", "imp", "saint", "poisoner"];
const cursed = (g: ReturnType<typeof proofGame>) => patchPlayer(g, "p1", { effects: [{
  id: "curse", type: "witchCurse", sourceCharacter: "witch", lifetime: { kind: "throughFollowingDay" }, state: "active",
  sourceParticipant: { kind: "participant", playerId: "p0", participantId: g.players.p0!.participantId!, nameAtTime: "Player 0" },
  expiry: { kind: "at", moment: { phase: "night", day: 3 } }, appliedAt: { phase: "night", day: 2 } } as never] });
const ctxOf = (game: ReturnType<typeof proofGame>) => ({ game, script: proofScript, registry: proofRegistry }) as unknown as V6Ctx;
const ref = (g: ReturnType<typeof proofGame>, id: string) => ({ playerId: id, participantId: g.players[id]!.participantId! });

describe("Witch curse notice on the nomination card", () => {
  it("tells the Storyteller a cursed nominator dies and offers the death", () => {
    const g = cursed(proofGame(ROLES, "day", 2));
    const notice = curseNotice(ctxOf(g), ref(g, "p1"));
    expect(notice?.note).toContain("cursed by the Witch");
    expect(notice?.actions).toHaveLength(1);
  });

  it("says nothing for an uncursed nominator, a dead one, at night, with three left, or once the Witch is impaired", () => {
    const g = cursed(proofGame(ROLES, "day", 2));
    expect(curseNotice(ctxOf(g), ref(g, "p2"))).toBeNull();
    expect(curseNotice(ctxOf(patchPlayer(g, "p1", { alive: false })), ref(g, "p1"))).toBeNull();
    expect(curseNotice(ctxOf(cursed(proofGame(ROLES, "night", 2))), ref(g, "p1"))).toBeNull();
    const three = [2, 3, 4, 5].reduce((acc, i) => patchPlayer(acc, `p${i}`, { alive: false }), g);
    expect(curseNotice(ctxOf(three), ref(g, "p1"))).toBeNull();
    expect(curseNotice(ctxOf(impair(g, "p0")), ref(g, "p1"))).toBeNull();
  });
});
