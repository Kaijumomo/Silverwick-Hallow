import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { withRedHerring } from "@/test/redHerringFixture";
import { bind, proofGame, proofQuery } from "@/test/proofFixtures";
import { automationEligibility } from "@/abilities/automationEligibility";
import { FORTUNE_TELLER } from "@/abilities/characters/fortuneteller";
import { redHerringSetup } from "./redHerringSetup";
import { selectSetupContext } from "./setupContext";

// Package 4: the Setup panel's "Choose Red Herring" picker, the Players workspace and the PopoverReminders token are
// retired; the v6 setup wizard picks the Red Herring through setSetupRedHerring (see grimoire-v6/day/test/dayFixture).
// The command, the readiness derivation and the Night fail-closed eligibility are unchanged and asserted here.
const game = () => store.getState().game!;
beforeEach(() => {
  usePrivacyStore.getState().reset();
  const initial = setupGame(["fortuneteller", "chef", "monk", "poisoner", "imp"], { setupRolesDealt: true });
  initial.players.p0!.packetEpoch = "original-identity";
  store.setState({ game: initial, lobby: null, undoStack: [], terminalClose: null, customScripts: { [setupScript.id]: setupScript } });
});
afterEach(cleanup);

it("requires an explicit good target, permits self and commits the existing fact with one Undo", () => {
  const before = game();
  expect(store.getState().setSetupRedHerring({ playerId: "p4", participantId: before.players.p4!.participantId! })).toMatchObject({ ok: false });
  expect(game()).toBe(before);
  expect(store.getState().setSetupRedHerring({ playerId: "p0", participantId: before.players.p0!.participantId! })).toMatchObject({ ok: true });
  expect(game().players.p0!.effects).toEqual([expect.objectContaining({ type: "fortuneTellerRedHerring", lifetime: { kind: "manual" } })]);
  expect(game().players.p0!.reminders).toEqual([]);
  expect(store.getState().undoStack).toHaveLength(1);
  store.getState().undo();
  expect(game()).toEqual(before);
});

it("rejects a choice bound to a participant that is no longer seated", () => {
  store.getState().setSetupRedHerring({ playerId: "p1", participantId: "someone-else" });
  expect(game().players.p1!.effects).toEqual([]);
});

it("ordinary readiness distinguishes missing, fixed valid, invalid and manual facts without choosing another target", () => {
  const status = (g = game()) => redHerringSetup(selectSetupContext(g, setupScript)).status;
  expect(status()).toBe("missing");
  const ready = withRedHerring(game(), "p1"); expect(status(ready)).toBe("ready");
  const changed = structuredClone(ready); changed.players.p1!.actualAlignment = "evil";
  expect(status(changed)).toBe("invalid");
  changed.players.p1!.actualAlignment = "good"; changed.players.p0!.packetEpoch = "changed";
  expect(status(changed)).toBe("invalid");
  delete changed.players.p1!.effects[0]!.parameters;
  expect(status(changed)).toBe("manual");
  expect(changed.players.p1!.effects[0]!.id).toBe(ready.players.p1!.effects[0]!.id);
});

it("fails closed before asking Night targets for missing, unbound, multiple or changed Fortune Teller identities", () => {
  const initial = withRedHerring(proofGame(["fortuneteller", "chef", "imp"]), "p1");
  const eligibility = (g: typeof initial, actor = "p0") => automationEligibility({ query: proofQuery(g), descriptor: FORTUNE_TELLER,
    roleId: "fortuneteller", actor: bind(g, actor) });
  expect(eligibility(initial).kind).toBe("automated");
  for (const scenario of ["missing", "unbound", "multiple", "epoch", "replacement"]) {
    const changed = structuredClone(initial);
    if (scenario === "missing") changed.players.p1!.effects = [];
    if (scenario === "unbound") delete changed.players.p1!.effects[0]!.parameters;
    if (scenario === "multiple") changed.players.p2!.actualRole = "fortuneteller";
    if (scenario === "epoch") changed.players.p0!.packetEpoch = "changed-away-and-back";
    if (scenario === "replacement") { changed.players.p0!.actualRole = "monk"; changed.players.p2!.actualRole = "fortuneteller"; }
    expect(eligibility(changed, scenario === "replacement" ? "p2" : "p0").kind, scenario).toBe("manual");
  }
});
