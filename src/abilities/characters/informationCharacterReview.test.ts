import { beforeEach, describe, expect, it } from "vitest";
import { canonicalOrder, canonicalRoles } from "@/data/canonical";
import { bind, impair, openInStore, patchPlayer, pick, plan, planned, proofGame, proofQuery, proofRegistry, proofScript, request } from "@/test/proofFixtures";
import { interactionCoverageEligibility, automationEligibility } from "@/abilities/automationEligibility";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { activeModifiers } from "@/abilities/modifiers";
import { buildCoverageManifest, coverageSummary } from "@/abilities/coverage";
import { REVIEWED_INTERACTION_ROLES } from "./passiveRules";
import { REVIEWED_MANUAL } from "./classification";
import { planPreparedInformation, preparedInformationContext, preparationAvailability } from "@/stores/preparedInformation";
import { computeNightOrder } from "@/rules/night/nightOrder";
import { reminderPalette } from "@/features/grimoire-v6/board/marks";
import { useStorytellerStore as store, captureCharacterActionContext } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { useShellStore } from "@/stores/shellStore";
import type { StorytellerLobbyRecord } from "@/stores/types";

/**
 * Stage 4, review-only batch for ten information characters. These tests pin the
 * OFFICIAL facts as literals (typed from the publisher data and the official
 * wiki text, not read back from the code under test) and then prove the single
 * behaviour change: with one of them in play, automation of other characters is
 * no longer pushed to Manual. None of the ten gains an evaluator.
 *
 * Official sources: https://wiki.bloodontheclocktower.com/<Name> for each, and the
 * pinned publisher snapshot (src/data/canonical/README.md).
 */
type Official = { ability: string; team: "townsfolk" | "outsider"; reminders: string[]; firstNight: boolean; otherNight: boolean };
const OFFICIAL: Record<string, Official> = {
  clockmaker: { team: "townsfolk", ability: "You start knowing how many steps from the Demon to its nearest Minion.", reminders: [], firstNight: true, otherNight: false },
  dreamer: { team: "townsfolk", ability: "Each night, choose a player (not yourself or Travellers): you learn 1 good & 1 evil character, 1 of which is correct.", reminders: [], firstNight: true, otherNight: true },
  mathematician: { team: "townsfolk", ability: "Each night, you learn how many players’ abilities worked abnormally (since dawn) due to another character's ability.", reminders: ["Abnormal", "Abnormal", "Abnormal", "Abnormal", "Abnormal"], firstNight: true, otherNight: true },
  flowergirl: { team: "townsfolk", ability: "Each night*, you learn if a Demon voted today.", reminders: ["Demon Voted", "Demon Not Voted"], firstNight: false, otherNight: true },
  savant: { team: "townsfolk", ability: "Each day, you may visit the Storyteller to learn 2 things in private: 1 is true & 1 is false.", reminders: [], firstNight: false, otherNight: false },
  seamstress: { team: "townsfolk", ability: "Once per game, at night, choose 2 players (not yourself): you learn if they are the same alignment.", reminders: ["No Ability"], firstNight: true, otherNight: true },
  artist: { team: "townsfolk", ability: "Once per game, during the day, privately ask the Storyteller any yes/no question.", reminders: ["No Ability"], firstNight: false, otherNight: false },
  juggler: { team: "townsfolk", ability: "On your 1st day, publicly guess up to 5 players' characters. That night, you learn how many you got correct.", reminders: ["Correct", "Correct", "Correct", "Correct", "Correct"], firstNight: false, otherNight: true },
  mutant: { team: "outsider", ability: "If you are “mad” about being an Outsider, you might be executed.", reminders: [], firstNight: false, otherNight: false },
  chambermaid: { team: "townsfolk", ability: "Each night, choose 2 alive players (not yourself): you learn how many woke tonight due to their ability.", reminders: [], firstNight: true, otherNight: true },
};
const IDS = Object.keys(OFFICIAL);

describe("the ten reviewed information characters match the official data", () => {
  it.each(IDS)("%s: team, ability text, reminder tokens and night wakes", (id) => {
    const role = canonicalRoles([id])[0]!;
    const want = OFFICIAL[id]!;
    expect(role.type).toBe(want.team);
    expect(role.ability).toBe(want.ability);
    expect([...(role.reminders ?? [])]).toEqual(want.reminders);
    expect(role.setup ?? false).toBe(false);
    expect(canonicalOrder(id, true) !== undefined).toBe(want.firstNight);
    expect(canonicalOrder(id, false) !== undefined).toBe(want.otherNight);
  });

  it("the list of reviewed characters is exactly these ten, with matching coverage notes", () => {
    expect(Object.keys(REVIEWED_MANUAL).sort()).toEqual([...IDS].sort());
    for (const id of IDS) expect(REVIEWED_INTERACTION_ROLES.has(id), id).toBe(true);
    const manifest = buildCoverageManifest();
    for (const id of IDS) {
      const entry = manifest.find(e => e.id === id)!;
      expect(entry.status, id).toBe("reviewedManual");
      expect(entry.note, id).toMatch(/^Reviewed:/);
      expect(CANONICAL_ABILITY_SEMANTICS.has(id), `${id} gains no evaluator`).toBe(false);
    }
    expect(coverageSummary(manifest).byStatus.reviewedManual).toBe(10);
  });
});

describe("official reminder tokens and night wakes in the app", () => {
  it.each(IDS)("%s: the Storyteller can place exactly the official reminder labels", (id) => {
    const game = proofGame(["empath", id, "imp"], "night", 2);
    const palette = reminderPalette({ game, script: proofScript, registry: proofRegistry } as Parameters<typeof reminderPalette>[0]);
    const labels = palette.inPlay.filter(entry => entry.role.id === id).map(entry => entry.label);
    expect(labels).toEqual([...new Set(OFFICIAL[id]!.reminders)]);
  });

  it.each(IDS)("%s: wakes on the official nights, and a dead player does not wake", (id) => {
    const wakes = (g: StorytellerLobbyRecord, first: boolean) =>
      computeNightOrder(g.players, g.seatOrder, proofScript, first, g).some(step => step.kind === "player" && step.effectiveRoleId === id);
    const g = proofGame(["empath", id, "imp"], "night", 2);
    expect(wakes(g, true)).toBe(OFFICIAL[id]!.firstNight);
    expect(wakes(g, false)).toBe(OFFICIAL[id]!.otherNight);
    expect(wakes(patchPlayer(g, "p1", { alive: false }), false)).toBe(false);
  });
});

describe("with one of them in play, other automation is no longer pushed to Manual", () => {
  const eligibleEmpath = (g: StorytellerLobbyRecord) => automationEligibility({
    query: proofQuery(g), descriptor: CANONICAL_ABILITY_SEMANTICS.get("empath")!, actor: bind(g, "p0"), roleId: "empath", inputs: {} });

  it.each(IDS)("%s: interaction coverage is clear and an Imp attack stays automated", (id) => {
    const g = proofGame(["empath", "imp", "chef", "monk", id]);
    expect(interactionCoverageEligibility(proofQuery(g))).toEqual({ kind: "automated" });
    expect(eligibleEmpath(g)).toEqual({ kind: "automated" });
    const attack = plan(g, request(g, "p1", "imp", { target: pick(g, "p4") }));
    expect(attack).toMatchObject({ ok: true, changed: true });
    expect(planned(attack).players.p4!.alive).toBe(false);
  });

  it.each(IDS)("%s: it reads as its own alignment and adds nothing to the Empath's count", (id) => {
    // Ring: p0 empath - p1 imp (evil) ... p4 is the player under review, adjacent to the Empath.
    const g = proofGame(["empath", "imp", "monk", "saint", id]);
    const delivered = planned(plan(g, request(g, "p0", "empath"))).informationDeliveries.at(-1)!;
    expect(delivered.values).toEqual([{ requirementId: "evilNeighbors", kind: "number", value: 1 }]);
  });

  it("negative control: an unreviewed character still sends the table to Manual", () => {
    for (const id of ["klutz", "snakecharmer", "exorcist"]) {
      const g = proofGame(["empath", "imp", "chef", "monk", id]);
      expect(interactionCoverageEligibility(proofQuery(g)), id).toMatchObject({ kind: "manual", reason: "A character in play has interactions outside verified coverage." });
    }
  });

  it("an impaired reviewed character is still just a normal target for the Imp", () => {
    const g = impair(proofGame(["empath", "imp", "chef", "monk", "clockmaker"]), "p4");
    expect(interactionCoverageEligibility(proofQuery(g))).toEqual({ kind: "automated" });
    expect(plan(g, request(g, "p1", "imp", { target: pick(g, "p4") }))).toMatchObject({ ok: true, changed: true });
  });

  it("a Monk protects a reviewed character from the Imp as it does any other", () => {
    const g = proofGame(["monk", "imp", "chef", "empath", "dreamer"]);
    const protectedGame = planned(plan(g, request(g, "p0", "monk", { target: pick(g, "p4") })));
    const attack = plan(protectedGame, request(protectedGame, "p1", "imp", { target: pick(protectedGame, "p4") }));
    expect(attack).toMatchObject({ ok: true });
    const after = attack.ok && attack.changed ? attack.plan.game : protectedGame;
    expect(after.players.p4!.alive).toBe(true);
  });
});

describe("clues and registration with the reviewed characters", () => {
  const env = { registry: proofRegistry, script: proofScript };
  const night1 = (roles: string[]) => {
    const g = proofGame(roles, "night", 1);
    for (const player of Object.values(g.players)) player.packetEpoch = `epoch-${player.id}`;
    return g;
  };

  it.each(IDS.filter(id => OFFICIAL[id]!.team === "townsfolk"))("a Washerwoman clue can show %s (verified mode)", (id) => {
    const g = night1(["washerwoman", id, "empath", "imp", "poisoner"]);
    expect(preparationAvailability(g, bind(g, "p0"), "washerwoman", env)).toMatchObject({ ok: true, mode: "verified" });
    const result = planPreparedInformation(g, { character: "washerwoman", source: bind(g, "p0"), expected: preparedInformationContext(g, proofScript),
      clue: { kind: "pair", candidates: [bind(g, "p1"), bind(g, "p2")], shownCharacter: id, qualifyingParticipantId: g.players.p1!.participantId! } }, env);
    expect(result).toMatchObject({ ok: true, changed: true });
  });

  it("a clue that names the wrong character for the qualifying player is still refused", () => {
    const g = night1(["washerwoman", "clockmaker", "empath", "imp", "poisoner"]);
    const result = planPreparedInformation(g, { character: "washerwoman", source: bind(g, "p0"), expected: preparedInformationContext(g, proofScript),
      clue: { kind: "pair", candidates: [bind(g, "p1"), bind(g, "p2")], shownCharacter: "dreamer", qualifyingParticipantId: g.players.p1!.participantId! } }, env);
    expect(result).toMatchObject({ ok: false });
  });

  it("the Mutant counts as an Outsider: a Librarian clue can show it and zero Outsiders is refused", () => {
    const g = night1(["librarian", "mutant", "empath", "imp", "poisoner"]);
    const shown = planPreparedInformation(g, { character: "librarian", source: bind(g, "p0"), expected: preparedInformationContext(g, proofScript),
      clue: { kind: "pair", candidates: [bind(g, "p1"), bind(g, "p2")], shownCharacter: "mutant", qualifyingParticipantId: g.players.p1!.participantId! } }, env);
    expect(shown).toMatchObject({ ok: true, changed: true });
    const zero = planPreparedInformation(g, { character: "librarian", source: bind(g, "p0"), expected: preparedInformationContext(g, proofScript), clue: { kind: "zero-outsiders" } }, env);
    expect(zero).toMatchObject({ ok: false, message: "An Outsider is in play." });
  });

  it("a Clockmaker does not count as an Outsider or a Minion for the other clue characters", () => {
    const g = night1(["librarian", "clockmaker", "empath", "imp", "poisoner"]);
    const zero = planPreparedInformation(g, { character: "librarian", source: bind(g, "p0"), expected: preparedInformationContext(g, proofScript), clue: { kind: "zero-outsiders" } }, env);
    expect(zero).toMatchObject({ ok: true, changed: true });
  });
});

describe("jinxes with the reviewed characters stay Storyteller judgments", () => {
  const modifiers = (roles: string[]) => activeModifiers(proofGame(roles), proofRegistry).map(m => m.id);

  it("Mathematician with Chambermaid, Drunk, Marionette or Lunatic activates its jinx", () => {
    expect(modifiers(["mathematician", "chambermaid", "empath"])).toContain("jinx:mathematician+chambermaid");
    expect(modifiers(["mathematician", "drunk", "empath"])).toContain("jinx:mathematician+drunk");
    expect(modifiers(["mathematician", "marionette", "imp", "empath"])).toContain("jinx:mathematician+marionette");
    expect(modifiers(["mathematician", "lunatic", "empath"])).toContain("jinx:mathematician+lunatic");
  });

  it("an active jinx gates its own two characters' evaluations to a judgment", () => {
    const g = proofGame(["mathematician", "drunk", "empath", "imp", "chef"]);
    expect(proofQuery(g).modifierGate("mathematician", ["information"]).kind).toBe("gated");
  });

  it("Clockmaker with Summoner and Juggler with Cannibal still send the table to Manual (those characters are not reviewed)", () => {
    for (const roles of [["clockmaker", "summoner", "empath", "imp"], ["juggler", "cannibal", "empath", "imp"]]) {
      expect(interactionCoverageEligibility(proofQuery(proofGame(roles)))).toMatchObject({ kind: "manual" });
    }
  });
});

describe("Pit-Hag can create the reviewed characters, and jinxes still stop it", () => {
  const hag = (g: StorytellerLobbyRecord, target: string, roleId: string) =>
    plan(g, request(g, "p0", "pithag", { target: pick(g, target), character: { kind: "character", roleIds: [roleId] } }));

  it.each(IDS)("turning a good player into %s is an automated, ordinary transformation", (id) => {
    const g = proofGame(["pithag", "chef", "imp", "monk", "empath", "saint", "washerwoman"]);
    const next = planned(hag(g, "p1", id));
    expect(next.players.p1).toMatchObject({ actualRole: id, shownRole: id });
  });

  it("negative control: an unreviewed character is still refused as a transformation target", () => {
    const g = proofGame(["pithag", "chef", "imp", "monk", "empath", "saint", "washerwoman"]);
    expect(hag(g, "p1", "klutz")).toMatchObject({ ok: false });
  });

  it("creating a Mathematician beside a Drunk brings an unverified jinx into play, so the whole change is refused", () => {
    const g = proofGame(["pithag", "chef", "imp", "monk", "empath", "drunk", "washerwoman"]);
    expect(hag(g, "p1", "mathematician")).toMatchObject({ ok: false, message: expect.stringMatching(/jinx/) });
  });
});

describe("Mutant: an execution for breaking madness is an ordinary execution", () => {
  beforeEach(() => {
    localStorage.clear(); store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null });
    useShellStore.getState().reset(); usePrivacyStore.getState().reset(); useSessionRuntime.setState({ backend: null, status: "idle" });
  });

  it("the Storyteller records the Mutant's execution and the Undertaker is shown the Mutant", () => {
    openInStore(proofGame(["undertaker", "mutant", "imp", "monk", "baron"], "day", 1));
    expect(store.getState().recordExecution("p1", "died")).toMatchObject({ ok: true });
    expect(store.getState().game!.players.p1!.alive).toBe(false);
    expect(store.getState().setPhase("night")).toMatchObject({ ok: true });
    const g = store.getState().game!;
    const result = store.getState().resolveAbility(request(g, "p0", "undertaker", {}, { invocationPath: "nightOrder", withStep: true, completeStep: true }), undefined, captureCharacterActionContext());
    expect(result).toMatchObject({ ok: true });
    expect(store.getState().game!.informationDeliveries.at(-1)?.values?.find(v => v.kind === "role")).toMatchObject({ roleId: "mutant" });
  });
});
