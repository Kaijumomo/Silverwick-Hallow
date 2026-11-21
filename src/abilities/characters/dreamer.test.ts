// @vitest-environment node
// SV-5c: the Dreamer (https://wiki.bloodontheclocktower.com/Dreamer, saved 2026-11-11). Expected tokens are the page's rules and
// examples, typed here, never read back from the code under test.
import { describe, expect, it } from "vitest";
import { homebrewEnv, impair, patchPlayer, pick, plan, planned, proofGame, request } from "@/test/proofFixtures";
import { CERENOVUS_CHARACTER } from "./cerenovus";
import { DREAMER_EVIL, DREAMER_FALSE_EVIL, DREAMER_FALSE_GOOD, DREAMER_GOOD } from "./dreamer";
import type { AbilityInputs } from "@/abilities/semantics";
import type { StorytellerLobbyRecord } from "@/stores/types";

// Seats: p0 dreamer, p1 mutant, p2 cerenovus, p3 vigormortis, p4 philosopher, p5 artist, p6 eviltwin
const ROLES = ["dreamer", "mutant", "cerenovus", "vigormortis", "philosopher", "artist", "eviltwin"];
const character = (roleId: string) => ({ kind: "character" as const, roleIds: [roleId] });
const ask = (g: StorytellerLobbyRecord, target: string, extra: AbilityInputs = {}) => plan(g, request(g, "p0", "dreamer", { target: pick(g, target), ...extra }));
const asked = (g: StorytellerLobbyRecord, target: string, extra: AbilityInputs = {}) => {
  const result = ask(g, target, extra);
  expect(result, JSON.stringify(result)).toMatchObject({ ok: false, code: "needsInput" });
  return result.ok ? undefined : result.requirements![0]!;
};
const shown = (g: StorytellerLobbyRecord, target: string, extra: AbilityInputs) => {
  const delivery = planned(ask(g, target, extra)).informationDeliveries.at(-1)!;
  return delivery.values!.flatMap((value) => value.kind === "role" ? [[value.requirementId, value.roleId]] : []);
};

describe("SV-5c Dreamer: the page's examples", () => {
  it("a Mutant: the Mutant and a Minion or Demon (the Cerenovus), good first", () => {
    const g = proofGame(ROLES, "night", 2);
    const requirement = asked(g, "p1")!;
    expect(requirement).toMatchObject({ kind: "character", source: "storyteller" });
    expect(requirement.id.startsWith(DREAMER_FALSE_EVIL)).toBe(true);
    expect(shown(g, "p1", { [requirement.id]: character("cerenovus") })).toEqual([["goodCharacter", "mutant"], ["evilCharacter", "cerenovus"]]);
  });

  it("a Philosopher who gained another ability is still the Philosopher (shown with the Vigormortis)", () => {
    const g = proofGame(ROLES, "night", 2);
    const id = asked(g, "p4")!.id;
    expect(shown(g, "p4", { [id]: character("vigormortis") })).toEqual([["goodCharacter", "philosopher"], ["evilCharacter", "vigormortis"]]);
  });

  it("an Evil Twin: the Evil Twin and any good character (the Artist it claimed), still good first", () => {
    const g = proofGame(ROLES, "night", 2);
    const requirement = asked(g, "p6")!;
    expect(requirement.id.startsWith(DREAMER_FALSE_GOOD)).toBe(true);
    expect(shown(g, "p6", { [requirement.id]: character("artist") })).toEqual([["goodCharacter", "artist"], ["evilCharacter", "eviltwin"]]);
  });

  it("the false token may be any character of the other team on the script, in play or not, never the same team", () => {
    const g = proofGame(ROLES, "night", 2);
    const id = asked(g, "p1")!.id;
    expect(shown(g, "p1", { [id]: character("nodashii") })).toEqual([["goodCharacter", "mutant"], ["evilCharacter", "nodashii"]]);
    expect(ask(g, "p1", { [id]: character("clockmaker") })).toMatchObject({ ok: false, code: "illegal" });
    expect(ask(g, "p1", { [id]: character("mutant") })).toMatchObject({ ok: false, code: "illegal" });
  });
});

describe("SV-5c Dreamer: who may be chosen, and what they show", () => {
  it("not the Dreamer, not a Traveller; the dead are allowed", () => {
    let g = proofGame(ROLES, "night", 2);
    expect(ask(g, "p0")).toMatchObject({ ok: false, code: "illegal" });
    g = patchPlayer(g, "p5", { isTraveler: true, actualRole: "harlot", shownRole: "harlot" });
    expect(ask(g, "p5")).toMatchObject({ ok: false, code: "illegal" });
    g = patchPlayer(g, "p1", { alive: false });
    expect(asked(g, "p1")!.id.startsWith(DREAMER_FALSE_EVIL)).toBe(true);
  });

  it("a Drunk shows the Drunk and a Marionette the Marionette (the actual character), not what they believe", () => {
    const g = patchPlayer(patchPlayer(proofGame([...ROLES, "drunk", "marionette"], "night", 2), "p7", { shownRole: "clockmaker" }), "p8", { shownRole: "sage" });
    expect(shown(g, "p7", { [asked(g, "p7")!.id]: character("witch") })).toEqual([["goodCharacter", "drunk"], ["evilCharacter", "witch"]]);
    expect(shown(g, "p8", { [asked(g, "p8")!.id]: character("sage") })).toEqual([["goodCharacter", "sage"], ["evilCharacter", "marionette"]]);
  });

  it("a mad player shows their real character (the Cerenovus's madness changes nothing)", () => {
    const g = proofGame(ROLES, "night", 2);
    const mad = planned(plan(g, request(g, "p2", "cerenovus", { target: pick(g, "p5"), [CERENOVUS_CHARACTER]: character("sage") })));
    expect(mad.players.p5!.effects.some((effect) => effect.type === "mad")).toBe(true);
    expect(shown(mad, "p5", { [asked(mad, "p5")!.id]: character("witch") })).toEqual([["goodCharacter", "artist"], ["evilCharacter", "witch"]]);
  });
});

describe("SV-5c Dreamer: the Storyteller picks both tokens", () => {
  it.each(["spy", "recluse"])("a healthy %s chosen: good first, then evil, any pair the pages allow", (role) => {
    const g = proofGame([...ROLES, role], "night", 2);
    const first = asked(g, "p7")!;
    expect(first.id.startsWith(DREAMER_GOOD)).toBe(true);
    const second = asked(g, "p7", { [first.id]: character("clockmaker") })!;
    expect(second.id.startsWith(DREAMER_EVIL)).toBe(true);
    expect(shown(g, "p7", { [first.id]: character("clockmaker"), [second.id]: character("fanggu") })).toEqual([["goodCharacter", "clockmaker"], ["evilCharacter", "fanggu"]]);
    expect(ask(g, "p7", { [first.id]: character("witch") })).toMatchObject({ ok: false, code: "illegal" });
  });

  it("a poisoned Spy registers as itself: only the false good token is asked", () => {
    const g = impair(proofGame([...ROLES, "spy"], "night", 2), "p7");
    expect(asked(g, "p7")!.id.startsWith(DREAMER_FALSE_GOOD)).toBe(true);
  });

  it.each(["poisoned", "drunk"])("a %s Dreamer: the Storyteller picks a good and an evil token", (type) => {
    const g = impair(proofGame(ROLES, "night", 2), "p0", type);
    const first = asked(g, "p1")!;
    expect(first.id.startsWith(DREAMER_GOOD)).toBe(true);
    const second = asked(g, "p1", { [first.id]: character("sage") })!;
    expect(shown(g, "p1", { [first.id]: character("sage"), [second.id]: character("witch") })).toEqual([["goodCharacter", "sage"], ["evilCharacter", "witch"]]);
  });

  it("a Drunk shown the Dreamer: a simulated delivery of the two picked tokens", () => {
    const g = patchPlayer(proofGame(ROLES, "night", 2), "p0", { actualRole: "drunk", shownRole: "dreamer", shownAlignment: null, behaviorMode: "drunk_fake_role_behavior" });
    const first = asked(g, "p1")!;
    const second = asked(g, "p1", { [first.id]: character("sage") })!;
    const next = planned(ask(g, "p1", { [first.id]: character("sage"), [second.id]: character("witch") }));
    expect(next.informationDeliveries.at(-1)).toMatchObject({ actualRole: "drunk", performedRole: "dreamer", informationActionId: "dreamer-other-night" });
  });
});

describe("SV-5c Dreamer: by hand", () => {
  it("a dead Dreamer, a Vortox in play and a homebrew Dreamer are refused or by hand; the first night uses its own action", () => {
    const g = proofGame(ROLES, "night", 2);
    expect(ask(patchPlayer(g, "p0", { alive: false }), "p1")).toMatchObject({ ok: false, code: "notApplicable" });
    expect(ask(patchPlayer(g, "p3", { actualRole: "vortox" }), "p1")).toMatchObject({ ok: false });
    expect(plan(g, request(g, "p0", "dreamer", { target: pick(g, "p1") }), homebrewEnv("dreamer"))).toMatchObject({ ok: false, code: "unsupported" });
    const first = proofGame(ROLES, "night", 1);
    const id = asked(first, "p1")!.id;
    expect(planned(ask(first, "p1", { [id]: character("witch") })).informationDeliveries.at(-1)).toMatchObject({ informationActionId: "dreamer-first-night" });
  });
});
