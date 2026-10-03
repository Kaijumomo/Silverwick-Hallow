// Phase 10F -- SOL-10F-B1 (PHASE10F Section 35): every participant slot binds
// the participation instance chosen AT SELECTION TIME, slot by slot -- also
// while a multi-slot answer is still incomplete -- and a captured binding
// whose seat was reused is shown (and refused) as stale, never relabelled as
// the replacement occupant.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { RequirementInput } from "./RequirementInput";
import { NightOrderPanel } from "@/features/nightOrder/NightOrderPanel";
import { AL_HADIKHIA } from "@/abilities/characters/alhadikhia";
import { FORTUNE_TELLER } from "@/abilities/characters/fortuneteller";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { pickSeatIfPicking, useTargetPicker } from "./abilityUi";
import { bind, patchPlayer, proofGame, proofScript, reseat } from "@/test/proofFixtures";
import type { AbilityInputRequirement, AbilityInputValue } from "@/abilities/semantics";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { StorytellerLobbyRecord } from "@/stores/types";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ backend: null });
  useTargetPicker.setState({ active: null });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const AL = ["alhadikhia", "chef", "monk", "empath", "saint", "poisoner", "washerwoman"];
const FT = ["fortuneteller", "chef", "monk", "empath", "saint", "poisoner", "imp"];

/** RequirementInput alone, re-rendered with each new game state. */
function harness(requirement: AbilityInputRequirement, g0: StorytellerLobbyRecord, initial?: AbilityInputValue) {
  const onChange = vi.fn<(value: AbilityInputValue | undefined) => void>();
  let g = g0;
  const element = () => <RequirementInput requirement={requirement} game={g} script={proofScript} actor={bind(g, "p0")} onChange={onChange}
    {...(initial ? { initial } : {})} />;
  const view = render(element());
  const count = requirement.count ?? 1;
  return {
    onChange,
    slot: (n: number) => screen.getByRole("combobox", { name: count > 1 ? `${requirement.label} ${n}` : requirement.label }) as HTMLSelectElement,
    choose(n: number, playerId: string) { fireEvent.change(this.slot(n), { target: { value: playerId } }); },
    update(next: StorytellerLobbyRecord) { g = next; view.rerender(element()); },
    last: () => onChange.mock.calls.at(-1)?.[0],
    participants: () => { const value = onChange.mock.calls.at(-1)?.[0]; return value?.kind === "participant" ? value.participants : undefined; },
  };
}
const shown = (select: HTMLSelectElement) => select.selectedOptions[0]?.textContent ?? "";

describe("SOL-10F-B1 -- RequirementInput binds each slot when it is selected", () => {
  for (const [name, descriptor, roles] of [["Al-Hadikhia", AL_HADIKHIA, AL], ["Fortune Teller", FORTUNE_TELLER, FT]] as const) {
    const input = descriptor.inputs[0]!;
    const fill = (h: ReturnType<typeof harness>, ids: string[]) => ids.forEach((id, i) => h.choose(i + 2, id));
    const rest = (input.count ?? 1) === 3 ? ["p2", "p3"] : ["p2"];

    it(`Astra's reproduction (${name}): slot 1 = A; A replaced by B; slots filled -> the value keeps A's stale binding`, () => {
      const g = proofGame([...roles]);
      const h = harness(input, g);
      h.choose(1, "p1");
      expect(h.last()).toBeUndefined(); // incomplete: no answer yet
      const replaced = reseat(g, "p1");
      h.update(replaced);
      // Visible stale state: never the replacement occupant's name.
      expect(shown(h.slot(1))).toMatch(/No longer in that seat/);
      expect(shown(h.slot(1))).not.toMatch(/Replacement/);
      expect(screen.getByRole("status")).toHaveTextContent(/no longer in that seat/);
      fill(h, rest);
      expect(h.participants()).toEqual([bind(g, "p1"), ...rest.map((id) => bind(g, id))]);
      expect(h.participants()![0]!.participantId).not.toBe(replaced.players.p1!.participantId);
    });

    it(`${name}: the same seat without a participant change stays valid`, () => {
      const g = proofGame([...roles]);
      const h = harness(input, g);
      h.choose(1, "p1");
      h.update(patchPlayer(g, "p1", { name: "Renamed" })); // same participation instance
      fill(h, rest);
      expect(h.participants()).toEqual([bind(g, "p1"), ...rest.map((id) => bind(g, id))]);
      expect(screen.queryByRole("status")).toBeNull();
    });

    it(`${name}: explicitly choosing the stale slot again captures B's NEW binding`, () => {
      const g = proofGame([...roles]);
      const h = harness(input, g);
      h.choose(1, "p1");
      const replaced = reseat(g, "p1");
      h.update(replaced);
      h.choose(1, "p1");
      expect(shown(h.slot(1))).toMatch(/Replacement/);
      fill(h, rest);
      expect(h.participants()).toEqual([bind(replaced, "p1"), ...rest.map((id) => bind(replaced, id))]);
    });
  }

  it("filling another slot never rebuilds an earlier one; an initial answer keeps its own bindings", () => {
    const g = proofGame(AL);
    const input = AL_HADIKHIA.inputs[0]!;
    const initial: AbilityInputValue = { kind: "participant", participants: [bind(g, "p1"), bind(g, "p2"), bind(g, "p3")] };
    const h = harness(input, g, initial);
    const replaced = reseat(reseat(g, "p1"), "p2");
    h.update(replaced);
    expect(shown(h.slot(1))).toMatch(/No longer in that seat/);
    expect(shown(h.slot(2))).toMatch(/No longer in that seat/);
    h.choose(3, "p4");
    expect(h.participants()).toEqual([bind(g, "p1"), bind(g, "p2"), bind(g, "p4")]);
  });

  it("colon / unusual ParticipantIds are emitted exactly", () => {
    let g = proofGame(AL);
    for (const [id, pid] of [["p1", "a:b"], ["p2", "%3A.x"], ["p3", "ünï/[$]"]] as const) g = patchPlayer(g, id, { participantId: pid });
    const h = harness(AL_HADIKHIA.inputs[0]!, g);
    ["p1", "p2", "p3"].forEach((id, i) => h.choose(i + 1, id));
    expect(h.participants()!.map((b: ParticipantBinding) => b.participantId)).toEqual(["a:b", "%3A.x", "ünï/[$]"]);
  });

  it("distinctness compares ParticipantId: the same participant twice is blocked; stale A and its replacement B are different participants", () => {
    const g = proofGame(AL);
    const h = harness(AL_HADIKHIA.inputs[0]!, g);
    h.choose(1, "p1");
    expect((within(h.slot(2)).getByRole("option", { name: /Player 1/ }) as HTMLOptionElement).disabled).toBe(true);
    h.choose(2, "p1"); // forced (a disabled option): still never an answer
    h.choose(3, "p2");
    expect(h.last()).toBeUndefined();
    expect(screen.getByRole("alert")).toHaveTextContent("Choose different players.");
    // A replaced by B at the same seat: B is a DIFFERENT participant.
    const replaced = reseat(g, "p1");
    h.update(replaced);
    h.choose(2, "p1");
    expect(h.participants()).toEqual([bind(g, "p1"), bind(replaced, "p1"), bind(replaced, "p2")]);
  });
});

// --- Through the real Night Order / workspace ------------------------------

const game = () => store.getState().game!;
const open = (g: StorytellerLobbyRecord) =>
  store.setState({ game: g, lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript }, selectedPlayerId: null });
const reseatInStore = (id: string) => act(() => { store.setState({ game: reseat(game(), id) }); });
function Night() {
  const current = store((s) => s.game)!;
  return <NightOrderPanel game={current} script={proofScript} onClose={() => {}} />;
}
const card = (role: string, player: string) =>
  screen.getAllByText(role, { selector: ".step-role-name" }).map((el) => el.closest(".step-card") as HTMLElement)
    .find((el) => el.querySelector(".step-player-name")?.textContent?.startsWith(`${player} ·`))!;
const workspace = () => document.querySelector(".ability-workspace") as HTMLElement;

describe("SOL-10F-B1 -- workspace flows", () => {
  const AL_LABEL = AL_HADIKHIA.inputs[0]!.label;
  const FT_LABEL = FORTUNE_TELLER.inputs[0]!.label;
  const choose = (label: string, n: number, id: string) =>
    fireEvent.change(within(workspace()).getByRole("combobox", { name: `${label} ${n}` }), { target: { value: id } });

  it("Al-Hadikhia: A chosen for slot 1, A's seat reused, slots 2/3 filled -> refused as stale; nothing recorded", () => {
    open(proofGame(AL));
    render(<Night />);
    fireEvent.click(within(card("Al-Hadikhia", "Player 0")).getByRole("button", { name: "Guide" }));
    choose(AL_LABEL, 1, "p1");
    reseatInStore("p1");
    expect(within(workspace()).getByRole("status")).toHaveTextContent(/no longer in that seat/);
    choose(AL_LABEL, 2, "p2");
    choose(AL_LABEL, 3, "p3");
    expect(within(workspace()).getByRole("alert")).toHaveTextContent(/out of date/);
    expect(within(workspace()).queryByRole("radiogroup", { name: /Replacement/ })).toBeNull();
    expect(store.getState().undoStack).toHaveLength(0);
    expect(game().players.p1!.alive).toBe(true);
  });

  it("Fortune Teller: the same sequence is refused as stale", () => {
    open(proofGame(FT, "night", 1));
    render(<Night />);
    fireEvent.click(within(card("Fortune Teller", "Player 0")).getByRole("button", { name: "Guide" }));
    choose(FT_LABEL, 1, "p1");
    reseatInStore("p1");
    choose(FT_LABEL, 2, "p2");
    expect(within(workspace()).getByRole("alert")).toHaveTextContent(/out of date/);
    expect(game().informationDeliveries).toEqual([]);
  });

  it("B1 x A1: explicitly re-choosing the reused seat binds B, and the follow-up choice is asked for B (never A's)", () => {
    open(proofGame(AL));
    render(<Night />);
    fireEvent.click(within(card("Al-Hadikhia", "Player 0")).getByRole("button", { name: "Guide" }));
    choose(AL_LABEL, 1, "p1");
    reseatInStore("p1");
    choose(AL_LABEL, 1, "p1");
    choose(AL_LABEL, 2, "p2");
    choose(AL_LABEL, 3, "p3");
    expect(within(workspace()).queryByText(/out of date/)).toBeNull();
    expect(within(workspace()).getByRole("radiogroup", { name: /^1\. Replacement/ })).toBeInTheDocument();
    expect(within(workspace()).queryByRole("radiogroup", { name: /^1\. Player 1/ })).toBeNull();
  });

  it("B1 x B2: the workspace labels the initial and final death attempts of one player as separate judgments", () => {
    const generic = { id: "gp", type: "protected", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "night", day: 2 } };
    open(patchPlayer(proofGame(AL), "p1", { effects: [generic as StorytellerLobbyRecord["players"][string]["effects"][number]] }));
    render(<Night />);
    fireEvent.click(within(card("Al-Hadikhia", "Player 0")).getByRole("button", { name: "Guide" }));
    ["p1", "p2", "p3"].forEach((id, i) => choose(AL_LABEL, i + 1, id));
    const answer = (name: RegExp, value: "Yes" | "No") =>
      fireEvent.click(within(within(workspace()).getByRole("radiogroup", { name })).getByRole("radio", { name: value }));
    answer(/^1\. Player 1/, "No");
    answer(/after choosing to die/, "Yes");
    answer(/^2\. Player 2/, "Yes");
    answer(/^3\. Player 3/, "Yes");
    expect(within(workspace()).getByRole("radiogroup", { name: /Player 1 is protected .*final death/ })).toBeInTheDocument();
  });
});

describe("SOL-10F-B1 -- the inline flow shows a stale pick as stale", () => {
  const POISONER = ["poisoner", "empath", "chef", "monk", "imp", "saint", "spy"];
  const row = () => card("Poisoner", "Player 0");
  const select = () => within(row()).getByRole("combobox", { name: "The player to poison" }) as HTMLSelectElement;

  it("select: a reused seat never displays the replacement; re-choosing it targets B", () => {
    open(proofGame(POISONER));
    render(<Night />);
    fireEvent.change(select(), { target: { value: "p1" } });
    reseatInStore("p1");
    expect(shown(select())).toMatch(/No longer in that seat/);
    fireEvent.change(select(), { target: { value: "p1" } });
    fireEvent.click(within(row()).getByRole("button", { name: "Resolve" }));
    expect(game().players.p1!.effects).toEqual([expect.objectContaining({ type: "poisoned" })]);
    expect(game().players.p1!.participantId).toMatch(/replacement/);
  });

  it("Grimoire picker: the picked instance is captured at the tap; a reused seat shows stale", () => {
    open(proofGame(POISONER));
    render(<Night />);
    fireEvent.click(within(row()).getByRole("button", { name: "Pick on Grimoire" }));
    act(() => { expect(pickSeatIfPicking(game(), "p2")).toBe(true); });
    expect(shown(select())).toMatch(/Player 2/);
    reseatInStore("p2");
    expect(shown(select())).toMatch(/No longer in that seat/);
    fireEvent.click(within(row()).getByRole("button", { name: "Resolve" }));
    expect(within(row()).getByRole("alert")).toHaveTextContent(/no longer in that seat/);
    expect(game().players.p2!.effects).toEqual([]);
  });
});
