// Phase 10D: the Player Drawer's Role/perception workflow. Routine operation
// stays fast (one tap, no forms); "Clear role" is gone; every picker offers
// only what the Role seam accepts; changes are bound to the participation the
// drawer rendered (stale -> refused inline, never overwritten); advanced
// correction is progressively disclosed; Privacy Mode renders no Role detail;
// an unsafe Shown Role surfaces a Storyteller-only "Needs check".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { needsShownIdentity } from "@/stores/identity";
import { GrimoireCircle, buildRoleDisplayMap } from "@/features/grimoire/GrimoireCircle";
import { TRAVELERS } from "@/data/travelers";
import { buildRegistry, resolvedCharacters } from "@/data/roleRegistry";
import { PlayerDrawer } from "./PlayerDrawer";
import { TravelerArrival } from "./TravelerArrival";
import type { PlayerId } from "@/stores/types";

const state = () => store.getState();
const game = () => state().game!;
const player = (id: PlayerId) => game().players[id]!;
const idOf = (name: string) => game().seatOrder.find((id) => player(id).name === name)!;
const holder = (role: string) => game().seatOrder.find((id) => player(id).actualRole === role)!;
const roleHistory = () => game().history.filter((h) => h.category === "role");

function SeatDrawer({ seat }: { seat: PlayerId }) {
  const p = store((s) => s.game!.players[seat]!);
  return <PlayerDrawer player={p} />;
}
const behaviorSection = () => within(screen.getByText("Behavior & deception").closest("section")!);
const actualSection = () => within(screen.getByText("Actual role (ST private)").closest("section")!);

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  usePrivacyStore.setState({ enabled: false });
  store.setState({ game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null,
    customScripts: { [setupScript.id]: setupScript } });
  state().newGame(setupScript.id, { plannedPlayerCount: 7 });
  ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace"].forEach((n) => state().addPlayerToSeat(n));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function goLive() {
  state().setRolePool(standardRoles(7));
  expect(state().dealRolePool().ok).toBe(true);
  for (const id of game().seatOrder) {
    if (needsShownIdentity(player(id).actualRole)) state().setShownRole(id, "chef");
    else state().showAssignedRole(id);
  }
  expect(state().revealRoles().ok).toBe(true);
  expect(state().beginNightOne().ok).toBe(true);
  store.setState({ undoStack: [] });
}

describe("no 'Clear role', and pickers offer only what the seam accepts", () => {
  it("the ordinary live Drawer has no Clear role action (before assignment, before Reveal, and in live play)", () => {
    const { unmount } = render(<SeatDrawer seat={idOf("Alice")} />);
    expect(screen.queryByRole("button", { name: /clear role/i })).toBeNull();
    fireEvent.click(within(screen.getByText("Actual role (ST private)").closest("section")!).getByRole("button", { name: "Chef townsfolk" }));
    expect(screen.queryByRole("button", { name: /clear role/i })).toBeNull();
    unmount();
    goLive();
    render(<SeatDrawer seat={holder("chef")} />);
    expect(screen.queryByRole("button", { name: /clear role/i })).toBeNull();
  });

  it("the Actual and Shown pickers never offer a Traveler, Fabled or Loric character (an ordinary player)", () => {
    goLive();
    render(<SeatDrawer seat={holder("chef")} />);
    for (const section of [actualSection(), behaviorSection()]) {
      const titles = section.getAllByText(/^(townsfolk|outsider|minion|demon|traveler|fabled|loric)$/, { selector: ".role-picker-group-title" }).map((el) => el.textContent);
      expect(titles.length).toBeGreaterThan(0);
      expect(titles.every((t) => ["townsfolk", "outsider", "minion", "demon"].includes(t!))).toBe(true);
    }
    expect(screen.queryByRole("button", { name: /Thief traveler/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Djinn/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Bootlegger/ })).toBeNull();
  });
});

describe("routine operation goes through the Role seam", () => {
  it("picking a new Actual role in live play is ONE commit: one Undo entry, one localSeq step, one Role History record; perception is unchanged", () => {
    goLive();
    const id = holder("chef");
    const before = player(id);
    render(<SeatDrawer seat={id} />);
    const seq = state().localSeq;
    fireEvent.click(actualSection().getByRole("button", { name: "Saint outsider" }));
    expect(state().localSeq).toBe(seq + 1);
    expect(state().undoStack).toHaveLength(1);
    expect(player(id)).toMatchObject({ actualRole: "saint", shownRole: before.shownRole, shownAlignment: before.shownAlignment });
    expect(roleHistory()).toHaveLength(1);
    expect(roleHistory()[0]).not.toHaveProperty("correction");
  });

  it("'Also show the player the new role' commits the Actual change and the explicit perception in the SAME resolution", () => {
    goLive();
    const id = holder("chef");
    render(<SeatDrawer seat={id} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Also show the player the new role" }));
    const seq = state().localSeq;
    fireEvent.click(actualSection().getByRole("button", { name: "Monk townsfolk" }));
    expect(state().localSeq).toBe(seq + 1);
    expect(state().undoStack).toHaveLength(1);
    expect(player(id)).toMatchObject({ actualRole: "monk", shownRole: "monk", shownAlignment: null });
    expect(roleHistory()).toHaveLength(1); // perception writes no Role History
    act(() => state().undo());
    expect(player(id).actualRole).toBe("chef");
    expect(player(id).shownRole).toBe("chef");
  });

  it("'Show assigned role' and picking the identical shown role are true no-ops (no Undo, no localSeq, nothing cleared)", () => {
    goLive();
    const id = holder("chef");
    state().setShownAlignment(id, "evil");
    state().setPrivateText(id, "draft");
    render(<SeatDrawer seat={id} />);
    const undo = state().undoStack.length; const seq = state().localSeq;
    fireEvent.click(screen.getByRole("button", { name: "Show assigned role" }));
    fireEvent.click(behaviorSection().getByRole("button", { name: "Chef townsfolk" }));
    expect(state().undoStack).toHaveLength(undo);
    expect(state().localSeq).toBe(seq);
    expect(player(id)).toMatchObject({ shownRole: "chef", shownAlignment: "evil", privateInfo: { extraText: "draft" } });
  });

  it("Shown alignment, behavior mode and 'clear' are explicit perception changes; a refusal is shown inline and changes nothing", () => {
    goLive();
    const id = holder("chef");
    render(<SeatDrawer seat={id} />);
    fireEvent.click(behaviorSection().getByRole("button", { name: "evil" }));
    expect(player(id).shownAlignment).toBe("evil");
    fireEvent.change(behaviorSection().getByLabelText("Mode:"), { target: { value: "custom" } });
    expect(player(id).behaviorMode).toBe("custom");
    fireEvent.click(behaviorSection().getByRole("button", { name: "clear" }));
    expect(player(id)).toMatchObject({ shownRole: null, shownAlignment: null });
    // No alignment without a character: refused, explained, nothing changed.
    const before = player(id);
    fireEvent.click(behaviorSection().getByRole("button", { name: "good" }));
    expect(player(id)).toBe(before);
    expect(screen.getByRole("alert")).toHaveTextContent(/choose a character to show/i);
  });
});

describe("participation-bound and stale-safe", () => {
  it("a Drawer rendered for one participant never overwrites its replacement: the change is refused stale, inline", () => {
    goLive();
    const seat = holder("chef");
    const stale = player(seat);
    render(<PlayerDrawer player={stale} />);
    state().unseatPlayer(seat);
    state().addToPendingQueue("uid-new", "Newbie");
    expect(state().assignPendingToSeat("uid-new", seat)).toBe(true);
    const replacement = player(seat);
    const seq = state().localSeq;
    fireEvent.click(actualSection().getByRole("button", { name: "Saint outsider" }));
    expect(player(seat)).toBe(replacement);
    expect(state().localSeq).toBe(seq);
    expect(screen.getByRole("alert")).toHaveTextContent(/nothing was changed/i);
    // The refusal names no character.
    expect(screen.getByRole("alert").textContent).not.toMatch(/saint|chef/i);
  });
});

describe("advanced correction is progressively disclosed", () => {
  it("no correction control before the Reveal; after Night 1 begins it is a closed disclosure whose picker records a CORRECTION and keeps abilityUsed", async () => {
    render(<SeatDrawer seat={idOf("Alice")} />);
    expect(screen.queryByText("Correct the recorded role…")).toBeNull();
    cleanup();
    goLive();
    const id = holder("chef");
    state().setAbilityUsed(id, true);
    render(<SeatDrawer seat={id} />);
    const summary = screen.getByText("Correct the recorded role…");
    const picker = () => actualSection().queryAllByRole("button", { name: "Saint outsider" });
    expect(picker()).toHaveLength(1); // only the ordinary Actual picker: the correction picker is closed
    fireEvent.click(summary);
    await waitFor(() => expect(picker()).toHaveLength(2));
    const correctionPicker = within(summary.closest("details")!);
    fireEvent.click(correctionPicker.getByRole("button", { name: "Saint outsider" }));
    expect(player(id)).toMatchObject({ actualRole: "saint", abilityUsed: true });
    expect(roleHistory()).toHaveLength(1);
    expect(roleHistory()[0]!.correction).toBe(true);
  });

  it("between the initial Reveal and Night 1 the ordinary picker stays read-only and a correction repairs the starting assignment (no History)", async () => {
    state().setRolePool(standardRoles(7));
    state().dealRolePool();
    for (const id of game().seatOrder) needsShownIdentity(player(id).actualRole) ? state().setShownRole(id, "chef") : state().showAssignedRole(id);
    expect(state().revealRoles().ok).toBe(true);
    const id = holder("chef");
    render(<SeatDrawer seat={id} />);
    expect(screen.getByText(/starting ordinary assignment is locked/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Correct the recorded role…"));
    const disclosure = within(screen.getByText("Correct the recorded role…").closest("details")!);
    fireEvent.click(await disclosure.findByRole("button", { name: "Saint outsider" }));
    expect(player(id).actualRole).toBe("saint");
    expect(game().history).toHaveLength(0);
    expect(game().phase).toBe("setup");
  });
});

describe("Traveler public character", () => {
  function travelerSeat() {
    goLive();
    state().addPlayer("Zed");
    return idOf("Zed");
  }
  it("choosing a Traveler character goes through the seam; the placeholder is not a selectable 'clear'", () => {
    const zed = travelerSeat();
    render(<SeatDrawer seat={zed} />);
    const select = screen.getByLabelText("Public character") as HTMLSelectElement;
    expect(within(select).getByRole("option", { name: "Choose Traveler" })).toBeDisabled();
    fireEvent.change(select, { target: { value: "thief" } });
    expect(player(zed)).toMatchObject({ actualRole: "thief", shownRole: "thief", publicDisplayRole: "thief" });
    expect(roleHistory()).toHaveLength(1);
    fireEvent.change(select, { target: { value: "" } });
    expect(player(zed).actualRole).toBe("thief");
  });

  it("the Traveler picker lists the canonical catalogue (including Cacklejack)", () => {
    const zed = travelerSeat();
    render(<TravelerArrival playerId={zed} />);
    expect(screen.getByRole("option", { name: "Cacklejack" })).toBeInTheDocument();
  });
});

// ASTRA-10D-003: the Traveler selector is bound to the Traveler record it
// RENDERED. Each "controlled render" commits a render, then -- inside one act
// scope, so React has not re-rendered yet -- the underlying state changes and
// the Storyteller's input lands on the already-rendered (stale) control.
describe("ASTRA-10D-003: Traveler Role actions are bound to the rendered Traveler record", () => {
  function liveTraveler(role = "thief") {
    goLive();
    state().addPlayer("Zed");
    const zed = idOf("Zed");
    expect(player(zed).isTraveler).toBe(true);
    if (role) expect(state().assignRole(zed, role)).toMatchObject({ ok: true, changed: true });
    store.setState({ undoStack: [] });
    return zed;
  }
  const select = () => screen.getByLabelText("Public character") as HTMLSelectElement;

  it("stale same participant: rendered Thief, underlying becomes Gunslinger, the stale selector choosing Scapegoat is refused -- Gunslinger remains", () => {
    const zed = liveTraveler("thief");
    render(<TravelerArrival playerId={zed} />);
    expect(select().value).toBe("thief");
    let afterGunslinger = game();
    let seq = state().localSeq;
    act(() => {
      expect(state().assignRole(zed, "gunslinger")).toMatchObject({ ok: true, changed: true });
      afterGunslinger = game();
      seq = state().localSeq;
      fireEvent.change(select(), { target: { value: "scapegoat" } });
    });
    expect(player(zed)).toMatchObject({ actualRole: "gunslinger", shownRole: "gunslinger", publicDisplayRole: "gunslinger" });
    expect(game()).toBe(afterGunslinger); // the stale click changed nothing
    expect(state().localSeq).toBe(seq);
    expect(roleHistory().map((h) => h.change)).toEqual([
      { kind: "value", from: { actualRole: "" }, to: { actualRole: "thief" } },
      { kind: "value", from: { actualRole: "thief" }, to: { actualRole: "gunslinger" } },
    ]);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/nothing was changed/i);
    // The refusal is safe: it names no character.
    expect(alert.textContent).not.toMatch(/thief|gunslinger|scapegoat/i);
  });

  it("replacement: A's rendered selector never mutates participation B now occupying the same PlayerId", () => {
    const zed = liveTraveler("thief");
    render(<TravelerArrival playerId={zed} />);
    const a = player(zed).participantId;
    let replacement = player(zed);
    act(() => {
      expect(state().unseatPlayer(zed)).toBe(true);
      state().addToPendingQueue("uid-new", "Newbie");
      expect(state().assignPendingToSeat("uid-new", zed)).toBe(true);
      replacement = player(zed);
      fireEvent.change(select(), { target: { value: "scapegoat" } });
    });
    expect(replacement.participantId).not.toBe(a);
    expect(replacement).toMatchObject({ isTraveler: true, actualRole: "" });
    expect(player(zed)).toBe(replacement); // B unchanged
    expect(screen.getByRole("alert")).toHaveTextContent(/nothing was changed/i);
    expect(screen.getByRole("alert").textContent).not.toMatch(/thief|scapegoat/i);
  });

  it("a stale 'Show public character' is refused too; a current one applies through the seam", () => {
    const zed = liveTraveler("thief");
    // A Traveler whose public character is not (yet) shown in their own view.
    store.setState({ game: { ...game(), players: { ...game().players, [zed]: { ...player(zed), shownRole: null } } } });
    render(<TravelerArrival playerId={zed} />);
    act(() => {
      expect(state().assignRole(zed, "gunslinger")).toMatchObject({ ok: true, changed: true });
      fireEvent.click(screen.getByRole("button", { name: "Show public character in player view" }));
    });
    expect(player(zed)).toMatchObject({ actualRole: "gunslinger", shownRole: "gunslinger" });
    expect(screen.getByRole("alert")).toHaveTextContent(/nothing was changed/i);
    cleanup();
    store.setState({ game: { ...game(), players: { ...game().players, [zed]: { ...player(zed), shownRole: null } } } });
    render(<TravelerArrival playerId={zed} />);
    fireEvent.click(screen.getByRole("button", { name: "Show public character in player view" }));
    expect(player(zed)).toMatchObject({ actualRole: "gunslinger", shownRole: "gunslinger" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a current (non-stale) Traveler change succeeds as ONE gameplay commit", () => {
    const zed = liveTraveler("thief");
    state().setAbilityUsed(zed, true);
    store.setState({ undoStack: [] });
    render(<TravelerArrival playerId={zed} />);
    const seq = state().localSeq;
    fireEvent.change(select(), { target: { value: "gunslinger" } });
    expect(player(zed)).toMatchObject({ actualRole: "gunslinger", shownRole: "gunslinger", publicDisplayRole: "gunslinger", abilityUsed: false });
    expect(state().undoStack).toHaveLength(1);
    expect(state().localSeq).toBe(seq + 1);
    expect(roleHistory().at(-1)).toMatchObject({ change: { from: { actualRole: "thief" }, to: { actualRole: "gunslinger" } } });
    expect(roleHistory().at(-1)!.correction).toBeUndefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("after the initial Reveal (before Night 1): an unassigned Traveler is assigned; a committed character is CORRECTED (abilityUsed kept, no History)", () => {
    state().setRolePool(standardRoles(7));
    expect(state().dealRolePool().ok).toBe(true);
    for (const id of game().seatOrder) needsShownIdentity(player(id).actualRole) ? state().setShownRole(id, "chef") : state().showAssignedRole(id);
    expect(state().revealRoles().ok).toBe(true);
    state().addPlayer("Zed");
    const zed = idOf("Zed");
    render(<TravelerArrival playerId={zed} />);
    fireEvent.change(select(), { target: { value: "thief" } });
    expect(player(zed)).toMatchObject({ actualRole: "thief", shownRole: "thief" });
    state().setAbilityUsed(zed, true);
    fireEvent.change(select(), { target: { value: "gunslinger" } });
    expect(player(zed)).toMatchObject({ actualRole: "gunslinger", shownRole: "gunslinger", abilityUsed: true });
    expect(game().phase).toBe("setup");
    expect(game().history).toHaveLength(0);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Privacy Mode: only the public character is shown -- no selector, no Role actions, no refusal text", () => {
    const zed = liveTraveler("thief");
    usePrivacyStore.setState({ enabled: true });
    render(<TravelerArrival playerId={zed} />);
    expect(screen.getByText("Traveler: Thief")).toBeInTheDocument();
    expect(screen.queryByLabelText("Public character")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

// SOL-10D-C03: a legacy STORED script may still carry a duplicate RoleId; the
// Drawer displays, offers and derives from the FIRST (owning) definition --
// the same one the Role seam, registry and projection resolve.
describe("SOL-10D-C03: the Drawer resolves a legacy duplicate RoleId to its first definition", () => {
  it("the Actual role card, the pickers and the derived alignment all use the owner", () => {
    goLive();
    const chef = setupScript.characters.find((r) => r.id === "chef")!;
    const evilChef = { id: "chef", name: "Evil Chef", type: "minion" as const, ability: "Homebrew." };
    store.setState({ customScripts: { [setupScript.id]: { ...setupScript,
      characters: [chef, evilChef, ...setupScript.characters.filter((r) => r.id !== "chef")] } } });
    const id = holder("chef");
    expect(state().setShownAlignment(id, null)).toMatchObject({ ok: true });
    render(<SeatDrawer seat={id} />);
    const card = within(document.querySelector(".role-display") as HTMLElement);
    expect(card.getByText("Chef")).toBeInTheDocument();
    expect(card.getByText("townsfolk")).toBeInTheDocument();
    expect(screen.queryByText("Evil Chef")).toBeNull();
    expect(actualSection().getAllByRole("button", { name: "Chef townsfolk" })).toHaveLength(1);
    expect(behaviorSection().getAllByRole("button", { name: "Chef townsfolk" })).toHaveLength(1);
    expect(behaviorSection().getByRole("button", { name: "auto (good)" })).toBeInTheDocument();
  });
});

// Phase 10D (CLOSURE-03): canonical Traveler precedence downstream. Astra's
// reachable sequence: a legacy STORED script whose FIRST definition of "thief"
// is a homebrew Demon (the canonical Traveler Thief is listed later, and the
// canonical Traveler catalogue has explicit precedence over any script
// definition of that id); ordinary Setup never uses the id; live play begins;
// a late Traveler arrives and is assigned the canonical Traveler Thief. Every
// Role-dependent control then resolves the ONE definition the registry does.
describe("CLOSURE-03: the Drawer, private information, Effect/Reminder source and Grimoire follow canonical Traveler precedence", () => {
  const canonicalThief = TRAVELERS.find((r) => r.id === "thief")!;
  const homebrewThief = { id: "thief", name: "Homebrew Thief", type: "demon" as const, ability: "Homebrew Demon that steals." };
  function astraSequence(first: { id: string; name: string; type: "demon" | "townsfolk"; ability: string } = homebrewThief) {
    const legacy = { ...setupScript, characters: [first, ...setupScript.characters] };
    store.setState({ customScripts: { [setupScript.id]: legacy } }); // 1. the legacy collision
    goLive(); // 2-3. ordinary Setup never uses the id; live play begins
    expect(game().seatOrder.some((id) => player(id).actualRole === first.id)).toBe(false);
    state().addPlayer("Zed"); // 4. a late Traveler arrives
    const zed = idOf("Zed");
    expect(player(zed).isTraveler).toBe(true);
    expect(state().assignRole(zed, "thief")).toMatchObject({ ok: true, changed: true }); // 5. canonical Traveler Thief
    store.setState({ undoStack: [] });
    return { legacy, zed };
  }
  const characterOptions = (select: HTMLElement, id: string) =>
    Array.from((select as HTMLSelectElement).options).filter((o) => o.value === id).map((o) => o.textContent);
  const addEffectForm = () => {
    fireEvent.click(screen.getByRole("button", { name: "+ Add effect" }));
    return within(screen.getByRole("form", { name: "Add effect" }));
  };

  it("OWNER-1: the Traveler's Drawer resolves the canonical Traveler Thief -- no Demon bluff controls, nothing of the inert homebrew Demon", () => {
    const { zed } = astraSequence();
    render(<SeatDrawer seat={zed} />);
    expect(screen.queryByText("Demon bluffs (ST private)")).toBeNull();
    expect(screen.queryByText("Demon setup information")).toBeNull();
    expect(screen.queryByText("Bluffs:")).toBeNull();
    expect(screen.queryByText(/Homebrew/)).toBeNull();
    const arrival = within(screen.getByRole("region", { name: "Traveler arrival for Zed" }));
    expect((arrival.getByLabelText("Public character") as HTMLSelectElement).value).toBe("thief");
    expect(player(zed).privateInfo?.bluffs).toBeUndefined();
  });

  it("OWNER-2: no private-information control offers or creates bluff data from a shadowed definition -- a real Demon's bluff pool omits a Traveler-shadowed good character", () => {
    // A GOOD-typed homebrew first definition shadowed by the canonical Traveler
    // Gunslinger would otherwise be a bluff candidate.
    const homebrewGunslinger = { id: "gunslinger", name: "Homebrew Gunslinger", type: "townsfolk" as const, ability: "Homebrew." };
    const { zed } = astraSequence(homebrewGunslinger);
    render(<SeatDrawer seat={zed} />);
    expect(screen.queryByText("Bluffs:")).toBeNull(); // the Traveler Thief has no bluff controls at all
    cleanup();
    const imp = holder("imp");
    render(<SeatDrawer seat={imp} />);
    const bluffs = within(screen.getByText("Demon bluffs (ST private)").closest("section")!);
    expect(bluffs.queryByRole("button", { name: /Gunslinger/ })).toBeNull();
    expect(bluffs.queryByRole("button", { name: /Thief/ })).toBeNull();
    fireEvent.click(bluffs.getByRole("button", { name: "Monk townsfolk" }));
    expect(player(imp).privateInfo?.bluffs).toEqual(["monk"]);
  });

  it("OWNER-3: the Effect source picker offers exactly one thief -- the canonical Traveler Thief -- and names a created Effect's source by it; the Reminder source picker agrees", () => {
    const { zed } = astraSequence();
    const target = holder("chef");
    render(<SeatDrawer seat={target} />);
    const form = addEffectForm();
    const character = form.getByLabelText("Character") as HTMLSelectElement;
    expect(characterOptions(character, "thief")).toEqual(["Thief"]);
    const values = Array.from(character.options).map((o) => o.value);
    expect(new Set(values).size).toBe(values.length); // one option per RoleId
    // Choosing Zed as the source defaults to Zed's Actual Role: the canonical Thief.
    fireEvent.change(form.getByLabelText("Caused by"), { target: { value: zed } });
    expect(character.value).toBe("thief");
    expect(character.selectedOptions[0]!.textContent).toBe("Thief");
    fireEvent.click(form.getByRole("button", { name: "Add" }));
    expect(player(target).effects.some((e) => e.sourceCharacter === "thief")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Show details/ }));
    expect(screen.getByText("Zed · Thief")).toBeInTheDocument();
    expect(screen.queryByText(/Homebrew/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    const reminderOptions = within(screen.getByRole("group", { name: "Reminder options" }));
    expect(characterOptions(reminderOptions.getByLabelText("Character"), "thief")).toEqual(["Thief"]);
  });

  it("OWNER-4: registry, Grimoire, Drawer and Effect source all resolve the SAME definition of thief", () => {
    const { legacy, zed } = astraSequence();
    expect(buildRegistry(legacy).get("thief")).toBe(canonicalThief);
    expect(buildRoleDisplayMap(legacy).get("thief")).toBe(canonicalThief);
    expect(resolvedCharacters(legacy).filter((r) => r.id === "thief")).toEqual([canonicalThief]);
    render(<GrimoireCircle />);
    const token = screen.getByRole("button", { name: /^Zed, seat/ });
    expect(within(token).getByText(canonicalThief.name)).toHaveClass("type-traveler");
    cleanup();
    render(<SeatDrawer seat={zed} />);
    expect(screen.queryByText(/Homebrew/)).toBeNull();
    expect(screen.queryByText("Demon bluffs (ST private)")).toBeNull();
    expect(characterOptions(addEffectForm().getByLabelText("Character"), "thief")).toEqual([canonicalThief.name]);
  });

  it("OWNER-5: a homebrew ordinary Role with a non-Traveler id is unchanged -- its own card, its Demon bluff controls and one source-character option", () => {
    const hollowKing = { id: "hollowking", name: "Hollow King", type: "demon" as const, ability: "Homebrew Demon." };
    const lampwright = { id: "lampwright", name: "Lampwright", type: "townsfolk" as const, ability: "Homebrew townsfolk." };
    store.setState({ customScripts: { [setupScript.id]: { ...setupScript, characters: [...setupScript.characters, hollowKing, lampwright] } } });
    goLive();
    const demon = holder("imp");
    expect(state().assignRole(demon, "hollowking")).toMatchObject({ ok: true, changed: true });
    render(<SeatDrawer seat={demon} />);
    const card = within(document.querySelector(".role-display") as HTMLElement);
    expect(card.getByText("Hollow King")).toBeInTheDocument();
    expect(card.getByText("demon")).toBeInTheDocument();
    const bluffs = within(screen.getByText("Demon bluffs (ST private)").closest("section")!);
    expect(bluffs.getByRole("button", { name: "Lampwright townsfolk" })).toBeInTheDocument();
    const character = addEffectForm().getByLabelText("Character");
    expect(characterOptions(character, "hollowking")).toEqual(["Hollow King"]);
    expect(characterOptions(character, "lampwright")).toEqual(["Lampwright"]);
  });
});

describe("Privacy Mode", () => {
  it("renders no Role transition detail: the safe view has no pickers, corrections, perception controls or role names, and a refusal never names a character", () => {
    goLive();
    const id = holder("chef");
    render(<SeatDrawer seat={id} />);
    expect(screen.getByText("Correct the recorded role…")).toBeInTheDocument();
    act(() => usePrivacyStore.getState().setEnabled(true));
    expect(screen.getByText("Storyteller details are hidden while Privacy Mode is on.")).toBeInTheDocument();
    expect(screen.queryByText("Correct the recorded role…")).toBeNull();
    expect(screen.queryByText("Actual role (ST private)")).toBeNull();
    expect(screen.queryByText("Behavior & deception")).toBeNull();
    expect(screen.queryByRole("button", { name: /Saint outsider|Chef townsfolk/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/Chef|Saint|Imp\b/);
    // Turning Privacy Mode off restores the drawer; it does not resurrect stale detail.
    act(() => usePrivacyStore.getState().setEnabled(false));
    expect(screen.getByText("Correct the recorded role…")).toBeInTheDocument();
  });
});

describe("Needs check for an unsafe Shown Role (Storyteller-only)", () => {
  function plantUnsafe() {
    goLive();
    const id = holder("chef");
    store.setState({ game: { ...game(), players: { ...game().players, [id]: { ...player(id), shownRole: "not-a-role" } } } });
    return id;
  }
  it("the Drawer says so and stays usable; choosing what to show resolves it", () => {
    const id = plantUnsafe();
    render(<SeatDrawer seat={id} />);
    expect(screen.getByText(/the shown character cannot be sent/i)).toBeInTheDocument();
    fireEvent.click(behaviorSection().getByRole("button", { name: "Librarian townsfolk" }));
    expect(player(id).shownRole).toBe("librarian");
    expect(screen.queryByText(/the shown character cannot be sent/i)).toBeNull();
  });

  it("the Grimoire token carries a concise 'Needs check' -- and under Privacy Mode nothing is rendered at all", () => {
    const id = plantUnsafe();
    render(<GrimoireCircle />);
    const token = screen.getByRole("button", { name: new RegExp(`^${player(id).name}, seat`) });
    expect(token.getAttribute("aria-label")).toMatch(/needs check/i);
    expect(within(token).getByText("Needs check")).toBeInTheDocument();
    act(() => usePrivacyStore.getState().setEnabled(true));
    const hidden = screen.getByRole("button", { name: new RegExp(`^${player(id).name}, seat`) });
    expect(hidden.getAttribute("aria-label")).not.toMatch(/needs check/i);
    expect(within(hidden).queryByText("Needs check")).toBeNull();
  });
});
