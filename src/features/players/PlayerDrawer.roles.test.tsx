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
import { choose, chooseSegmentValue, chosen, hasChoice, offered, pickRoleNamed, rolePickerField } from "@/test/pickers";

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
    pickRoleNamed("Actual role", "Chef townsfolk");
    expect(screen.queryByRole("button", { name: /clear role/i })).toBeNull();
    unmount();
    goLive();
    render(<SeatDrawer seat={holder("chef")} />);
    expect(screen.queryByRole("button", { name: /clear role/i })).toBeNull();
  });

  it("the Actual and Shown pickers never offer a Traveler, Fabled or Loric character (an ordinary player)", () => {
    goLive();
    render(<SeatDrawer seat={holder("chef")} />);
    // Phase 10H: the pickers are searchable and loaded on demand -- open each.
    for (const label of ["Actual role", "Shown role"]) {
      offered(label);
      const titles = Array.from(rolePickerField(label).querySelectorAll(".role-picker-group-title")).map((el) => el.textContent);
      expect(titles.length).toBeGreaterThan(0);
      expect(titles.every((t) => ["Townsfolk", "Outsiders", "Minions", "Demons"].includes(t!))).toBe(true);
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
    pickRoleNamed("Actual role", "Saint outsider");
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
    pickRoleNamed("Actual role", "Monk townsfolk");
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
    pickRoleNamed("Shown role", "Chef townsfolk");
    expect(state().undoStack).toHaveLength(undo);
    expect(state().localSeq).toBe(seq);
    expect(player(id)).toMatchObject({ shownRole: "chef", shownAlignment: "evil", privateInfo: { extraText: "draft" } });
  });

  it("Shown alignment, behavior mode and 'clear' are explicit perception changes; a refusal is shown inline and changes nothing", async () => {
    goLive();
    const id = holder("chef");
    render(<SeatDrawer seat={id} />);
    // Phase 10E: explicit player-facing overrides are progressively disclosed
    // (closed here: the dealt explicit Good equals Normal, so nothing is
    // meaningfully overridden -- SOL-10E-R1).
    fireEvent.click(behaviorSection().getByText("Override what they are told…"));
    fireEvent.click(await behaviorSection().findByRole("button", { name: "Shown Evil" }));
    expect(player(id).shownAlignment).toBe("evil");
    chooseSegmentValue("Mode", "custom");
    expect(player(id).behaviorMode).toBe("custom");
    fireEvent.click(behaviorSection().getByRole("button", { name: "Clear Shown role" }));
    expect(player(id)).toMatchObject({ shownRole: null, shownAlignment: null });
    // No alignment without a character: refused, explained, nothing changed.
    const before = player(id);
    fireEvent.click(behaviorSection().getByRole("button", { name: "Shown Good" }));
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
    pickRoleNamed("Actual role", "Saint outsider");
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
    // Phase 10H (§7): no role list is in the default DOM -- the ordinary picker
    // is a closed trigger and the correction picker is not mounted at all.
    expect(actualSection().queryAllByRole("button", { name: "Saint outsider" })).toHaveLength(0);
    expect(hasChoice("Corrected role")).toBe(false);
    fireEvent.click(summary);
    await waitFor(() => expect(hasChoice("Corrected role")).toBe(true));
    pickRoleNamed("Corrected role", "Saint outsider", summary.closest("details")!);
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
    expect(hasChoice("Actual role")).toBe(false); // the ordinary picker is read-only
    fireEvent.click(screen.getByText("Correct the recorded role…"));
    await waitFor(() => expect(hasChoice("Corrected role")).toBe(true));
    pickRoleNamed("Corrected role", "Saint outsider");
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
    expect(chosen("Public character")).toBe("");
    pickRoleNamed("Public character", "Thief traveler");
    expect(player(zed)).toMatchObject({ actualRole: "thief", shownRole: "thief", publicDisplayRole: "thief" });
    expect(roleHistory()).toHaveLength(1);
    // Phase 10H: the searchable picker has no "none" choice and no Clear for a
    // Traveler's public character -- there is nothing that could clear it.
    expect(screen.queryByRole("button", { name: "Clear Public character" })).toBeNull();
    expect(offered("Public character").map((o) => o.value)).not.toContain("");
    expect(player(zed).actualRole).toBe("thief");
  });

  it("the Traveler picker lists the canonical catalogue (including Cacklejack)", () => {
    const zed = travelerSeat();
    render(<TravelerArrival playerId={zed} />);
    expect(offered("Public character").map((o) => o.value)).toEqual(expect.arrayContaining(TRAVELERS.map((r) => r.id)));
    expect(screen.getByRole("button", { name: "Cacklejack traveler" })).toBeInTheDocument();
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
  /** Opens the (on-demand) Traveler picker so a later stale press lands on the
   * already-rendered card, exactly as the former selector did. */
  const openPicker = () => { offered("Public character"); };
  const press = (roleName: string) => pickRoleNamed("Public character", roleName);

  it("stale same participant: rendered Thief, underlying becomes Gunslinger, the stale selector choosing Scapegoat is refused -- Gunslinger remains", () => {
    const zed = liveTraveler("thief");
    render(<TravelerArrival playerId={zed} />);
    expect(chosen("Public character")).toBe("thief");
    openPicker();
    let afterGunslinger = game();
    let seq = state().localSeq;
    act(() => {
      expect(state().assignRole(zed, "gunslinger")).toMatchObject({ ok: true, changed: true });
      afterGunslinger = game();
      seq = state().localSeq;
      press("Scapegoat traveler");
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
    openPicker();
    const a = player(zed).participantId;
    let replacement = player(zed);
    act(() => {
      expect(state().unseatPlayer(zed)).toBe(true);
      state().addToPendingQueue("uid-new", "Newbie");
      expect(state().assignPendingToSeat("uid-new", zed)).toBe(true);
      replacement = player(zed);
      press("Scapegoat traveler");
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
    press("Gunslinger traveler");
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
    press("Thief traveler");
    expect(player(zed)).toMatchObject({ actualRole: "thief", shownRole: "thief" });
    // Fixture staging only (Phase 10F: Life refuses ability use in Setup).
    store.setState({ game: { ...game(), players: { ...game().players, [zed]: { ...player(zed), abilityUsed: true } } } });
    press("Gunslinger traveler");
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
    expect(hasChoice("Public character")).toBe(false);
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
    offered("Actual role");
    offered("Shown role");
    expect(actualSection().getAllByRole("button", { name: "Chef townsfolk" })).toHaveLength(1);
    expect(behaviorSection().getAllByRole("button", { name: "Chef townsfolk" })).toHaveLength(1);
    expect(behaviorSection().getByRole("button", { name: "Normal (Good)" })).toBeInTheDocument();
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
  /** The names a searchable character picker offers for one RoleId. */
  const characterOptions = (container: HTMLElement, id: string) => {
    offered("Character", container);
    return Array.from(rolePickerField("Character", container).querySelectorAll<HTMLElement>(`[data-role-id="${id}"] .role-card-name`)).map((n) => n.textContent);
  };
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
    expect(arrival.getByRole("button", { name: /^Public character: Thief\./ })).toBeInTheDocument();
    expect(chosen("Public character")).toBe("thief");
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
    const bluffSection = screen.getByText("Demon bluffs (ST private)").closest("section")!;
    offered("Add bluff", bluffSection);
    const bluffs = within(bluffSection);
    expect(bluffs.queryByRole("button", { name: /Gunslinger/ })).toBeNull();
    expect(bluffs.queryByRole("button", { name: /Thief/ })).toBeNull();
    fireEvent.click(bluffs.getByRole("button", { name: "Monk townsfolk" }));
    expect(player(imp).privateInfo?.bluffs).toEqual(["monk"]);
  });

  it("OWNER-3: the Effect source picker offers exactly one thief -- the canonical Traveler Thief -- and names a created Effect's source by it; the Reminder source picker agrees", () => {
    const { zed } = astraSequence();
    const target = holder("chef");
    render(<SeatDrawer seat={target} />);
    addEffectForm();
    const form = screen.getByRole("form", { name: "Add effect" });
    expect(characterOptions(form, "thief")).toEqual(["Thief"]);
    const values = offered("Character", form).map((o) => o.value);
    expect(new Set(values).size).toBe(values.length); // one option per RoleId
    // Choosing Zed as the source defaults to Zed's Actual Role: the canonical Thief.
    choose("Caused by", zed, form);
    expect(chosen("Character", form)).toBe("thief");
    expect(within(rolePickerField("Character", form)).getByRole("button", { name: /^Character: Thief\./ })).toHaveTextContent("Character: Thief");
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));
    expect(player(target).effects.some((e) => e.sourceCharacter === "thief")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Show details/ }));
    expect(screen.getByText("Zed · Thief")).toBeInTheDocument();
    expect(screen.queryByText(/Homebrew/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    expect(characterOptions(screen.getByRole("group", { name: "Reminder options" }), "thief")).toEqual(["Thief"]);
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
    addEffectForm();
    expect(characterOptions(screen.getByRole("form", { name: "Add effect" }), "thief")).toEqual([canonicalThief.name]);
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
    const bluffSection = screen.getByText("Demon bluffs (ST private)").closest("section")!;
    offered("Add bluff", bluffSection);
    expect(within(bluffSection).getByRole("button", { name: "Lampwright townsfolk" })).toBeInTheDocument();
    addEffectForm();
    const form = screen.getByRole("form", { name: "Add effect" });
    expect(characterOptions(form, "hollowking")).toEqual(["Hollow King"]);
    expect(characterOptions(form, "lampwright")).toEqual(["Lampwright"]);
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
    pickRoleNamed("Shown role", "Librarian townsfolk");
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
