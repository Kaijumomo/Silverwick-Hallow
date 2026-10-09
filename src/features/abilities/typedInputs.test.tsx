// SOL-10F-L2: the workspace renders every AbilityInputRequirement by its own
// kind, cardinality and constraints -- declared inputs and asked judgments
// alike -- and passes exactly the declared typed payload to the coordinator.
// Rules-neutral fixtures only (no character semantics).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AbilityWorkspace } from "./AbilityWorkspace";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { canonicalRoles } from "@/data/canonical";
import { buildRegistry } from "@/data/roleRegistry";
import { makeSTPlayer } from "@/test/fixtures";
import type { AbilityDescriptor, AbilityEvaluationContext, AbilitySemanticsRegistry } from "@/abilities/semantics";
import type { AbilityResolutionRequest } from "@/stores/abilityResolution";
import type { Script, StorytellerLobbyRecord } from "@/stores/types";
import { choose, hasChoice, offered } from "@/test/pickers";

const script: Script = { id: "typed-test", name: "Typed test", characters: canonicalRoles(["washerwoman", "chef", "empath", "imp", "librarian", "monk"]) };
const registry = buildRegistry(script);
const game = () => store.getState().game!;
let seen: AbilityEvaluationContext[] = [];
const outcomeFor = (ctx: AbilityEvaluationContext) => ({ kind: "outcome" as const, outcome: {
  operations: [{ domain: "reminder" as const, intents: [{ kind: "place" as const, target: ctx.actor.binding, reminder: { label: "fixture" } }] }] } });

/** Every input kind, cardinality and constraint (rules-neutral). */
const TYPED: AbilityDescriptor = {
  roleId: "washerwoman", timing: ["firstNight"], invocation: "wake", usage: { kind: "unlimited" }, hooks: [],
  presentation: { complexity: "complex", action: "Typed fixture" },
  inputs: [
    { id: "pair", kind: "participant", count: 2, source: "player", constraints: ["distinct", "notSelf", "alive"], label: "the pair" },
    { id: "deadOne", kind: "participant", source: "storyteller", constraints: ["dead"], label: "a dead player" },
    { id: "chars", kind: "character", count: 2, source: "storyteller", label: "the characters" },
    { id: "side", kind: "alignment", source: "storyteller", label: "the alignment" },
    { id: "num", kind: "number", source: "storyteller", label: "the number" },
    { id: "flag", kind: "boolean", source: "player", label: "the yes/no" },
    { id: "words", kind: "text", source: "storyteller", label: "the words" },
  ],
  evaluator: (ctx) => { seen.push(ctx); return outcomeFor(ctx); },
};
/** No declared inputs; the evaluator asks for a NON-boolean judgment. */
const JUDGED: AbilityDescriptor = {
  roleId: "librarian", timing: ["firstNight"], invocation: "wake", usage: { kind: "unlimited" }, hooks: [], inputs: [],
  presentation: { complexity: "complex", action: "Judged fixture" },
  evaluator: (ctx) => {
    seen.push(ctx);
    return ctx.judgments.judged ? outcomeFor(ctx) : { kind: "needsInput", message: "The Storyteller decides which pair.",
      requirements: [{ id: "judged", kind: "participant", count: 2, source: "judgment", constraints: ["distinct"], label: "the judged pair" }] };
  },
};
const SEMANTICS: AbilitySemanticsRegistry = new Map([[TYPED.roleId, TYPED], [JUDGED.roleId, JUDGED]]);

beforeEach(() => {
  seen = [];
  usePrivacyStore.setState({ enabled: false });
  const roles = ["washerwoman", "chef", "empath", "imp", "librarian"];
  const players = roles.map((actualRole, seat) => makeSTPlayer({ id: `p${seat}`, name: ["Ann", "Ben", "Cat", "Dan", "Eli"][seat]!, seat,
    actualRole, shownRole: actualRole, actualAlignment: registry.alignmentOf(actualRole), alive: seat !== 2 }));
  const g: StorytellerLobbyRecord = {
    gameSchemaVersion: 27, gameRuleFacts: [], code: "", storytellerUid: "local", scriptId: script.id, phase: "night", day: 1,
    players: Object.fromEntries(players.map((p) => [p.id, p])), seatOrder: players.map((p) => p.id),
    plannedPlayerCount: 5, plannedTravelerCount: 0, rolePool: [], fabled: [], lorics: [], bluffs: [], notes: "", nightProgress: {}, pendingPlayers: {},
    history: [], informationDeliveries: [], lifeEventWindow: { coverageFrom: { phase: "night", day: 1 }, events: [] }, setupRolesDealt: true, setupRolesRevealed: true,
  };
  store.setState({ game: g, undoStack: [], localSeq: 0, customScripts: { [script.id]: script } });
});
afterEach(cleanup);

function open(descriptor: AbilityDescriptor, actorId: string) {
  function Host() {
    const current = store((s) => s.game)!;
    return <AbilityWorkspace game={current} script={script} registry={registry} semantics={SEMANTICS} descriptor={descriptor} manualReason=""
      target={{ actorId, roleId: descriptor.roleId, roleName: descriptor.roleId, invocationPath: "nightOrder" }} onClose={() => {}} onResolved={() => {}} />;
  }
  render(<Host />);
  return screen.getByRole("dialog");
}

describe("SOL-10F-L2: every input kind, cardinality and constraint", () => {
  it("renders each kind faithfully and passes exactly the declared typed payload to the coordinator", () => {
    const resolveSpy = vi.spyOn(store.getState(), "resolveAbility");
    store.setState({ resolveAbility: resolveSpy as never });
    const dialog = open(TYPED, "p0");
    // Player / Storyteller choices are visibly distinct.
    expect(within(dialog).getAllByText("Player choice")).toHaveLength(2);
    expect(within(dialog).getAllByText("Storyteller choice")).toHaveLength(5);

    // participant, count 2, distinct + notSelf + alive: exactly two pickers;
    // the actor (p0) and the dead p2 are not offered.
    expect(hasChoice("the pair 1", dialog) && hasChoice("the pair 2", dialog)).toBe(true);
    expect(hasChoice("the pair 3", dialog)).toBe(false);
    expect(offered("the pair 1", dialog).map((o) => o.value)).toEqual(["p1", "p3", "p4"]);
    expect(within(dialog).getByText(/choose 2 \(all different, not themself, living players only\)/)).toBeInTheDocument();
    choose("the pair 1", "p1", dialog);
    expect(offered("the pair 2", dialog).find((o) => o.value === "p1")!.disabled).toBe(true); // distinct
    choose("the pair 2", "p3", dialog);
    // participant, dead only.
    expect(offered("a dead player", dialog).map((o) => o.value)).toEqual(["p2"]);
    choose("a dead player", "p2", dialog);
    // character, count 2: a real (searchable) character picker from the active script.
    expect(offered("the characters 1", dialog).map((o) => o.value)).toEqual(expect.arrayContaining(["washerwoman", "chef", "imp", "monk"]));
    choose("the characters 1", "chef", dialog);
    choose("the characters 2", "imp", dialog);
    // alignment: typed choice.
    fireEvent.click(within(within(dialog).getByRole("radiogroup", { name: "the alignment" })).getByLabelText("Evil"));
    // number: empty is NOT 0.
    const num = within(dialog).getByRole("spinbutton", { name: "the number" });
    expect(within(dialog).getByRole("button", { name: /^(Confirm and record|Resolve)$/ })).toBeDisabled();
    fireEvent.change(num, { target: { value: "0" } });
    // text.
    fireEvent.change(within(dialog).getByRole("textbox", { name: "the words" }), { target: { value: "hello" } });
    // boolean untouched: still incomplete (never silently "no").
    expect(within(dialog).getByRole("region", { name: "Result" })).toHaveTextContent("the yes/no");
    expect(within(dialog).getByRole("button", { name: /^(Confirm and record|Resolve)$/ })).toBeDisabled();
    fireEvent.click(within(within(dialog).getByRole("radiogroup", { name: "the yes/no" })).getByLabelText("No"));

    const expected = {
      pair: { kind: "participant", participants: [{ playerId: "p1", participantId: game().players.p1!.participantId }, { playerId: "p3", participantId: game().players.p3!.participantId }] },
      deadOne: { kind: "participant", participants: [{ playerId: "p2", participantId: game().players.p2!.participantId }] },
      chars: { kind: "character", roleIds: ["chef", "imp"] },
      side: { kind: "alignment", alignment: "evil" },
      num: { kind: "number", value: 0 },
      flag: { kind: "boolean", value: false },
      words: { kind: "text", value: "hello" },
    };
    expect(seen.at(-1)!.inputs).toEqual(expected);
    fireEvent.click(within(dialog).getByRole("button", { name: /^(Confirm and record|Resolve)$/ }));
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect((resolveSpy.mock.calls[0]![0] as AbilityResolutionRequest & { inputs: unknown }).inputs).toEqual(expected);
    expect(game().players.p0!.reminders.map((r) => r.label)).toEqual(["fixture"]);
  });

  it("clearing a number makes it unanswered again (empty is never 0)", () => {
    const dialog = open(TYPED, "p0");
    const num = within(dialog).getByRole("spinbutton", { name: "the number" });
    fireEvent.change(num, { target: { value: "7" } });
    fireEvent.change(num, { target: { value: "" } });
    expect(seen.every((ctx) => ctx.inputs.num === undefined)).toBe(true);
    expect(within(dialog).getByRole("region", { name: "Result" })).toHaveTextContent("the number");
  });

  it("an unsupported judgment refuses the whole action rather than rendering a guided fallback", () => {
    const dialog = open(JUDGED, "p4");
    expect(within(dialog).queryByRole("region", { name: "Storyteller judgment" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Resolve" })).toBeDisabled();
    expect(store.getState().undoStack).toHaveLength(0);
    expect(game().history).toEqual([]);
  });
});
