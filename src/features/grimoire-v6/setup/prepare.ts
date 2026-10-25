import { buildRegistry, type RoleRegistry } from "@/data/roleRegistry";
import { iconUrlFor } from "@/data/iconUrl";
import { shownRoleFilter } from "@/stores/identity";
import { changeAlignmentIntent } from "@/stores/alignmentResolution";
import { travelerHasUnresolvedArrival, travelerNeedsArrivalCheck } from "@/stores/travelers";
import { preparationAvailability, preparedInformationContext } from "@/stores/preparedInformation";
import { captureCharacterActionContext, selectScriptById, useStorytellerStore } from "@/stores/storytellerStore";
import { bindingOf } from "@/features/abilities/abilityUi";
import { initialRevealReadiness } from "@/features/setup/revealReadiness";
import { redHerringSetup } from "@/features/setup/redHerringSetup";
import { FIRST_INFORMATION_CHARACTERS, informationCategory } from "@/features/setup/FirstInformationPreparation";
import type { SetupContext } from "@/features/setup/setupContext";
import type { PlayerId, PreparedInformationCharacter, RoleDef, Script, StorytellerLobbyRecord } from "@/stores/types";
import { flash, useV6Ui } from "../v6Store";

/**
 * "Prepare the town" tasks: what the Storyteller still decides between the deal and Reveal. Each is one row of the
 * design's task list, backed by the existing authoritative commands (shown identity, Red Herring, first-night
 * information, Traveller alignment); nothing here writes a record itself.
 */
export type PrepTask = {
  key: string;
  roleId: string;
  roleName: string;
  who: string;
  img: string;
  /** The role's team, for the task's accent colour. */
  type: RoleDef["type"] | "traveler";
  done: boolean;
  /** Required before Reveal / Night 1; the rest are optional and asked for tonight when left. */
  req: boolean;
  sub: string;
  open: boolean;
  actLabel: string;
  act: () => void;
  altLabel?: string;
  alt?: () => void;
  undo: () => void;
};

const store = () => useStorytellerStore.getState();
const ui = () => useV6Ui.getState();
const seatName = (game: StorytellerLobbyRecord, id: PlayerId) => {
  const p = game.players[id];
  return p ? `Seat ${p.seat + 1} · ${p.name || "Unnamed"}` : "";
};

const TEAM_WORD: Record<PreparedInformationCharacter, string> = { washerwoman: "Townsfolk", librarian: "Outsider", investigator: "Minion" };

export function buildPrepTasks(game: StorytellerLobbyRecord, script: Script | undefined, registry: RoleRegistry, context: SetupContext): PrepTask[] {
  const tasks: PrepTask[] = [];
  const iconOf = (id: string) => { const def = registry.get(id); return def ? iconUrlFor(def) : ""; };
  const nameOf = (id: string) => registry.get(id)?.name ?? id;

  // Concealed identities (Drunk, Marionette, Lunatic ...): the shown character is the Storyteller's choice.
  const readiness = initialRevealReadiness(context);
  for (const p of context.ordinary) {
    if (!p.actualRole || !shownRoleFilter(p.behaviorMode)) continue;
    const pending = readiness.pendingIds.includes(p.id);
    const shown = p.shownRole ? nameOf(p.shownRole) : "";
    tasks.push({
      key: `shown:${p.id}`, roleId: p.actualRole, roleName: nameOf(p.actualRole), who: seatName(game, p.id), img: iconOf(p.actualRole), type: registry.get(p.actualRole)?.type ?? "townsfolk",
      done: !pending, req: true,
      sub: pending ? (p.shownRole ? "Required · choose a character that is not in play" : "Required · choose the character they think they are") : `Believes they are the ${shown}`,
      open: true, actLabel: "Choose", undo: () => openShown(p.id),
      act: () => openShown(p.id),
    });
  }

  // Fortune Teller's Red Herring.
  const herring = redHerringSetup(context);
  if (herring.required) {
    const teller = context.ordinary.find((p) => p.actualRole === "fortuneteller");
    const target = herring.target ? game.players[herring.target.playerId] : undefined;
    tasks.push({
      key: "redherring", roleId: "fortuneteller", roleName: nameOf("fortuneteller"), who: teller ? seatName(game, teller.id) : "", img: iconOf("fortuneteller"), type: "townsfolk",
      done: herring.status === "ready", req: true,
      sub: herring.status === "ready" ? `Red herring: ${target?.name || "selected player"}` : herring.status === "missing" ? "Required · choose a good player as the red herring" : `Required · ${herring.message}`,
      open: herring.status === "missing", actLabel: "Choose",
      act: () => startPrep("redherring", "fortuneteller"),
      undo: () => flash("The Red Herring is fixed once chosen. Use Undo to take it back."),
    });
  }

  // First-night information the Storyteller may prepare ahead (optional).
  if (script) {
    for (const p of context.ordinary) {
      const role = p.actualRole as PreparedInformationCharacter | undefined;
      if (!role || !FIRST_INFORMATION_CHARACTERS.has(role) || !p.participantId) continue;
      if (!preparationAvailability(game, bindingOf(p), role, { script, registry }).ok) continue;
      const prepared = game.preparedInformation.find((item) => item.source.participantId === p.participantId && item.character === role);
      const clue = prepared?.clue;
      const sub = prepared
        ? clue?.kind === "pair" ? `${nameOf(clue.shownCharacter)} · ${game.players[clue.candidates[0].participant.playerId]?.name ?? "—"} or ${game.players[clue.candidates[1].participant.playerId]?.name ?? "—"}` : "Shown 0 Outsiders"
        : `Pick a ${TEAM_WORD[role]} and a decoy · optional`;
      tasks.push({
        key: `info:${p.id}`, roleId: role, roleName: nameOf(role), who: seatName(game, p.id), img: iconOf(role), type: registry.get(role)?.type ?? "townsfolk",
        done: !!prepared, req: false, sub, open: true, actLabel: prepared ? "Change" : "Prepare",
        act: () => startPrep(`info:${p.id}`, role, p.id),
        altLabel: role === "librarian" && !prepared ? "or show 0 Outsiders" : undefined,
        alt: role === "librarian" ? () => zeroOutsiders(p.id) : undefined,
        undo: () => startPrep(`info:${p.id}`, role, p.id),
      });
    }
  }

  // Travellers: alignment is chosen privately; each required arrival is resolved by the Storyteller's explicit confirmation.
  for (const p of context.travelers) {
    if (!p.actualRole) continue;
    const base = { roleId: p.actualRole, roleName: nameOf(p.actualRole), who: seatName(game, p.id), img: iconOf(p.actualRole), type: "traveler" as const, done: false, req: true, open: true, undo: () => openCard(p.id) };
    if (!p.actualAlignment) {
      tasks.push({ ...base, key: `traveller:${p.id}`, sub: "Required · choose their alignment", actLabel: "Good", act: () => setAlignment(p.id, "good"), altLabel: "Evil", alt: () => setAlignment(p.id, "evil") });
      continue;
    }
    if (!travelerHasUnresolvedArrival(p)) continue;
    const state = store();
    if (travelerNeedsArrivalCheck(p) && !p.travelerArrival?.arrivalCheckComplete) {
      tasks.push({ ...base, key: `traveller:${p.id}:check`, sub: "Required · resolve the public starting information in person, then confirm",
        actLabel: "Resolved", act: () => state.completeTravelerArrivalCheck(p.id), altLabel: "Open", alt: () => openCard(p.id) });
    }
    if (p.actualAlignment === "evil" && !p.travelerArrival?.demonInfoComplete) {
      tasks.push({ ...base, key: `traveller:${p.id}:demon`, sub: "Required · give the Demon information in person, then confirm",
        actLabel: "Given", act: () => state.completeTravelerInformation(p.id), altLabel: "Open", alt: () => openCard(p.id) });
    }
  }
  return tasks;
}

const sortTasks = (tasks: PrepTask[]) => [...tasks].sort((a, b) => Number(a.done) - Number(b.done) || Number(b.req) - Number(a.req));
export const orderedTasks = sortTasks;

function openCard(id: PlayerId) {
  store().selectPlayer(id);
  ui().set({ card: true, panel: null });
}

function setAlignment(id: PlayerId, alignment: "good" | "evil") {
  const player = store().game?.players[id];
  if (!player) return;
  const result = store().resolveAlignments({ intents: [changeAlignmentIntent(player, alignment)] });
  if (!result.ok) flash(result.message ?? "Could not set the alignment.");
}

/** The Drunk-style picker: a character the player thinks they are. */
export function openShown(playerId: PlayerId) {
  ui().set({ picker: { mode: "drunk", playerId }, pickHover: null, pickSel: [], prepEdit: null, card: false });
}

/** Starts the tap-on-the-board preparation for a task. */
export function startPrep(key: string, roleId: string, ownerId?: PlayerId) {
  const game = store().game;
  const existing = ownerId && game ? game.preparedInformation.find((item) => item.source.playerId === ownerId && item.character === roleId) : undefined;
  const clue = existing?.clue;
  ui().set({
    picker: null, card: false, panel: "players",
    prepEdit: {
      key, slot: "a",
      a: clue?.kind === "pair" ? clue.candidates[0].participant.playerId : null,
      b: clue?.kind === "pair" ? clue.candidates[1].participant.playerId : null,
      token: clue?.kind === "pair" ? clue.shownCharacter : null,
    },
  });
  store().selectPlayer(null);
}

function zeroOutsiders(ownerId: PlayerId) {
  const state = store();
  const game = state.game;
  const owner = game?.players[ownerId];
  if (!game || !owner?.participantId) return;
  const result = state.prepareInformation({ source: bindingOf(owner), character: "librarian", clue: { kind: "zero-outsiders" },
    expected: preparedInformationContext(game, scriptOf(game)) }, captureCharacterActionContext());
  if (!result.ok) flash(result.message);
}

/** The script of the open game, exactly as the store resolves it. */
const scriptOf = (game: StorytellerLobbyRecord): Script | null => selectScriptById(store(), game.scriptId) ?? null;

/** The id of the task whose owner the prep edit belongs to, from its key. */
export const prepOwner = (key: string): PlayerId | null => (key.startsWith("info:") ? key.slice(5) : null);

/** Commits the board-tap preparation (the Done button). */
export function commitPrep(): void {
  const edit = ui().prepEdit;
  const state = store();
  const game = state.game;
  if (!edit || !game) return;
  if (edit.key === "redherring") {
    if (!edit.a) { flash("Tap a good player for the red herring."); return; }
    const target = game.players[edit.a];
    if (!target?.participantId) return;
    const result = state.setSetupRedHerring({ playerId: target.id, participantId: target.participantId }, captureCharacterActionContext());
    if (!result.ok) { flash(result.message ?? "The setup changed. Choose again."); return; }
    ui().set({ prepEdit: null });
    return;
  }
  const ownerId = prepOwner(edit.key);
  const owner = ownerId ? game.players[ownerId] : undefined;
  const a = edit.a ? game.players[edit.a] : undefined;
  const b = edit.b ? game.players[edit.b] : undefined;
  if (!owner?.participantId || !a?.participantId || !b?.participantId || !edit.token) { flash("Tap the player who holds the token, then a decoy."); return; }
  const result = state.prepareInformation({ source: bindingOf(owner), character: owner.actualRole as PreparedInformationCharacter,
    clue: { kind: "pair", candidates: [bindingOf(a), bindingOf(b)], shownCharacter: edit.token, qualifyingParticipantId: a.participantId },
    expected: preparedInformationContext(game, scriptOf(game)) }, captureCharacterActionContext());
  if (!result.ok) { flash(result.message); return; }
  ui().set({ prepEdit: null });
}

/** A board tap while a preparation is open. Returns whether the tap was consumed. */
export function prepTap(id: PlayerId): boolean {
  const edit = ui().prepEdit;
  const game = store().game;
  if (!edit || !game) return false;
  const tapped = game.players[id];
  if (!tapped || tapped.isEmpty) return true;
  if (edit.key === "redherring") {
    if (tapped.actualAlignment !== "good") { flash("Choose a good player for the red herring."); return true; }
    ui().set({ prepEdit: { ...edit, a: id } });
    return true;
  }
  const ownerId = prepOwner(edit.key);
  if (ownerId === id) { flash("Their own token is not shown to them."); return true; }
  const slot = edit.slot ?? "a";
  const other = slot === "a" ? "b" : "a";
  const next = { ...edit, [slot]: id };
  if (next[other] === id) next[other] = null;
  const owner = ownerId ? game.players[ownerId] : undefined;
  const script = scriptOf(game);
  const registry = buildRegistry(script ?? { id: game.scriptId, name: "", characters: [] });
  const wanted = owner?.actualRole ? informationCategory(owner.actualRole as PreparedInformationCharacter) : null;
  if (slot === "a" && wanted && tapped.actualRole && registry.get(tapped.actualRole)?.type === wanted) next.token = tapped.actualRole;
  next.slot = other;
  ui().set({ prepEdit: next });
  return true;
}
