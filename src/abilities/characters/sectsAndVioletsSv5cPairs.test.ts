// SV-5 part 3 (the Vortox): the pairs of docs/ai/SECTS_AND_VIOLETS_SV5C_PAIRS.md that no focused Vortox test names. The Vortox's kill
// (vortoxKill.test.ts), false information (falseInformation.test.ts, vortoxFalseAnswers.test.ts, vortoxFalseCharacters.test.ts) and the
// no-execution line (vortoxNoExecution.test.ts) have their own files.
import { beforeEach, describe, expect, it } from "vitest";
import { SWEETHEART } from "./sweetheart";
import { BARBER } from "./barber";
import { townsfolkInformationFalse } from "./passiveRules";
import { nightTriggerStatus } from "@/abilities/invocation";
import { bind, pick, plan, planned, proofGame, proofQuery, request } from "@/test/proofFixtures";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import type { StorytellerLobbyRecord } from "@/stores/types";

const kill = (g: StorytellerLobbyRecord, actor: string, target: string) => plan(g, request(g, actor, g.players[actor]!.actualRole, { target: pick(g, target) }));
beforeEach(() => store.setState({ game: null, undoStack: [], localSeq: 0 }));

describe("SV-5c pairs: the Vortox with the other Sects & Violets characters", () => {
  it("Snake Charmer: choosing the Vortox swaps; the new Vortox makes Townsfolk information false, the old one is a poisoned Snake Charmer", () => {
    const g = proofGame(["snakecharmer", "vortox", "chef", "witch", "oracle"], "night", 2);
    const next = planned(plan(g, request(g, "p0", "snakecharmer", { target: pick(g, "p1") })));
    expect(next.players.p0).toMatchObject({ actualRole: "vortox", actualAlignment: "evil" });
    expect(next.players.p1).toMatchObject({ actualRole: "snakecharmer", actualAlignment: "good" });
    expect(proofQuery(next).abilityFunctions(bind(next, "p1"))).toEqual({ known: true, value: false });
    expect(townsfolkInformationFalse(proofQuery(next), "oracle")).toEqual({ known: true, value: true });
    // The poisoned old Vortox, now a Snake Charmer, performs a Townsfolk ability: its own information (none here) would be false too.
    expect(townsfolkInformationFalse(proofQuery(next), "snakecharmer")).toEqual({ known: true, value: true });
  });

  it("Sweetheart and Barber: killed by the Vortox, each one's death trigger opens as for any Demon kill", () => {
    const g = proofGame(["vortox", "sweetheart", "barber", "chef", "witch", "oracle"], "night", 2);
    const sweetheart = planned(kill(g, "p0", "p1"));
    expect(nightTriggerStatus(SWEETHEART, bind(sweetheart, "p1"), proofQuery(sweetheart))).toMatchObject({ kind: "triggered" });
    const barber = planned(kill(g, "p0", "p2"));
    expect(nightTriggerStatus(BARBER, bind(barber, "p2"), proofQuery(barber))).toMatchObject({ kind: "triggered" });
  });

  it("Outsiders, Minions and Demons get true information: the rule is for Townsfolk abilities only", () => {
    const q = proofQuery(proofGame(["vortox", "mutant", "sweetheart", "barber", "klutz", "eviltwin", "witch", "cerenovus", "pithag"], "night", 2));
    for (const role of ["mutant", "sweetheart", "barber", "klutz", "eviltwin", "witch", "cerenovus", "pithag", "fanggu", "vigormortis", "nodashii"])
      expect(townsfolkInformationFalse(q, role), role).toEqual({ known: true, value: false });
  });

  it("Savant and Artist information stays the Storyteller's (by hand) under a Vortox; SV-5f's Juggler and SV-5g's Mathematician declare their truth", () => {
    const q = proofQuery(proofGame(["vortox", "savant", "artist", "juggler", "mathematician", "philosopher"], "night", 2));
    for (const role of ["savant", "artist"]) expect(q.modifierGate(role, ["information"]).kind, role).toBe("gated");
    // SV-5f / SV-5g: each now has a descriptor with `truth`, so the shared false-information rule runs it (juggler.test.ts, mathematician.test.ts).
    for (const role of ["juggler", "mathematician"]) expect(q.modifierGate(role, ["information"]).kind, role).toBe("clear");
  });

  it.each(["fanggu", "vigormortis", "nodashii"])("%s alongside a Vortox (a Pit-Hag's second Demon): two living Demons keep each kill by hand", (demon) => {
    const g = proofGame(["vortox", demon, "chef", "witch", "oracle", "mutant"], "night", 2);
    expect(kill(g, "p0", "p2")).toMatchObject({ ok: false, code: "unsupported" });
    expect(kill(g, "p1", "p2")).toMatchObject({ ok: false, code: "unsupported" });
    expect(townsfolkInformationFalse(proofQuery(g), "oracle")).toEqual({ known: true, value: true });
  });

  it("No Dashii neighbour logic does not reach the Vortox (a Demon, not a Townsfolk): a Vortox beside a No Dashii keeps working", () => {
    const g = proofGame(["nodashii", "vortox", "chef", "witch", "oracle"], "night", 2);
    expect(proofQuery(g).abilityFunctions(bind(g, "p1"))).toEqual({ known: true, value: true });
  });
});
