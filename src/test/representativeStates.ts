import { useStorytellerStore } from "@/stores/storytellerStore";
import type { PlayerId } from "@/stores/types";

/**
 * Phase 10H (contract §21): the representative states RS-15 and RS-20, built
 * entirely through real Storyteller commands (never hand-constructed), so the
 * result is a valid v26 game the app itself could have produced. Used by the
 * Slice 3/7 tests and, serialized, as the browser-evidence fixture (injected
 * into the dev server's localStorage -- never written to Firebase).
 *
 * RS-15: 15 occupied seats with long names, Life variants (dead with a vote,
 * dead with the vote spent, an executed-and-survived), Actual/Shown
 * divergence (the Drunk), an Actual Alignment exception, Effects (manual and
 * sourced), Reminders (several, incl. a multi-instance label), ability used,
 * a Night 2 in progress (an active Night actor), a selected participant.
 *
 * RS-20: RS-15 plus five Travelers (one evil), Fabled and a Loric.
 */
const RS15_NAMES = [
  "Alice", "Bartholomew Featherstonehaugh", "Cass", "Dmitri", "Evangeline Montgomery-Price",
  "Fen", "Guillermo", "Hana", "Ignatius Worthington III", "Jo", "Kwame", "Lucía Fernández de Córdoba",
  "Mo", "Nadia", "Oluwaseun",
];
const RS15_POOL = [
  "washerwoman", "librarian", "investigator", "chef", "empath", "fortuneteller", "undertaker",
  "monk", "ravenkeeper", "drunk", "saint", "poisoner", "spy", "scarletwoman", "imp",
];

export type RepresentativeHandles = {
  ids: PlayerId[];
  drunkId: PlayerId;
  impId: PlayerId;
  travelerIds: PlayerId[];
};

const store = () => useStorytellerStore.getState();
function ok(result: { ok: boolean; message?: string } | boolean, label: string) {
  if (result === false || (typeof result === "object" && !result.ok)) {
    throw new Error(`representative state: ${label} failed${typeof result === "object" && result.message ? ` -- ${result.message}` : ""}`);
  }
}
const holder = (roleId: string): PlayerId => {
  const p = Object.values(store().game!.players).find((x) => x.actualRole === roleId);
  if (!p) throw new Error(`representative state: no ${roleId}`);
  return p.id;
};

/** Setup, Preparation stage: dealt, not revealed, one shown identity still
 * needed (the Drunk) -- the staged-Setup evidence state. */
export function buildSetupPreparation(): { drunkId: PlayerId } {
  store().newGame("tb", { plannedPlayerCount: 15, plannedTravelerCount: 0 });
  for (const name of RS15_NAMES) store().addPlayerToSeat(name);
  store().setRolePool(RS15_POOL);
  ok(store().dealRolePool(), "deal");
  const drunkId = holder("drunk");
  for (const id of store().game!.seatOrder) if (id !== drunkId) store().showAssignedRole(id);
  return { drunkId };
}

export function buildRS15(): RepresentativeHandles {
  store().newGame("tb", { plannedPlayerCount: 15, plannedTravelerCount: 0 });
  for (const name of RS15_NAMES) store().addPlayerToSeat(name);
  const ids = [...store().game!.seatOrder];
  store().setRolePool(RS15_POOL);
  ok(store().dealRolePool(), "deal");
  const drunkId = holder("drunk");
  for (const id of ids) {
    if (id === drunkId) store().setShownRole(id, "virgin"); // Actual ≠ Shown
    else store().showAssignedRole(id);
  }
  ok(store().revealRoles(), "reveal");
  ok(store().beginNightOne(), "begin Night 1");

  const impId = holder("imp");
  const monk = holder("monk");
  const empath = holder("empath");
  const chef = holder("chef");
  const ravenkeeper = holder("ravenkeeper");
  const saint = holder("saint");
  const fortune = holder("fortuneteller");

  // Night 1: a death; Effects (manual + sourced); Reminders; ability used.
  ok(store().recordDeath(ravenkeeper, { provenance: { reason: "killed by the Demon" } }), "death");
  store().setStatus(empath, "poisoned", true);
  store().addEffect(chef, { type: "protected", sourceCharacter: "monk", sourcePlayer: monk, lifetime: { kind: "throughFollowingDay" } });
  store().addEffect(chef, { type: "mad", lifetime: { kind: "manual" } });
  store().addReminder(fortune, { label: "Red Herring", sourceCharacter: "fortuneteller" });
  store().addReminder(empath, { label: "Chosen" });
  store().addReminder(empath, { label: "Chosen" });
  store().addReminder(empath, { label: "Knows" });
  store().addReminder(chef, { label: "Safe tonight" });
  ok(store().setActualAlignment(saint, "evil", { provenance: { reason: "Storyteller selection" } }), "alignment exception");

  // Day 1: an execution the executee survives; Night 2 begins.
  ok(store().advancePhase(), "advance to Day 1");
  ok(store().recordExecution(holder("investigator"), "survived"), "execution");
  ok(store().spendGhostVote(ravenkeeper), "spend vote");
  ok(store().advancePhase(), "advance to Night 2");
  ok(store().setAbilityUsed(holder("undertaker"), true), "ability used");
  ok(store().recordDeath(holder("washerwoman"), { provenance: { reason: "killed by the Demon" } }), "night 2 death");
  store().selectPlayer(chef);
  return { ids, drunkId, impId, travelerIds: [] };
}

export function buildRS20(): RepresentativeHandles {
  const handles = buildRS15();
  const travelers = [["Tess", "thief"], ["Uriah Blackwood-Ashcombe", "gunslinger"], ["Vik", "scapegoat"], ["Wren", "beggar"], ["Xiomara", "bureaucrat"]] as const;
  const travelerIds: PlayerId[] = [];
  for (const [name, role] of travelers) {
    store().addPlayerToSeat(name);
    const id = store().game!.seatOrder.at(-1)!;
    ok(store().assignRole(id, role), `traveler ${name}`);
    store().setTravelerAlignment(id, name === "Vik" ? "evil" : "good", { provenance: { reason: "Storyteller selection", sourceCharacter: role } });
    travelerIds.push(id);
  }
  store().setFabled(["spiritofivory", "toymaker"]);
  store().setLorics(["bigwig"]);
  store().selectPlayer(handles.ids[1]!);
  return { ...handles, travelerIds };
}

/** The persisted-store envelope the dev server reads from localStorage
 * ("new-blood-st"), from the CURRENT store state. */
export function persistedEnvelope(): string {
  const s = store();
  return JSON.stringify({
    state: {
      game: s.game, view: "game", undoStack: [], customScripts: s.customScripts, lobby: null,
      grimoireMode: "ring", tokenPositions: {}, localSeq: s.localSeq, sync: null,
    },
    version: 26,
  });
}
