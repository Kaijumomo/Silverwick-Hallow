import type { RoleRegistry } from "@/data/roleRegistry";
import { captureCharacterActionContext, selectScriptById, useStorytellerStore } from "@/stores/storytellerStore";
import { isPostDeal, selectSetupContext } from "@/features/setup/setupContext";
import type { PlayerId, RoleId, StorytellerLobbyRecord } from "@/stores/types";
import { flash, useV6Ui, type V6UiState } from "../v6Store";

/**
 * "The Deal": the Storyteller hands the tokens of the chosen composition to the seats one at a time (the Role Dealing design).
 * The draft lives only in the Grimoire's UI state. Nothing reaches the game until "Seal the Grimoire", which deals the whole
 * draft in the one command that already owns the Deal, so Undo, persistence and privacy are exactly those of a random deal.
 */
export type DealDraft = { cur: number; assign: Record<PlayerId, RoleId> };

const ui = () => useV6Ui.getState();
const store = () => useStorytellerStore.getState();

/** The card is showing: a draft exists and the town has not been dealt yet. */
export const dealingNow = (state: Pick<V6UiState, "deal">, game: StorytellerLobbyRecord): boolean => !!state.deal && game.phase === "setup" && !isPostDeal(game);

/** The residents in ring order: the seats The Deal hands tokens to (Travellers choose theirs separately). */
export const dealRing = (game: StorytellerLobbyRecord): PlayerId[] => game.seatOrder.filter((id) => { const p = game.players[id]; return !!p && !p.isEmpty && !p.isTraveler; });

/** Characters of the bag not yet given to a seat. The bag is a multiset, so a character in the bag twice can be given twice. */
export function tokensLeft(bag: readonly RoleId[], assign: Record<PlayerId, RoleId>): RoleId[] {
  const left = [...bag];
  for (const role of Object.values(assign)) {
    const at = left.indexOf(role);
    if (at >= 0) left.splice(at, 1);
  }
  return left;
}

/**
 * The official setup rule: the Marionette starts next to the Demon. True when the draft seats exactly one Demon and a Marionette
 * somewhere else on the ring of residents. It is the same test the setup analyzer applies before roles can be revealed.
 */
export function marionetteApart(assign: Record<PlayerId, RoleId>, ring: readonly PlayerId[], registry: RoleRegistry): boolean {
  const demons = ring.filter((id) => assign[id] && registry.get(assign[id]!)?.type === "demon");
  if (demons.length !== 1) return false;
  const n = ring.length;
  return ring.some((id, i) => assign[id] === "marionette" && ![ring[(i + n - 1) % n], ring[(i + 1) % n]].includes(demons[0]!));
}

const shuffled = <T>(items: readonly T[], rng: () => number): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
};

/**
 * Shuffle the rest: the tokens still in the bag go to the empty seats at random; every token already placed stays.
 * When that would leave the Marionette away from the Demon, the shuffle is drawn again (a few hundred times) so the
 * Storyteller is not handed a deal that cannot be sealed. If no draw fits, the last one stands and Seal explains why.
 */
export function shuffleRest(bag: readonly RoleId[], assign: Record<PlayerId, RoleId>, ring: readonly PlayerId[], registry: RoleRegistry, rng: () => number = Math.random): Record<PlayerId, RoleId> {
  const empty = ring.filter((id) => !assign[id]);
  const left = tokensLeft(bag, assign);
  let best: Record<PlayerId, RoleId> = assign;
  for (let attempt = 0; attempt < 300; attempt++) {
    const order = shuffled(left, rng);
    const next = { ...assign };
    empty.forEach((id, i) => { if (order[i]) next[id] = order[i]!; });
    best = next;
    if (!marionetteApart(next, ring, registry)) break;
  }
  return best;
}

/** Everything a deal action needs, read when it runs so it always sees the current game. */
function env() {
  const state = store();
  const game = state.game;
  const draft = ui().deal;
  if (!game || !draft) return null;
  const script = selectScriptById(state, game.scriptId);
  const context = selectSetupContext(game, script);
  const registry = context.registry;
  if (!registry) return null;
  return { game, context, registry, ring: dealRing(game), draft, bag: ui().pickSel };
}

const at = (cur: number, ring: readonly PlayerId[]) => Math.min(Math.max(0, cur), Math.max(0, ring.length - 1));

/** "Place one by one": the composition in the picker is the bag, the first seat is up, and the picker closes. */
export function openDeal(): void {
  ui().set({ deal: { cur: 0, assign: {} }, picker: null, card: false, swapFrom: null, panel: "players", pickHover: null });
  store().selectPlayer(null);
}

const withDraft = (patch: Partial<DealDraft>) => { const d = ui().deal; if (d) ui().set({ deal: { ...d, ...patch } }); };

/** The next seat after `from` (clockwise) that holds no token; stays put when every seat has one. */
function nextEmpty(from: number, ring: readonly PlayerId[], assign: Record<PlayerId, RoleId>): number {
  for (let step = 1; step <= ring.length; step++) {
    const j = (from + step) % ring.length;
    if (!assign[ring[j]!]) return j;
  }
  return from;
}

/** Give a token to the seat that is up. A token it already held goes back to the bag; the next empty seat is up. */
export function dealPick(role: RoleId): void {
  const e = env();
  if (!e) return;
  const cur = at(e.draft.cur, e.ring);
  const seat = e.ring[cur];
  if (!seat) return;
  const free = tokensLeft(e.bag, e.draft.assign);
  const mine = e.draft.assign[seat];
  if (!free.includes(role) && mine !== role) return;
  const assign = { ...e.draft.assign, [seat]: role };
  withDraft({ assign, cur: nextEmpty(cur, e.ring, assign) });
}

/** "return": the seat that is up gives its token back to the bag. */
export function dealReturn(): void {
  const e = env();
  if (!e) return;
  const seat = e.ring[at(e.draft.cur, e.ring)];
  if (!seat || !e.draft.assign[seat]) return;
  const assign = { ...e.draft.assign };
  delete assign[seat];
  withDraft({ assign });
}

/** "Gather all": every token goes back to the bag and the first seat is up. */
export function dealGather(): void { withDraft({ assign: {}, cur: 0 }); }

/** A seat was chosen, on the card (‹ ›) or on the board. */
export function dealGo(cur: number): void {
  const e = env();
  if (!e || !e.ring.length) return;
  withDraft({ cur: ((cur % e.ring.length) + e.ring.length) % e.ring.length });
}

/** The index in the ring of residents of a board seat, or -1 for a Traveller or an empty seat. */
export function dealSeatIndex(playerId: PlayerId): number { return env()?.ring.indexOf(playerId) ?? -1; }

export function dealShuffle(): void {
  const e = env();
  if (!e) return;
  const assign = shuffleRest(e.bag, e.draft.assign, e.ring, e.registry);
  withDraft({ assign, cur: Object.keys(assign).length === e.ring.length ? e.draft.cur : nextEmpty(at(e.draft.cur, e.ring), e.ring, assign) });
}

/** "‹ Composition": the tokens go back and the composition picker opens again with the same bag. */
export function dealBack(): void {
  ui().set({ deal: null, picker: { mode: "distribute" }, pickHover: null });
}

/** "Seal the Grimoire": the draft is dealt as one commit, once every seat holds a token and the Marionette is beside the Demon. */
export function dealSeal(): boolean {
  const e = env();
  if (!e) return false;
  const missing = e.ring.filter((id) => !e.draft.assign[id]).length;
  if (missing) { flash(`${missing} left to deal. Give every player a token first.`); return false; }
  if (marionetteApart(e.draft.assign, e.ring, e.registry)) { flash("The Marionette must sit next to the Demon. Return a token to move it."); return false; }
  const result = store().dealRolePool(e.bag, captureCharacterActionContext(), e.draft.assign);
  if (!result.ok) { flash(result.message ?? "Review setup before continuing."); return false; }
  ui().set({ deal: null, pickSel: [], picker: null });
  flash(`Roles dealt to ${e.ring.length} players.`);
  return true;
}
