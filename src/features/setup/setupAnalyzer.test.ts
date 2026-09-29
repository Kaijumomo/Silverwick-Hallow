import { describe, it, expect } from "vitest";
import { analyzeSetup } from "./setupAnalyzer";
import { selectSetupContext } from "./setupContext";
import { setupGame, setupScript, standardRoles } from "@/test/setupFixtures";
import { SETUP_COUNTS } from "@/data/setupCounts";
import { makeSTPlayer } from "@/test/fixtures";
import { canonicalRoles } from "@/data/canonical";
import { buildRegistry } from "@/data/roleRegistry";
import { assignedBagIsCoherent } from "./setupRefinement";
import type { RoleDef, StorytellerLobbyRecord, Script } from "@/stores/types";

// Composition/provenance/structural analysis is this file's concern, not deal
// policy (covered in setupCommands.test.ts), so games analyzed here are
// assumed to already have a completed deal unless a test says otherwise.
const analyze = (g: StorytellerLobbyRecord, s: Script = setupScript) =>
  analyzeSetup(selectSetupContext({ ...g,
    setupRolesDealt: g.setupRolesDealt ?? true,
    setupRolesRevealed: g.setupRolesRevealed ?? true }, s));
const codes = (g: StorytellerLobbyRecord, s?: Script) => analyze(g,s).findings.map(f => f.code);
const candidate = (t: number,o: number,m=1,d=1) => ({townsfolk:t,outsider:o,minion:m,demon:d});

describe("normalized setup population", () => {
  it("a fresh Day-0 game with fully assigned roles still blocks begin readiness without a recorded deal", () => {
    const g = setupGame(standardRoles(5)); // day:0, setupRolesDealt absent, rolePool: []
    const a = analyzeSetup(selectSetupContext(g, setupScript)); // bypasses the file's dealt-by-default helper
    expect(a.findings.find(f => f.code === "not-dealt")).toMatchObject({ severity: "blocker", actions: ["begin"] });
    expect(a.readiness.begin.ok).toBe(false);
  });
  it.each(Array.from({length:11},(_,i)=>i+5))("%i-player baseline", count => {
    const a=analyze(setupGame(standardRoles(count)));
    expect(a.assigned.actual).toEqual(SETUP_COUNTS[count]);
    expect(a.assigned.candidates).toEqual([SETUP_COUNTS[count]]);
    expect(a.readiness.begin.ok).toBe(true);
  });
  it("keeps target, occupied, empty and Traveler facts separate", () => {
    const g=setupGame(standardRoles(5), {plannedPlayerCount:7});
    g.players.e=makeSTPlayer({id:"e",seat:5,isEmpty:true,name:"",actualRole:""});
    g.players.t=makeSTPlayer({id:"t",seat:6,isTraveler:true,actualRole:"thief"});
    g.seatOrder.push("e","t");
    const a=analyze(g);
    expect(a.population).toEqual({targetNonTravelerCount:7,occupiedNonTravelerCount:5,occupiedTravelerCount:1,emptyPlannedSeatCount:1,totalPhysicalSeatCount:7,outstandingTravelerReservationCount:0});
    expect(a.assigned.actual).toEqual(SETUP_COUNTS[5]);
    expect(a.readiness.begin.ok).toBe(false);
    expect(a.findings.find(f=>f.code==="planning-empty")?.severity).toBe("info");
  });
  it("uses actual roles even when shown roles and alignment disagree", () => {
    const g=setupGame(standardRoles(5));g.players.p0!.shownRole="imp";g.players.p0!.shownAlignment="evil";
    expect(analyze(g).assigned.actual).toEqual(SETUP_COUNTS[5]);
  });
  it("does not substitute a pool for assigned truth", () => {
    const g=setupGame(["","","","",""],{rolePool:standardRoles(5)});
    const a=analyze(g);expect(a.pool.roleCount).toBe(5);expect(a.assigned.roleCount).toBe(0);
    expect(a.readiness.deal.ok).toBe(true);expect(a.readiness.begin.ok).toBe(false);
  });
  it("explains both sources when both exist", () => {
    expect(codes(setupGame(standardRoles(5),{rolePool:standardRoles(5)}))).toContain("pool-and-assigned");
  });
  it("legacy zero target is unknown", () => {
    const a=analyze(setupGame(standardRoles(5),{plannedPlayerCount:0}));
    expect(a.population.targetNonTravelerCount).toBeNull();expect(a.readiness.begin.ok).toBe(false);
  });
  // FINAL POPULATION CLOSURE, Section 10: unsupported ordinary population
  // (outside 5-15) must actually block Begin, not merely warn -- superseding
  // this test's own former "remain operable" name/expectation.
  it("small unusual games are blocked, not merely warned about", () => {
    const a=analyze(setupGame(["imp"]));
    expect(a.findings.find(f=>f.code==="unsupported-population")).toMatchObject({ severity: "blocker", actions: ["begin"] });
    expect(a.readiness.begin.ok).toBe(false);
  });
});

describe("reviewed whole composition policies", () => {
  it.each([
    ["baron", ["chef","empath","washerwoman","drunk","saint","baron","imp"], [candidate(3,2)]],
    ["fanggu", ["chef","empath","washerwoman","librarian","drunk","poisoner","fanggu"], [candidate(4,1)]],
    ["vigormortis", ["chef","empath","washerwoman","librarian","undertaker","poisoner","vigormortis"], [candidate(5,0)]],
    ["godfather", ["chef","empath","washerwoman","librarian","drunk","godfather","imp"], [candidate(5,0),candidate(4,1)]],
    ["balloonist", ["balloonist","chef","empath","washerwoman","librarian","poisoner","imp"], [candidate(5,0),candidate(4,1)]],
  ])("%s yields coupled candidates", (_id,roles,expected) => {
    const a=analyze(setupGame(roles as string[]));
    expect(a.assigned.candidates).toEqual(expected);
    expect(a.findings.some(f=>f.code==="composition:assigned")).toBe(false);
  });
  it("Godfather at 8 rejects the unchanged composition", () => {
    const a=analyze(setupGame(["chef","empath","washerwoman","librarian","undertaker","drunk","godfather","imp"]));
    expect(a.assigned.candidates).toEqual([candidate(6,0),candidate(4,2)]);
    expect(a.findings.find(f=>f.code==="composition:assigned")?.severity).toBe("warning");
    expect(a.readiness.begin.ok).toBe(true);
  });
  it("Vigormortis exchanges an existing Outsider", () => {
    const a=analyze(setupGame(["chef","empath","washerwoman","librarian","undertaker","monk","drunk","poisoner","vigormortis"]));
    expect(a.assigned.candidates).toEqual([candidate(6,1)]);
  });
  it("Sentinel supplies three complete alternatives at 8", () => {
    expect(analyze(setupGame(standardRoles(8),{fabled:["sentinel"]})).assigned.candidates)
      .toEqual([candidate(6,0),candidate(5,1),candidate(4,2)]);
  });
  it("Sentinel at zero Outsiders deduplicates its floor", () => {
    expect(analyze(setupGame(standardRoles(7),{fabled:["sentinel"]})).assigned.candidates)
      .toEqual([candidate(5,0),candidate(4,1)]);
  });
  it.each([
    ["baron","fanggu"], ["godfather","vigormortis"], ["balloonist","baron"],
  ])("unreviewed %s + %s combination has no exact expectations", (a,b) => {
    const result=analyze(setupGame(["chef","empath","washerwoman","drunk","saint",a,b]));
    expect(result.assigned.candidates).toBeNull();
    expect(result.findings.filter(f=>f.code==="interaction:assigned")).toHaveLength(1);
  });
  it("Sentinel plus a character count modifier also requires review", () => {
    expect(analyze(setupGame(["chef","empath","washerwoman","drunk","saint","baron","imp"],{fabled:["sentinel"]})).assigned.candidates).toBeNull();
  });
  it.each(["atheist","legion","lilmonsta","hermit","xaan","alchemist","boffin","amnesiac"])("%s never receives precise ordinary expectations", id => {
    const a=analyze(setupGame([id,...standardRoles(5).slice(1)]));
    expect(a.assigned.candidates).toBeNull();expect(a.findings.some(f=>f.severity==="check")).toBe(true);
    expect(a.readiness.begin.ok).toBe(true);
  });
});

describe("provenance, definitions and duplicates", () => {
  it("homebrew Baron gets no official shift", () => {
    const s={...setupScript,characters:setupScript.characters.map(r=>r.id==="baron"?{id:"baron",name:"Custom Baron",type:"minion" as const,provenance:{status:"homebrew" as const}}:r)};
    const a=analyze(setupGame(["chef","empath","washerwoman","baron","imp"]),s);
    expect(a.assigned.candidates).toBeNull();expect(a.assigned.actual).toEqual(SETUP_COUNTS[5]);
    expect(a.readiness.begin.ok).toBe(true);expect(a.findings.some(f=>f.code==="custom:assigned")).toBe(true);
  });
  it("an unknown role blocks manual start without crashing", () => {
    const a=analyze(setupGame(["mystery",...standardRoles(5).slice(1)]));
    expect(a.readiness.begin.ok).toBe(false);expect(a.assigned.candidates).toBeNull();
    expect(a.findings.some(f=>f.code==="unresolved:assigned:mystery")).toBe(true);
  });
  it("unknown pooled role blocks dealing", () => {
    expect(analyze(setupGame(standardRoles(5),{rolePool:["mystery",...standardRoles(5).slice(1)]})).readiness.deal.ok).toBe(false);
  });
  // SOL-10D-C03-R1 (supersedes "conflicting active definitions block safely"):
  // the script's FIRST definition owns a RoleId; a conflicting LATER legacy
  // duplicate is inert -- surfaced as a nonblocking check, never a blocker.
  it("a conflicting later legacy duplicate is a nonblocking check, never a blocker", () => {
    const s={...setupScript,characters:[...setupScript.characters,{id:"chef",name:"Other Chef",type:"demon" as const}]};
    const a=analyze(setupGame(standardRoles(7)),s);
    expect(a.findings.some(f=>f.code.startsWith("conflicting-definition:"))).toBe(false);
    expect(a.findings.find(f=>f.code==="duplicate-definition:assigned:chef")?.severity).toBe("check");
    expect(a.readiness.begin.ok).toBe(true);
  });
  it("identical repeated script definitions are harmless", () => {
    const s={...setupScript,characters:[...setupScript.characters,...canonicalRoles(["chef"])]};
    expect(analyze(setupGame(standardRoles(5)),s).readiness.begin.ok).toBe(true);
  });
  it("runtime Traveler override of a homebrew definition is detected", () => {
    const s={...setupScript,characters:setupScript.characters.map(r=>r.id==="thief"?{id:"thief",name:"Homebrew thief",type:"traveler" as const}:r)};
    const g=setupGame(standardRoles(5));g.players.t=makeSTPlayer({id:"t",seat:5,isTraveler:true,actualRole:"thief"});g.seatOrder.push("t");
    expect(analyze(g,s).readiness.begin.ok).toBe(false);
  });
  it("unexplained duplicates warn without blocking", () => {
    const a=analyze(setupGame(["washerwoman","washerwoman","washerwoman","poisoner","imp"]));
    expect(a.findings.find(f=>f.code==="duplicate:assigned:washerwoman")?.severity).toBe("warning");
    expect(a.readiness.begin.ok).toBe(true);
  });
  it.each([2,3])("allows %i canonical Village Idiots with a drunk-choice check", n => {
    const a=analyze(setupGame([...Array(n).fill("villageidiot"),"poisoner","imp"]));
    expect(a.findings.some(f=>f.code==="duplicate:assigned:villageidiot")).toBe(false);
    expect(a.findings.some(f=>f.code==="villageidiot:assigned")).toBe(true);
  });
  it("four Village Idiots warn", () => {
    expect(codes(setupGame(["villageidiot","villageidiot","villageidiot","villageidiot","imp"]))).toContain("duplicate:assigned:villageidiot");
  });
  it("Pope recognizes good-type copies but requires actual-alignment review", () => {
    const a=analyze(setupGame(["chef","chef","washerwoman","poisoner","imp"],{lorics:["pope"]}));
    expect(a.findings.some(f=>f.code==="duplicate:assigned:chef")).toBe(false);
    expect(a.findings.find(f=>f.code==="modifier:pope")?.severity).toBe("check");
  });
  it("Pope does not silently allow duplicate Minions", () => {
    expect(codes(setupGame(["chef","empath","poisoner","poisoner","imp"],{lorics:["pope"]}))).toContain("duplicate:assigned:poisoner");
  });
});

// ---------------------------------------------------------------------------
// SOL-10D-C03-R1: Setup analysis uses the same first-definition ownership as
// every runtime Role consumer. In a legacy stored script that still carries a
// duplicate RoleId (new imports reject one), the FIRST definition is
// authoritative and later definitions are inert: a later conflicting duplicate
// never, by itself, makes Deal or Begin unready. Genuine blockers still block.
// ---------------------------------------------------------------------------
describe("SOL-10D-C03-R1: legacy duplicate RoleIds follow first-definition ownership in Setup", () => {
  const canonicalChef = setupScript.characters.find(r => r.id === "chef")!;
  const otherChef: RoleDef = { id: "chef", name: "Other Chef", type: "demon", ability: "Homebrew demon." };
  const evilChef: RoleDef = { id: "chef", name: "Evil Chef", type: "minion", ability: "Homebrew minion.", provenance: { status: "homebrew" } };
  /** Canonical Chef FIRST (its usual place); `later` appended after it. */
  const laterDuplicate = (later: RoleDef): Script => ({ ...setupScript, id: "legacy-dup", characters: [...setupScript.characters, later] });
  /** `first` BEFORE the canonical Chef, which becomes the later duplicate. */
  const firstDuplicate = (first: RoleDef): Script => ({ ...setupScript, id: "legacy-rev", characters: [first, ...setupScript.characters] });
  /** The blockers that gate `action` (a Deal-scoped blocker never gates Begin). */
  const blockersFor = (a: ReturnType<typeof analyze>, action: "deal" | "begin") =>
    a.findings.filter(f => f.severity === "blocker" && (!f.actions || f.actions.includes(action)));
  const ASSIGNED_WITH_CHEF = ["washerwoman", "librarian", "chef", "poisoner", "imp"];   // chef as Townsfolk
  const ASSIGNED_CHEF_MINION = ["washerwoman", "librarian", "investigator", "chef", "imp"]; // chef as Minion
  const unDealt = () => ["", "", "", "", ""];

  it("A. assigned: the runtime resolves the first Chef; a nonblocking duplicate-definition check; Begin (and Reveal/Shuffle coherence) ready", () => {
    const s = laterDuplicate(otherChef);
    expect(buildRegistry(s).get("chef")).toBe(canonicalChef);
    const g = setupGame(ASSIGNED_WITH_CHEF);
    const context = selectSetupContext({ ...g, setupRolesDealt: true, setupRolesRevealed: true }, s);
    const a = analyzeSetup(context);
    expect(a.assigned.actual).toEqual(SETUP_COUNTS[5]); // Chef counted as its owner, a Townsfolk
    expect(blockersFor(a, "begin")).toEqual([]);
    expect(a.findings.some(f => f.code.startsWith("conflicting-definition:"))).toBe(false);
    const check = a.findings.find(f => f.code === "duplicate-definition:assigned:chef");
    expect(check).toMatchObject({ severity: "check", source: "assigned" });
    expect(check!.message).toBe("Legacy duplicate definition for Chef. Silverwick is using the first definition.");
    expect(check!.message).not.toMatch(/resolve|repair|before starting/i);
    expect(a.readiness.begin.ok).toBe(true);
    expect(assignedBagIsCoherent(context, a)).toBe(true);
  });

  it("B. pool: the pool resolves the first owner, the later duplicate is inert, Deal is ready", () => {
    const s = laterDuplicate(otherChef);
    const a = analyze(setupGame(unDealt(), { rolePool: ASSIGNED_WITH_CHEF }), s);
    expect(a.pool.actual).toEqual(SETUP_COUNTS[5]);
    expect(a.findings.find(f => f.code === "duplicate-definition:pool:chef")).toMatchObject({ severity: "check", actions: ["deal"] });
    expect(a.findings.some(f => f.code.startsWith("conflicting-definition:"))).toBe(false);
    expect(blockersFor(a, "deal")).toEqual([]);
    expect(a.readiness.deal.ok).toBe(true);
  });

  it("C. reversed ownership (Minion first, canonical Townsfolk later): type and composition follow the first owner; no duplicate-definition blocker", () => {
    const s = firstDuplicate(evilChef);
    expect(buildRegistry(s).get("chef")).toBe(evilChef);
    const minion = { townsfolk: 3, outsider: 0, minion: 1, demon: 1 };
    const assigned = analyze(setupGame(ASSIGNED_CHEF_MINION), s);
    expect(assigned.assigned.actual).toEqual(minion);
    expect(assigned.findings.some(f => f.code.startsWith("conflicting-definition:"))).toBe(false);
    expect(assigned.findings.find(f => f.code === "duplicate-definition:assigned:chef")?.severity).toBe("check");
    expect(blockersFor(assigned, "begin")).toEqual([]);
    expect(assigned.readiness.begin.ok).toBe(true);
    const pool = analyze(setupGame(unDealt(), { rolePool: ASSIGNED_CHEF_MINION }), s);
    expect(pool.pool.actual).toEqual(minion);
    expect(pool.findings.some(f => f.code.startsWith("conflicting-definition:"))).toBe(false);
    expect(pool.readiness.deal.ok).toBe(true);
    // The later (Townsfolk) definition never reinterprets the composition: the
    // SAME roles counted with it would be 4 Townsfolk and no Minion.
    expect(pool.pool.actual).not.toEqual({ townsfolk: 4, outsider: 0, minion: 0, demon: 1 });
  });

  it("D. an identical later duplicate stays harmless: no finding at all, Begin ready", () => {
    const s = laterDuplicate(canonicalRoles(["chef"])[0]!);
    const a = analyze(setupGame(ASSIGNED_WITH_CHEF), s);
    expect(a.findings.some(f => f.code.startsWith("conflicting-definition:") || f.code.startsWith("duplicate-definition:"))).toBe(false);
    expect(a.readiness.begin.ok).toBe(true);
  });

  it("E. genuine blockers still block with a legacy duplicate script: an unknown Role", () => {
    const s = laterDuplicate(otherChef);
    const assigned = analyze(setupGame(["mystery", "librarian", "chef", "poisoner", "imp"]), s);
    expect(assigned.findings.find(f => f.code === "unresolved:assigned:mystery")?.severity).toBe("blocker");
    expect(assigned.readiness.begin.ok).toBe(false);
    const pool = analyze(setupGame(unDealt(), { rolePool: ["mystery", "librarian", "chef", "poisoner", "imp"] }), s);
    expect(pool.readiness.deal.ok).toBe(false);
  });

  it.each([true, false])("E. genuine blockers still block with a legacy duplicate script: Traveler type contradiction (isTraveler %s)", flag => {
    const s = laterDuplicate(otherChef);
    const g = setupGame(ASSIGNED_WITH_CHEF);
    g.players.p0!.isTraveler = flag; g.players.p0!.actualRole = flag ? "chef" : "thief";
    const a = analyze(g, s);
    expect(a.findings.find(f => f.code === "traveler-type:p0")?.severity).toBe("blocker");
    expect(a.readiness.begin.ok).toBe(false);
  });

  it("E. an OWNING definition the runtime overrides (a canonical Traveler shadowing it) still blocks as a conflict", () => {
    // The script's FIRST "thief" is a homebrew Townsfolk; the canonical Traveler
    // catalogue keeps its precedence, so the runtime is not using the script's
    // own owning definition -- a genuine conflict, not an inert later duplicate.
    const s: Script = { ...setupScript, id: "legacy-thief",
      characters: [{ id: "thief", name: "Homebrew Thief", type: "townsfolk", ability: "Homebrew." }, ...setupScript.characters] };
    const g = setupGame(standardRoles(5));
    g.players.t = makeSTPlayer({ id: "t", seat: 5, isTraveler: true, actualRole: "thief", actualAlignment: "good" }); g.seatOrder.push("t");
    const a = analyze(g, s);
    expect(a.findings.find(f => f.code === "conflicting-definition:assigned:thief")?.severity).toBe("blocker");
    expect(a.readiness.begin.ok).toBe(false);
  });
});

describe("structural and manual checks", () => {
  it("missing ordinary perception blocks a manual start but never mutates truth (Phase 9C.4)", () => {
    const g=setupGame(standardRoles(5));
    for(const p of Object.values(g.players))p.shownRole=null;
    const before=JSON.stringify(g);
    const a=analyze(g);
    expect(a.findings.find(f=>f.code==="missing-perception:ordinary")).toMatchObject({severity:"blocker",actions:["begin"]});
    expect(a.readiness.begin.ok).toBe(false);
    expect(JSON.stringify(g)).toBe(before);
    for(const p of Object.values(g.players))p.shownRole=p.actualRole;
    expect(codes(g)).not.toContain("missing-perception:ordinary");
    expect(analyze(g).readiness.begin.ok).toBe(true);
  });
  it("unresolved Traveler perception needs review in either assignment workflow", () => {
    const g=setupGame(standardRoles(5));
    g.players.t=makeSTPlayer({id:"t",seat:5,isTraveler:true,actualRole:"thief",shownRole:null});
    g.seatOrder.push("t");
    expect(analyze(g).findings.find(f=>f.code==="missing-perception:traveler")).toMatchObject({severity:"check",actions:["deal","begin"]});
  });
  it.each(["duplicate","dangling","orphan","wrong-id"])("%s seat state blocks both operations", mode => {
    const g=setupGame(standardRoles(5),{rolePool:standardRoles(5)});
    if(mode==="duplicate")g.seatOrder.push("p0");
    if(mode==="dangling")g.seatOrder.push("absent");
    if(mode==="orphan")g.seatOrder.pop();
    if(mode==="wrong-id")g.players.p0!.id="other";
    const a=analyze(g);expect(a.readiness.begin.ok).toBe(false);expect(a.readiness.deal.ok).toBe(false);
  });
  it("redundant seat numbering mismatch warns rather than corrupting counts", () => {
    const g=setupGame(standardRoles(5));g.players.p0!.seat=99;
    expect(analyze(g).readiness.begin.ok).toBe(true);
    expect(codes(g)).toContain("seat-index:p0");
  });
  it.each([true,false])("Traveler type contradiction %s blocks manual start", flag => {
    const g=setupGame(standardRoles(5));g.players.p0!.isTraveler=flag;g.players.p0!.actualRole=flag?"chef":"thief";
    expect(codes(g)).toContain("traveler-type:p0");expect(analyze(g).readiness.begin.ok).toBe(false);
  });
  describe("Night 1 readiness requires starting Traveler completeness (Phase 9 Setup finalization B4)", () => {
    function withTraveler(overrides: Partial<import("@/stores/types").STPlayerRecord> = {}) {
      const g = setupGame(standardRoles(5));
      g.players.t = makeSTPlayer({ id: "t", seat: 5, isTraveler: true, actualRole: "thief", ...overrides });
      g.seatOrder.push("t");
      return g;
    }
    it("blocks Night 1 when a starting Traveler has no character assigned", () => {
      const g = withTraveler({ actualRole: "" });
      const a = analyze(g);
      expect(a.findings.find(f => f.code === "missing-traveler-role")).toMatchObject({ severity: "blocker" });
      expect(a.readiness.begin.ok).toBe(false);
    });
    it("blocks Night 1 when a starting Traveler has no alignment configured", () => {
      const g = withTraveler(); // actualRole set, actualAlignment absent
      const a = analyze(g);
      expect(a.findings.find(f => f.code === "traveler-alignment:t")).toMatchObject({ severity: "blocker" });
      expect(a.readiness.begin.ok).toBe(false);
    });
    it("allows Night 1 once the starting Traveler has both a character and an alignment", () => {
      const g = withTraveler({ actualAlignment: "good" });
      const a = analyze(g);
      expect(a.findings.some(f => f.code === "missing-traveler-role" || f.code === "traveler-alignment:t")).toBe(false);
      expect(a.readiness.begin.ok).toBe(true);
    });
  });
  it("Fabled cannot be dealt to an ordinary seat", () => {
    expect(analyze(setupGame(standardRoles(5),{rolePool:["sentinel",...standardRoles(5).slice(1)]})).readiness.deal.ok).toBe(false);
  });
  it("unknown or wrong-category modifiers require review without blocking", () => {
    const a=analyze(setupGame(standardRoles(5),{fabled:["pope","unknown"],lorics:["sentinel"]}));
    expect(a.assigned.candidates).toBeNull();expect(a.readiness.begin.ok).toBe(true);
    expect(a.findings.filter(f=>f.code.startsWith("modifier:"))).toHaveLength(3);
  });
  it.each([["huntsman","damsel"],["choirboy","king"]])("%s warns about missing %s", (id) => {
    expect(codes(setupGame([id,...standardRoles(5).slice(1)]))).toContain("requires:assigned:"+id);
  });
  it("Marionette reports a completed non-neighbor placement", () => {
    expect(codes(setupGame(["marionette","chef","imp","empath","washerwoman"]))).toContain("marionette-neighbor:p0");
  });
  it("Marionette accepts ordinary neighboring placement", () => {
    expect(codes(setupGame(["marionette","imp","chef","empath","washerwoman"]))).not.toContain("marionette-neighbor:p0");
  });
  it("active canonical jinxes reduce confidence", () => {
    const a=analyze(setupGame(["heretic","baron","imp","chef","empath"]));
    expect(a.assigned.candidates).toBeNull();expect(codes(setupGame(["heretic","baron","imp","chef","empath"]))).toContain("jinxes:assigned");
  });
  it.each(["gardener","tor","bootlegger"])("%s is nonblocking Storyteller judgment", id => {
    const a=analyze(setupGame(standardRoles(5),{lorics:[id]}));
    expect(a.readiness.begin.ok).toBe(true);
    expect(a.findings.find(f=>f.code==="modifier:"+id)?.severity).toBe("check");
  });
  it("findings sort blockers, checks, warnings, info", () => {
    const a=analyze(setupGame(["chef","chef","chef","poisoner","imp"],{plannedPlayerCount:7,lorics:["tor"]}));
    const rank={blocker:0,check:1,warning:2,info:3};
    const order=a.findings.map(f=>rank[f.severity]);expect(order).toEqual([...order].sort());
  });
});
