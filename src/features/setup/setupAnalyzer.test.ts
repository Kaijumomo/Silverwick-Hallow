import { describe, it, expect } from "vitest";
import { analyzeSetup } from "./setupAnalyzer";
import { selectSetupContext } from "./setupContext";
import { setupGame, setupScript, standardRoles } from "@/test/setupFixtures";
import { SETUP_COUNTS } from "@/data/setupCounts";
import { makeSTPlayer } from "@/test/fixtures";
import { canonicalRoles } from "@/data/canonical";
import type { StorytellerLobbyRecord, Script } from "@/stores/types";

const analyze = (g: StorytellerLobbyRecord, s: Script = setupScript) => analyzeSetup(selectSetupContext(g,s));
const codes = (g: StorytellerLobbyRecord, s?: Script) => analyze(g,s).findings.map(f => f.code);
const candidate = (t: number,o: number,m=1,d=1) => ({townsfolk:t,outsider:o,minion:m,demon:d});

describe("normalized setup population", () => {
  it.each(Array.from({length:11},(_,i)=>i+5))("%i-player baseline", count => {
    const a=analyze(setupGame(standardRoles(count)));
    expect(a.assigned.actual).toEqual(SETUP_COUNTS[count]);
    expect(a.assigned.candidates).toEqual([SETUP_COUNTS[count]]);
    expect(a.readiness.manual.ok).toBe(true);
  });
  it("keeps target, occupied, empty and Traveler facts separate", () => {
    const g=setupGame(standardRoles(5), {plannedPlayerCount:7});
    g.players.e=makeSTPlayer({id:"e",seat:5,isEmpty:true,name:"",actualRole:""});
    g.players.t=makeSTPlayer({id:"t",seat:6,isTraveler:true,actualRole:"thief"});
    g.seatOrder.push("e","t");
    const a=analyze(g);
    expect(a.population).toEqual({targetNonTravelerCount:7,occupiedNonTravelerCount:5,occupiedTravelerCount:1,emptyPlannedSeatCount:1,totalPhysicalSeatCount:7});
    expect(a.assigned.actual).toEqual(SETUP_COUNTS[5]);
    expect(a.readiness.manual.ok).toBe(false);
    expect(a.findings.find(f=>f.code==="planning-empty")?.severity).toBe("info");
  });
  it("uses actual roles even when shown roles and alignment disagree", () => {
    const g=setupGame(standardRoles(5));g.players.p0!.shownRole="imp";g.players.p0!.shownAlignment="evil";
    expect(analyze(g).assigned.actual).toEqual(SETUP_COUNTS[5]);
  });
  it("does not substitute a pool for assigned truth", () => {
    const g=setupGame(["","","","",""],{rolePool:standardRoles(5)});
    const a=analyze(g);expect(a.pool.roleCount).toBe(5);expect(a.assigned.roleCount).toBe(0);
    expect(a.readiness.deal.ok).toBe(true);expect(a.readiness.manual.ok).toBe(false);
  });
  it("explains both sources when both exist", () => {
    expect(codes(setupGame(standardRoles(5),{rolePool:standardRoles(5)}))).toContain("pool-and-assigned");
  });
  it("legacy zero target is unknown", () => {
    const a=analyze(setupGame(standardRoles(5),{plannedPlayerCount:0}));
    expect(a.population.targetNonTravelerCount).toBeNull();expect(a.readiness.manual.ok).toBe(false);
  });
  it("small unusual games warn but remain operable", () => {
    const a=analyze(setupGame(["imp"]));expect(a.readiness.manual.ok).toBe(true);
    expect(a.findings.find(f=>f.code==="unsupported-population")?.severity).toBe("warning");
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
    expect(a.readiness.manual.ok).toBe(true);
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
    expect(a.readiness.manual.ok).toBe(true);
  });
});

describe("provenance, definitions and duplicates", () => {
  it("homebrew Baron gets no official shift", () => {
    const s={...setupScript,characters:setupScript.characters.map(r=>r.id==="baron"?{id:"baron",name:"Custom Baron",type:"minion" as const,provenance:{status:"homebrew" as const}}:r)};
    const a=analyze(setupGame(["chef","empath","washerwoman","baron","imp"]),s);
    expect(a.assigned.candidates).toBeNull();expect(a.assigned.actual).toEqual(SETUP_COUNTS[5]);
    expect(a.readiness.manual.ok).toBe(true);expect(a.findings.some(f=>f.code==="custom:assigned")).toBe(true);
  });
  it("an unknown role blocks manual start without crashing", () => {
    const a=analyze(setupGame(["mystery",...standardRoles(5).slice(1)]));
    expect(a.readiness.manual.ok).toBe(false);expect(a.assigned.candidates).toBeNull();
    expect(a.findings.some(f=>f.code==="unresolved:assigned:mystery")).toBe(true);
  });
  it("unknown pooled role blocks dealing", () => {
    expect(analyze(setupGame(standardRoles(5),{rolePool:["mystery",...standardRoles(5).slice(1)]})).readiness.deal.ok).toBe(false);
  });
  it("conflicting active definitions block safely", () => {
    const s={...setupScript,characters:[...setupScript.characters,{id:"chef",name:"Other Chef",type:"demon" as const}]};
    expect(codes(setupGame(standardRoles(7)),s)).toContain("conflicting-definition:assigned:chef");
  });
  it("identical repeated script definitions are harmless", () => {
    const s={...setupScript,characters:[...setupScript.characters,...canonicalRoles(["chef"])]};
    expect(analyze(setupGame(standardRoles(5)),s).readiness.manual.ok).toBe(true);
  });
  it("runtime Traveler override of a homebrew definition is detected", () => {
    const s={...setupScript,characters:setupScript.characters.map(r=>r.id==="thief"?{id:"thief",name:"Homebrew thief",type:"traveler" as const}:r)};
    const g=setupGame(standardRoles(5));g.players.t=makeSTPlayer({id:"t",seat:5,isTraveler:true,actualRole:"thief"});g.seatOrder.push("t");
    expect(analyze(g,s).readiness.manual.ok).toBe(false);
  });
  it("unexplained duplicates warn without blocking", () => {
    const a=analyze(setupGame(["washerwoman","washerwoman","washerwoman","poisoner","imp"]));
    expect(a.findings.find(f=>f.code==="duplicate:assigned:washerwoman")?.severity).toBe("warning");
    expect(a.readiness.manual.ok).toBe(true);
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

describe("structural and manual checks", () => {
  it("missing perception prompts manual review without mutating truth or blocking", () => {
    const g=setupGame(standardRoles(5));
    const before=JSON.stringify(g);
    const a=analyze(g);
    expect(a.findings.find(f=>f.code==="missing-perception:ordinary")).toMatchObject({severity:"check",actions:["manual"]});
    expect(a.readiness.manual.ok).toBe(true);
    expect(JSON.stringify(g)).toBe(before);
    for(const p of Object.values(g.players))p.shownRole=p.actualRole;
    expect(codes(g)).not.toContain("missing-perception:ordinary");
  });
  it("unresolved Traveler perception needs review in either assignment workflow", () => {
    const g=setupGame(standardRoles(5));
    g.players.t=makeSTPlayer({id:"t",seat:5,isTraveler:true,actualRole:"thief",shownRole:null});
    g.seatOrder.push("t");
    expect(analyze(g).findings.find(f=>f.code==="missing-perception:traveler")).toMatchObject({severity:"check",actions:["deal","manual"]});
  });
  it.each(["duplicate","dangling","orphan","wrong-id"])("%s seat state blocks both operations", mode => {
    const g=setupGame(standardRoles(5),{rolePool:standardRoles(5)});
    if(mode==="duplicate")g.seatOrder.push("p0");
    if(mode==="dangling")g.seatOrder.push("absent");
    if(mode==="orphan")g.seatOrder.pop();
    if(mode==="wrong-id")g.players.p0!.id="other";
    const a=analyze(g);expect(a.readiness.manual.ok).toBe(false);expect(a.readiness.deal.ok).toBe(false);
  });
  it("redundant seat numbering mismatch warns rather than corrupting counts", () => {
    const g=setupGame(standardRoles(5));g.players.p0!.seat=99;
    expect(analyze(g).readiness.manual.ok).toBe(true);
    expect(codes(g)).toContain("seat-index:p0");
  });
  it.each([true,false])("Traveler type contradiction %s blocks manual start", flag => {
    const g=setupGame(standardRoles(5));g.players.p0!.isTraveler=flag;g.players.p0!.actualRole=flag?"chef":"thief";
    expect(codes(g)).toContain("traveler-type:p0");expect(analyze(g).readiness.manual.ok).toBe(false);
  });
  it("Fabled cannot be dealt to an ordinary seat", () => {
    expect(analyze(setupGame(standardRoles(5),{rolePool:["sentinel",...standardRoles(5).slice(1)]})).readiness.deal.ok).toBe(false);
  });
  it("unknown or wrong-category modifiers require review without blocking", () => {
    const a=analyze(setupGame(standardRoles(5),{fabled:["pope","unknown"],lorics:["sentinel"]}));
    expect(a.assigned.candidates).toBeNull();expect(a.readiness.manual.ok).toBe(true);
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
    expect(a.readiness.manual.ok).toBe(true);
    expect(a.findings.find(f=>f.code==="modifier:"+id)?.severity).toBe("check");
  });
  it("findings sort blockers, checks, warnings, info", () => {
    const a=analyze(setupGame(["chef","chef","chef","poisoner","imp"],{plannedPlayerCount:7,lorics:["tor"]}));
    const rank={blocker:0,check:1,warning:2,info:3};
    const order=a.findings.map(f=>rank[f.severity]);expect(order).toEqual([...order].sort());
  });
});
