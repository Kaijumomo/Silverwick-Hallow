import { AbilityEntry } from "@/features/abilities/AbilityEntry";
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { MAX_ST_NOTES } from "@/stores/schemas";
import { TextLimit } from "@/components/TextLimit";
import { useStorytellerStore, selectScriptById } from "@/stores/storytellerStore";
import { TRAVELERS } from "@/data/travelers";
import { isInitialRevealComplete, needsShownIdentity, shownRoleFilter } from "@/stores/identity";
import { canRefineSetup } from "@/features/setup/setupRefinement";
import { PlayerInformation, commitExtraTextDraft } from "./PlayerInformation";
import { changeRoleIntent, correctRoleIntent, ordinaryRoleChoices, setPerceptionIntent } from "@/stores/roleResolution";
import type { RoleIntent } from "@/stores/roleResolution";
import { identityNeedsCheck } from "@/stores/projections";
import { TravelerArrival } from "./TravelerArrival";
import { ActualAlignmentControls, PlayerFacingAlignmentControls } from "./AlignmentControls";
import { publicTravelerRole } from "@/stores/travelers";
import { getPrivateInfoApplicability } from "@/stores/privatePackets";
import { roleAuthority } from "@/data/canonical";
import { evilInformationPolicy } from "@/features/nightOrder/nightRules";
import { buildRegistry, resolvedCharacters } from "@/data/roleRegistry";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useShellStore, type InspectorDetent } from "@/stores/shellStore";
import { useShellLayout } from "@/components/useShellLayout";
import { EffectControls } from "@/features/effects/EffectControls";
import { ReminderControls } from "@/features/reminders/ReminderControls";
import { lifeStatusOf } from "@/stores/lifeState";
import { LifeControls } from "@/features/life/LifeControls";
import { LifeStateText } from "@/features/life/LifeMarks";
import { RolePicker } from "@/components/RolePicker";
import { ParticipantPicker } from "@/components/ParticipantPicker";
import { Segmented } from "@/components/Segmented";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { TruthStrip } from "./TruthStrip";
import type {
  BehaviorMode,
  RoleDef,
  STPlayerRecord,
} from "@/stores/types";

const BEHAVIOR_MODES: { value: BehaviorMode; label: string; help: string }[] = [
  { value: "normal", label: "Normal", help: "Acts as their actual role." },
  {
    value: "drunk_fake_role_behavior",
    label: "Drunk (fake role)",
    help: "Believes they are their shown role. Follow its simulated wake and choose the information manually; no truthful result is computed.",
  },
  {
    value: "fake_demon_behavior",
    label: "Fake demon (Lunatic)",
    help: "Believes they are the demon. Wake at demon times; give fake bluffs and (optionally) fake minions.",
  },
  {
    value: "marionette_fake_good_behavior",
    label: "Fake good (Marionette)",
    help: "Follows the shown good character's simulated wake. Excluded from the normal Minion introduction.",
  },
  {
    value: "poisoned",
    label: "Poisoned",
    help: "Use the Poisoned status chip for nightly poisoning. Use this mode only for ongoing fake-info behavior.",
  },
  { value: "custom", label: "Custom", help: "Track manually with notes." },
];

type PlayerDrawerProps = {
  player: STPlayerRecord;
  onRemove?: (id: string) => Promise<void> | void;
  onUnseat?: (id: string) => Promise<void> | void;
  onCorrectOutcome?: () => void;
};

/**
 * Phase 10H (contract §§5, 7, 9; H4, I1): the participant workspace -- the
 * Inspector. NON-MODAL: it never inerts the Table, traps focus or blocks the
 * page; the Grimoire stays operable beside it. Its hierarchy is frozen:
 * Truth -> Now -> Identity -> Records -> Admin. It supports the detents
 * peek (Truth + Now) -> expanded (everything) -> hidden (a slim tab that keeps
 * the selection); the detent is session-local UI state (shellStore).
 *
 * Focus: opening moves focus to the Inspector heading; Escape (from inside it)
 * or Close returns focus to the invoker (normally the seat). Role pickers are
 * searchable and loaded on demand -- never dumped into the default DOM.
 *
 * Notes (§9): the ST-notes draft commits on blur, on Close and on a seat
 * change; Privacy Mode teardown DISCARDS an uncommitted draft rather than
 * silently committing it.
 */
function InspectorShell({ title, playerId, onClose, detent, mode, children }: {
  title: string;
  playerId: string;
  onClose: () => void;
  detent: InspectorDetent;
  /** "private" / "safe": a Privacy Mode switch replaces the contents. */
  mode: "private" | "safe";
  children: ReactNode;
}) {
  const asideRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const invokerRef = useRef<HTMLElement | null>(null);
  // On open and on every selection change: remember the invoker (when focus is
  // outside the Inspector) and move focus to the Inspector heading.
  useEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !asideRef.current?.contains(active)) invokerRef.current = active;
    if (detent !== "hidden") headingRef.current?.focus({ preventScroll: true });
  }, [playerId]);
  // Focus is never left on a control that disappeared (Privacy Mode swapping
  // the contents, a detent change): it lands on the Inspector heading.
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) headingRef.current?.focus({ preventScroll: true });
  }, [mode, detent]);
  // Unmount (Close / Escape / deselection): focus returns predictably to the
  // invoker, or to the participant's seat when the invoker is gone.
  useEffect(() => () => {
    const inside = asideRef.current?.contains(document.activeElement) || document.activeElement === document.body;
    if (!inside) return;
    const invoker = invokerRef.current;
    const seat = document.querySelector<HTMLElement>(`.grimoire .token[data-player-id="${CSS.escape(playerId)}"]`);
    const target = invoker?.isConnected && !invoker.closest("[inert]") ? invoker : seat;
    target?.focus({ preventScroll: true });
  }, [playerId]);
  return (
    <aside ref={asideRef} className="inspector" role="complementary" aria-label={title} data-detent={detent}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        e.preventDefault();
        onClose();
      }}>
      <InspectorHeadingContext.Provider value={headingRef}>{children}</InspectorHeadingContext.Provider>
    </aside>
  );
}

const InspectorHeadingContext = createContext<RefObject<HTMLHeadingElement> | null>(null);

/** The Inspector header: the participant, the detent controls and Close. */
function InspectorHeader({ name, seat, detent, onDetent, onClose, expandable = true }: {
  name: string;
  seat: number | null;
  detent: InspectorDetent;
  onDetent: (detent: InspectorDetent) => void;
  onClose: () => void;
  expandable?: boolean;
}) {
  const headingRef = useContext(InspectorHeadingContext);
  return (
    <div className="drawer-header inspector-header">
      <h2 ref={headingRef} tabIndex={-1} className="inspector-title">
        <span className="inspector-name">{name}</span>
        {seat !== null && <span className="inspector-seat"> · seat {seat + 1}</span>}
      </h2>
      <div className="inspector-detents">
        {expandable && detent !== "hidden" && (
          <button type="button" className="btn btn-sm" aria-pressed={detent === "expanded"}
            onClick={() => onDetent(detent === "expanded" ? "peek" : "expanded")}>
            {detent === "expanded" ? "Peek" : "Expand"}
          </button>
        )}
        <button type="button" className="btn btn-sm" onClick={() => onDetent(detent === "hidden" ? "expanded" : "hidden")}
          aria-label={detent === "hidden" ? `Show the Inspector for ${name}` : "Hide the Inspector"}>
          {detent === "hidden" ? "Show" : "Hide"}
        </button>
        <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Close">✕</button>
      </div>
    </div>
  );
}

/** One labelled group of the frozen hierarchy (Truth / Now / Identity / Records / Admin). */
function InspectorGroup({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="inspector-group" role="group" aria-labelledby={id} data-inspector-group={title}>
      <h3 id={id} className="inspector-group-title">{title}</h3>
      {children}
    </div>
  );
}

function PrivacySafeContents({ player }: { player: STPlayerRecord }) {
  return (
    <div className="drawer-body">
      <section className="drawer-section">
        <h3 className="drawer-section-title">Safe view</h3>
        <p className="privacy-safe-player-name">{player.name || "Unnamed player"}</p>
        {publicTravelerRole(player) && <p>Traveler: {publicTravelerRole(player)!.name}</p>}
        <div className="drawer-row">
          <span className="label">seat {player.seat + 1}</span>
          {/* Phase 10A: life, vote token and exile are public table
              information -- Privacy Mode never hides them. */}
          <LifeStateText state={lifeStatusOf(player).state} className="label" />
        </div>
        <p className="behavior-help">Storyteller details are hidden while Privacy Mode is on.</p>
      </section>
    </div>
  );
}

export function PlayerDrawer({ player, onRemove, onUnseat, onCorrectOutcome }: PlayerDrawerProps) {
  const game = useStorytellerStore((s) => s.game);
  const script = useStorytellerStore((s) =>
    game ? selectScriptById(s, game.scriptId) : undefined
  );
  const selectPlayer = useStorytellerStore((s) => s.selectPlayer);
  const renamePlayer = useStorytellerStore((s) => s.renamePlayer);
  const removePlayer = useStorytellerStore((s) => s.removePlayer);
  const movePlayer = useStorytellerStore((s) => s.movePlayer);
  const resolveRoles = useStorytellerStore((s) => s.resolveRoles);
  const replaceSetupRole = useStorytellerStore((s) => s.replaceSetupRole);
  const swapSetupRoles = useStorytellerStore((s) => s.swapSetupRoles);
  const setBluffs = useStorytellerStore((s) => s.setBluffs);
  const setFakeMinions = useStorytellerStore((s) => s.setFakeMinions);
  const setIsTraveler = useStorytellerStore((s) => s.setIsTraveler);
  const setAbilityUsed = useStorytellerStore((s) => s.setAbilityUsed);
  const setNotes = useStorytellerStore((s) => s.setNotes);
  const privacyMode = usePrivacyStore((s) => s.enabled);
  const layout = useShellLayout();
  const storedDetent = useShellStore((s) => s.inspectorDetent);
  const setDetent = useShellStore((s) => s.setInspectorDetent);
  const litActor = useShellStore((s) => s.litActor);
  // The layout default: a phone opens at peek (thumb zone), wider layouts expanded.
  const detent: InspectorDetent = storedDetent ?? (layout === "phone" ? "peek" : "expanded");

  const [nameDraft, setNameDraft] = useState(player.name);
  const [refinementError, setRefinementError] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [abilityError, setAbilityError] = useState<string | null>(null);
  const [perceptionError, setPerceptionError] = useState<string | null>(null);
  // Optional, per change: also show the player the new character in the same
  // atomic resolution (never assumed -- a concealed character needs the
  // Storyteller's own choice of what is shown).
  const [alsoShowNewRole, setAlsoShowNewRole] = useState(false);
  // The advanced correction disclosure renders its picker only while open, so
  // a closed disclosure adds no controls to the drawer.
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [travelerStatusError, setTravelerStatusError] = useState<string | null>(null);
  const [membershipBusy, setMembershipBusy] = useState(false);
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"remove" | "unseat" | null>(null);
  const [notesDraft, setNotesDraft] = useState(player.stNotes);
  // §9: the draft and the participant it belongs to, so a seat change commits
  // it to the participant it was written for -- never to the next occupant.
  const notesOwner = useRef({ playerId: player.id, participantId: player.participantId, draft: player.stNotes });
  notesOwner.current.draft = notesDraft;
  useEffect(() => {
    setNameDraft(player.name);
  }, [player.id, player.name]);
  useEffect(() => {
    const previous = notesOwner.current;
    if (previous.playerId !== player.id) {
      const latest = useStorytellerStore.getState().game?.players[previous.playerId];
      if (latest && latest.participantId === previous.participantId && previous.draft !== latest.stNotes) {
        setNotes(previous.playerId, previous.draft);
      }
    }
    notesOwner.current = { playerId: player.id, participantId: player.participantId, draft: player.stNotes };
    setNotesDraft(player.stNotes);
  }, [player.id, player.stNotes]);
  // §9: Privacy Mode teardown discards (never silently commits) a draft.
  useEffect(() => {
    if (!privacyMode) return;
    const latest = useStorytellerStore.getState().game?.players[player.id];
    setNotesDraft(latest?.stNotes ?? "");
    setConfirming(null);
  }, [privacyMode]);

  // SOL-10D-C03 / CLOSURE-03: every Role this drawer displays or names -- the
  // current and shown Role, a bluff -- is the ONE definition the registry
  // resolves for its RoleId (a script's first definition; the canonical
  // Traveler over any script definition of the same id), the same one the Role
  // seam, projection, Grimoire and private information use. Bluff candidates
  // are the ordinary choices the Role seam admits, never a shadowed definition.
  const roleById = useMemo(
    () => new Map(resolvedCharacters(script).map((c) => [c.id, c])),
    [script]
  );
  const ordinaryChoices = useMemo(() => ordinaryRoleChoices(script), [script]);
  const registry = useMemo(() => script ? buildRegistry(script) : null, [script]);
  const applicability = registry ? getPrivateInfoApplicability(player, registry) : null;
  // Phase 10D: every Role/perception change goes through the one Role seam,
  // bound to the participation instance and observed state this drawer
  // RENDERED (never re-read at click time), so a seat that changed in between
  // is refused as stale rather than overwritten. A refusal's message (which
  // never names a character) is shown inline.
  const runRoles = (intents: RoleIntent[], report: (message: string | null) => void = setRoleError) => {
    const result = resolveRoles({ intents });
    report(result.ok ? null : result.message);
    return result.ok;
  };
  // Pre-Reveal Setup administration window: while it applies, the actual-role
  // picker routes through the Setup-specific override (fresh identity reset)
  // instead of the generic assignRole() (which deliberately preserves shown
  // identity, for later in-game character changes).
  const refinementAvailable = !!game && canRefineSetup(game).ok;
  const otherOrdinaryPlayers = useMemo(
    () => !game ? [] : game.seatOrder
      .map((id) => game.players[id])
      .filter((p): p is STPlayerRecord => !!p && !p.isEmpty && !p.isTraveler && p.id !== player.id),
    [game, player.id]
  );

  // Roles currently assigned to any player — used to exclude from bluff pickers.
  const inPlayRoles = useMemo(
    () =>
      new Set(
        Object.values(game?.players ?? {})
          .map((p) => p.actualRole)
          .filter(Boolean)
      ),
    [game?.players]
  );

  const commitNotes = () => {
    if (usePrivacyStore.getState().enabled) return;
    const latest = useStorytellerStore.getState().game?.players[player.id];
    if (latest && notesDraft !== latest.stNotes) {
      setNotes(player.id, notesDraft);
    }
  };

  // Shared by every dismissal path (Close, Escape) -- a dirty notes draft is
  // committed on an explicit dismissal; Privacy Mode has already discarded it.
  const close = () => {
    commitNotes();
    selectPlayer(null);
  };

  if (!game || !script) return null;
  if (privacyMode) return (
    <InspectorShell title={`Player ${player.name}`} playerId={player.id} onClose={close} detent={detent} mode="safe">
      <InspectorHeader name="Player" seat={null} detent={detent === "hidden" ? "hidden" : "peek"}
        onDetent={setDetent} onClose={close} expandable={false} />
      {detent !== "hidden" && <PrivacySafeContents player={player} />}
    </InspectorShell>
  );
  const role = player.actualRole ? roleById.get(player.actualRole) : undefined;
  const shownRoleDef = player.shownRole ? roleById.get(player.shownRole) : undefined;
  const displayRole = role;
  const acting = game.phase === "night" && litActor?.playerId === player.id && litActor.participantId === player.participantId;

  const commitName = () => {
    if (nameDraft.trim() && nameDraft.trim() !== player.name) {
      renamePlayer(player.id, nameDraft);
    } else {
      setNameDraft(player.name);
    }
  };

  const runMembershipAction = async (action: () => Promise<void> | void) => {
    if (membershipBusy) return;
    setMembershipError(null);
    setMembershipBusy(true);
    try {
      await action();
      setConfirming(null);
      selectPlayer(null);
    } catch (e) {
      setConfirming(null);
      setMembershipError(e instanceof Error ? e.message : "Could not update this player's membership.");
    } finally {
      setMembershipBusy(false);
    }
  };

  // Role pool for the main "Actual role" picker: only what the Role seam will
  // accept -- an ordinary participant's Townsfolk/Outsider/Minion/Demon of this
  // script, or a Traveler's canonical characters. Never Fabled or Loric.
  const rolePool = player.isTraveler ? TRAVELERS : ordinaryChoices;
  const perceptionNeedsCheck = !!registry && identityNeedsCheck(player, registry);

  // Phase 9 Setup finalization (FINAL SETUP INTEGRATION REVISION, Section
  // 2): Reveal is a hard starting-setup commitment boundary. Between a
  // completed initial Reveal and Night 1 actually beginning, the committed
  // starting ordinary roster (Traveler status, and each ordinary player's
  // actual role) is read-only here -- never falling back to the generic
  // assignRole() the way it would for a legitimate in-game change once
  // Night/Day has begun. Traveler character assignment is deliberately
  // unaffected: Travelers are never part of the committed ordinary roster.
  const committedReadOnly = game.phase === "setup" && isInitialRevealComplete(game);
  const expanded = detent === "expanded";

  return (
    <InspectorShell title={`Participant: ${player.name || `seat ${player.seat + 1}`}`} playerId={player.id} onClose={close} detent={detent} mode="private">
      <InspectorHeader name={player.name || "Unnamed player"} seat={player.seat} detent={detent} onDetent={setDetent} onClose={close} />
      {detent !== "hidden" && (
        <div className="drawer-body inspector-body">
          {/* ---------------- 1. Truth ---------------- */}
          <TruthStrip player={player} roleById={roleById} registry={registry} acting={acting} />

          {/* ---------------- 2. Now ---------------- */}
          <InspectorGroup title="Now">
            {/* Phase 10A: life changes are semantic commands (death, execution,
                exile, resurrection, vote token, correction) -- never a bare
                alive/dead toggle. */}
            <LifeControls player={player} />
            {onCorrectOutcome && <button type="button" className="btn btn-sm" onClick={onCorrectOutcome}>Correct recorded outcome</button>}

            {/* Phase 10F (SOL-10F-L3): progressively disclosed ability entry --
                the same workspace / coordinator / one-commit command as the
                Night Order; keyed by participation so no draft carries over. */}
            <AbilityEntry key={`ability:${player.participantId ?? player.id}`} player={player} />

            <section className="drawer-section">
              <h4 className="drawer-section-title">State</h4>
              {/* Phase 10F: through the Life boundary -- marking used is a
                  gameplay use, clearing it a correction; Night/Day only. */}
              <div className="drawer-row">
                <button
                  className="toggle-pill"
                  aria-pressed={player.abilityUsed}
                  disabled={game.phase !== "night" && game.phase !== "day"}
                  onClick={() => {
                    const result = setAbilityUsed(player.id, !player.abilityUsed);
                    setAbilityError(result.ok ? null : result.message);
                  }}
                >
                  Ability used
                </button>
                {game.phase !== "night" && game.phase !== "day" && <span className="disabled-reason">Ability use is recorded during Night or Day.</span>}
              </div>
              {abilityError && <p className="behavior-help" role="alert">{abilityError}</p>}
            </section>

            {/* Phase 10B: Effects -- one-tap manual quick effects, the compact
                aggregated active list, and the advanced workflow. Keyed by the
                participation instance so no disclosure state carries over to
                a different occupant of this seat. */}
            <EffectControls key={`effects:${player.participantId ?? player.id}`} player={player} />
          </InspectorGroup>

          {!expanded ? (
            <button type="button" className="btn btn-sm inspector-more" onClick={() => setDetent("expanded")}>
              Identity, Records and Admin…
            </button>
          ) : <>
          {/* ---------------- 3. Identity ---------------- */}
          <InspectorGroup title="Identity">
            {player.isTraveler && <TravelerArrival playerId={player.id} />}

            {!player.isTraveler && <section className="drawer-section">
              <h4 className="drawer-section-title">Actual role (ST private)</h4>
              {displayRole ? (
                <div className="role-display">
                  <span className={`role-display-label type-${displayRole.type}`}>
                    {displayRole.name}
                  </span>
                  <span className="label">{displayRole.type}</span>
                  {displayRole.ability && (
                    <p className="role-display-ability prose">{displayRole.ability}</p>
                  )}
                  <p className="behavior-help">{roleAuthority(displayRole)}</p>
                </div>
              ) : (
                <p className="behavior-help">No role assigned yet.</p>
              )}
              {committedReadOnly ? (
                <p className="behavior-help">Roles are revealed; the starting ordinary assignment is locked until Night 1 begins. Use a correction to repair it.</p>
              ) : <>
                <RolePicker
                  label="Actual role"
                  roles={rolePool}
                  value={player.actualRole || null}
                  triggerText={displayRole ? "Change actual role…" : "Choose actual role…"}
                  onPick={(id) => {
                    setRefinementError(null);
                    setRoleError(null);
                    if (refinementAvailable) {
                      const result = replaceSetupRole(player.id, id);
                      if (!result.ok) setRefinementError(result.message);
                    } else {
                      runRoles([
                        changeRoleIntent(player, id),
                        ...(alsoShowNewRole && !needsShownIdentity(id)
                          ? [setPerceptionIntent(player, { shownRole: id, shownAlignment: null })] : []),
                      ]);
                    }
                  }}
                />
                <p className="behavior-help">
                  {refinementAvailable
                    ? "Setup refinement: changing the actual role resets this player's shown identity for the new assignment."
                    : "Changing the actual role keeps the player's shown identity unchanged unless you also show the new role."}
                </p>
                {!refinementAvailable && (
                  <label className="drawer-row">
                    <input type="checkbox" checked={alsoShowNewRole} onChange={(e) => setAlsoShowNewRole(e.target.checked)} />
                    <span>Also show the player the new role</span>
                  </label>
                )}
                {displayRole && !needsShownIdentity(player.actualRole) && (
                  <button className="btn btn-sm" onClick={() => {
                    setRoleError(null);
                    runRoles([setPerceptionIntent(player, {
                      shownRole: player.actualRole,
                      shownAlignment: player.shownRole === player.actualRole ? player.shownAlignment : null,
                    })]);
                  }}>
                    Show assigned role
                  </button>
                )}
                {refinementAvailable && otherOrdinaryPlayers.length > 0 && (
                  /* Phase 10H (§10.3): the swap partner is chosen on the Table or Roster. */
                  <ParticipantPicker game={game} label="Swap role with" value={null} candidates={otherOrdinaryPlayers}
                    defaultOpen={false}
                    onChange={(binding) => {
                      if (!binding) return;
                      setRefinementError(null);
                      const result = swapSetupRoles(player.id, binding.playerId);
                      if (!result.ok) setRefinementError(result.message);
                    }} />
                )}
                {refinementError && <p role="alert" className="field-error">{refinementError}</p>}
              </>}
              {/* Advanced, progressively disclosed: a CORRECTION repairs a
                  wrongly recorded Role. It is not a gameplay character change:
                  the ability-used marker stays as it is and History marks it. */}
              {(game.phase !== "setup" || committedReadOnly) && (
                <details className="drawer-advanced" open={correctionOpen}
                  onToggle={(e) => setCorrectionOpen((e.currentTarget as HTMLDetailsElement).open)}>
                  <summary>Correct the recorded role…</summary>
                  {correctionOpen && <>
                    <RolePicker label="Corrected role" roles={rolePool} value={player.actualRole || null}
                      triggerText="Choose the correct role…"
                      onPick={(id) => { setRoleError(null); runRoles([correctRoleIntent(player, id)]); }} />
                    <p className="behavior-help">Use this when the recorded role was wrong. It is not a character change: ability used stays, and History shows a correction.</p>
                  </>}
                </details>
              )}
              {roleError && <p role="alert" className="field-error">{roleError}</p>}
            </section>}

            {/* Phase 10E: Actual Alignment truth through the Alignment seam --
                separate from the player-facing alignment (perception, below).
                A Traveler's lives in their arrival section. Keyed by the
                participation instance so no cue/disclosure state carries over
                to a different occupant of this seat. */}
            {!player.isTraveler && (
              <section className="drawer-section">
                <h4 className="drawer-section-title">Alignment (ST private)</h4>
                <ActualAlignmentControls key={`alignment:${player.participantId ?? player.id}`} player={player} />
              </section>
            )}

            {displayRole && !player.isTraveler && (
              <section className="drawer-section">
                <h4 className="drawer-section-title">
                  Behavior &amp; deception
                </h4>
                <Segmented
                  label="Mode"
                  value={player.behaviorMode}
                  options={BEHAVIOR_MODES.map(({ value, label }) => ({ value, label }))}
                  onChange={(behaviorMode) => {
                    runRoles([setPerceptionIntent(player, {
                      shownRole: player.shownRole, shownAlignment: player.shownAlignment,
                      behaviorMode,
                    })], setPerceptionError);
                  }}
                />
                <p className="behavior-help">
                  {BEHAVIOR_MODES.find((m) => m.value === player.behaviorMode)?.help}
                </p>

                <div className="behavior-row">
                  <span className="label">Shown role:</span>
                  {shownRoleDef ? (
                    <span className={`role-display-label type-${shownRoleDef.type}`}>
                      {shownRoleDef.name}
                    </span>
                  ) : (
                    <span className="behavior-help">Role not revealed yet</span>
                  )}
                </div>
                <RolePicker
                  label="Shown role"
                  roles={ordinaryRoleChoices(script)}
                  value={player.shownRole}
                  triggerText={shownRoleDef ? "Change shown role…" : "Choose shown role…"}
                  filter={shownRoleFilter(player.behaviorMode)}
                  onPick={(id) => {
                    // Re-selecting the identical shown role changes nothing; a
                    // different one derives its alignment unless chosen below.
                    runRoles([setPerceptionIntent(player, {
                      shownRole: id,
                      shownAlignment: id === player.shownRole ? player.shownAlignment : null,
                    })], setPerceptionError);
                  }}
                  onClear={() => runRoles([setPerceptionIntent(player, { shownRole: null, shownAlignment: null })], setPerceptionError)}
                />
                <p className="behavior-help">Choosing a shown role sends that identity when connected. Clearing it returns the player to waiting. Previously delivered information cannot be unseen.</p>

                {/* Phase 10E: player-facing alignment through the perception
                    seam -- Normal (derived from the shown character) by
                    default; explicit overrides progressively disclosed. */}
                <PlayerFacingAlignmentControls key={`perceived:${player.participantId ?? player.id}`} player={player} />
                {perceptionNeedsCheck && (
                  <p role="alert" className="field-error">
                    <strong>Needs check:</strong> the shown character cannot be sent to this player. Choose what they are shown.
                  </p>
                )}
                {perceptionError && <p role="alert" className="field-error">{perceptionError}</p>}
              </section>
            )}
          </InspectorGroup>

          {/* ---------------- 4. Records ---------------- */}
          <InspectorGroup title="Records">
            {/* Phase 10C: Reminders -- non-authoritative notation. Keyed by the
                participation instance so no draft or disclosure state carries
                over to a different occupant of this seat. */}
            <ReminderControls key={`reminders:${player.participantId ?? player.id}`} player={player} />

            {role && applicability?.fakeMinions && (
              <LunaticInfo
                player={player}
                roles={ordinaryChoices}
                roleById={roleById}
                otherPlayers={Object.values(game.players)
                  .filter((p) => p.id !== player.id)
                  .sort((a, b) => a.seat - b.seat)}
                onSetBluffs={(b) => setBluffs(player.id, b)}
                onSetFakeMinions={(ids) => setFakeMinions(player.id, ids)}
              />
            )}

            {role?.type === "demon" && player.behaviorMode === "normal" && (
              <DemonInfo
                player={player}
                roles={ordinaryChoices}
                roleById={roleById}
                inPlayRoles={registry && evilInformationPolicy(Object.values(game.players), registry, game).allowInPlayBluffs ? new Set() : inPlayRoles}
                allowInPlay={!!registry && evilInformationPolicy(Object.values(game.players), registry, game).allowInPlayBluffs}
                onSetBluffs={(b) => setBluffs(player.id, b)}
              />
            )}

            <section className="drawer-section">
              <h4 className="drawer-section-title">ST notes</h4>
              <textarea
                className="textarea"
                aria-label="ST notes"
                value={notesDraft}
                maxLength={MAX_ST_NOTES}
                onChange={(e) => setNotesDraft(e.target.value)}
                onBlur={commitNotes}
                placeholder="Private notes for this seat…"
              />
              <TextLimit length={notesDraft.length} max={MAX_ST_NOTES} />
            </section>
          </InspectorGroup>

          {/* ---------------- 5. Admin ---------------- */}
          <InspectorGroup title="Admin">
            <section className="drawer-section">
              <h4 className="drawer-section-title">Name and seat</h4>
              <input
                className="input drawer-name"
                aria-label="Player name"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value.slice(0, 20))}
                onBlur={commitName}
                maxLength={20}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setNameDraft(player.name);
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
              <div className="drawer-row">
                <button className="btn btn-sm" onClick={() => movePlayer(player.id, "left")}>← move</button>
                <span className="label">seat {player.seat + 1}</span>
                <button className="btn btn-sm" onClick={() => movePlayer(player.id, "right")}>move →</button>
              </div>
            </section>

            <section className="drawer-section">
              <h4 className="drawer-section-title">Travel status</h4>
              {/* SOL-10E-A1: the Setup Traveler designation is actionable only
                  while the game is in Setup and before the initial Reveal. */}
              {game.phase !== "setup" ? (
                <p className="behavior-help">{player.isTraveler ? "Traveler" : "Not a traveler"} — Traveler status is set up only during Setup.</p>
              ) : committedReadOnly ? (
                <p className="behavior-help">Roles are revealed; Traveler status is locked in until this game ends or a new one starts.</p>
              ) : (
                <div className="drawer-row">
                  <button
                    className="toggle-pill"
                    aria-pressed={player.isTraveler}
                    onClick={() => {
                      setTravelerStatusError(null);
                      const result = setIsTraveler(player.id, !player.isTraveler);
                      if (!result.ok) setTravelerStatusError(result.message ?? "Could not change Traveler status.");
                    }}
                  >
                    {player.isTraveler ? "Traveler" : "Not a traveler"}
                  </button>
                  {player.isTraveler && (
                    <span className="behavior-help">
                      Role picker shows travelers only.
                    </span>
                  )}
                </div>
              )}
              {travelerStatusError && <p role="alert" className="field-error">{travelerStatusError}</p>}
            </section>

            <section className="drawer-section">
              <h4 className="drawer-section-title">Danger zone</h4>
              <div className="drawer-row">
                <button className="btn btn-sm btn-danger" onClick={() => setConfirming("remove")} disabled={membershipBusy}>
                  {player.isTraveler ? "Traveler leaves game" : "Remove player"}
                </button>
                <button className="btn btn-sm" onClick={() => setConfirming("unseat")} disabled={membershipBusy}>
                  Unseat player
                </button>
              </div>
              {membershipError && <p className="field-error" role="alert">{membershipError}</p>}
            </section>
          </InspectorGroup>
          </>}
        </div>
      )}
      {/* A TRUE confirmation stays modal (§9). */}
      {confirming && (
        <ConfirmDialog
          title={confirming === "remove" ? `Remove ${player.name}?` : `Unseat ${player.name}?`}
          confirmLabel={confirming === "remove" ? (player.isTraveler ? "Traveler leaves game" : `Remove ${player.name}`) : `Unseat ${player.name}`}
          danger={confirming === "remove"}
          busy={membershipBusy}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void runMembershipAction(confirming === "remove"
            ? () => onRemove ? onRemove(player.id) : void removePlayer(player.id)
            : () => onUnseat ? onUnseat(player.id) : void useStorytellerStore.getState().unseatPlayer(player.id))}
        >
          <p>{confirming === "remove"
            ? `${player.name} leaves the game and their seat is removed.`
            : `${player.name} leaves their seat; the seat stays for someone else.`}</p>
        </ConfirmDialog>
      )}
    </InspectorShell>
  );
}

// ---------------------------------------------------------------------------
// Shared bluff slot picker
// ---------------------------------------------------------------------------

const BLUFF_SLOT_COUNT = 3;

type BluffSlotPickerProps = {
  bluffs: string[];
  rolePool: RoleDef[];
  roleById: Map<string, RoleDef>;
  onSetBluffs: (bluffs: string[]) => void;
  inPlayRoles?: Set<string>;
};

function BluffSlotPicker({
  bluffs,
  rolePool,
  roleById,
  onSetBluffs,
  inPlayRoles,
}: BluffSlotPickerProps) {
  const removeBluff = (idx: number) => {
    onSetBluffs(bluffs.filter((_, i) => i !== idx));
  };

  const addBluff = (id: string) => {
    if (bluffs.includes(id)) return;
    if (bluffs.length >= BLUFF_SLOT_COUNT) return;
    onSetBluffs([...bluffs, id]);
  };

  return (
    <>
      <div className="behavior-row">
        <label>Bluffs:</label>
        <span className="label">
          {bluffs.length} / {BLUFF_SLOT_COUNT}
        </span>
      </div>
      <div className="bluff-slots">
        {Array.from({ length: BLUFF_SLOT_COUNT }).map((_, i) => {
          const id = bluffs[i];
          const def = id ? roleById.get(id) : undefined;
          return (
            <div
              key={i}
              className={`bluff-slot ${def ? "filled" : "empty"}`}
            >
              {def ? (
                <>
                  <span className={`bluff-slot-name type-${def.type}`}>
                    {def.name}
                  </span>
                  <button
                    className="bluff-slot-clear"
                    aria-label={`Remove bluff ${def.name}`}
                    onClick={() => removeBluff(i)}
                  >
                    ×
                  </button>
                </>
              ) : (
                <span className="bluff-slot-empty">empty</span>
              )}
            </div>
          );
        })}
      </div>
      {/* Phase 10H (§7): the searchable role picker, loaded on demand. */}
      <RolePicker
        label="Add bluff"
        roles={rolePool}
        value={null}
        triggerText={bluffs.length >= BLUFF_SLOT_COUNT ? "All bluffs chosen" : "+ Add bluff…"}
        disabled={bluffs.length >= BLUFF_SLOT_COUNT}
        onPick={addBluff}
        filter={(r) => !bluffs.includes(r.id) && !(inPlayRoles?.has(r.id))}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// DemonInfo
// ---------------------------------------------------------------------------

type DemonInfoProps = {
  allowInPlay?: boolean;
  player: STPlayerRecord;
  roles: RoleDef[];
  roleById: Map<string, RoleDef>;
  inPlayRoles: Set<string>;
  onSetBluffs: (bluffs: string[]) => void;
};

function DemonInfo({ player, roles, roleById, inPlayRoles, onSetBluffs, allowInPlay }: DemonInfoProps) {
  const bluffs = player.privateInfo?.bluffs ?? [];
  const goodPool = roles.filter(
    (r) => r.type === "townsfolk" || r.type === "outsider"
  );

  return (
    <section className="drawer-section">
      <h4 className="drawer-section-title">Demon bluffs (ST private)</h4>
      <p className="behavior-help">
        {allowInPlay ? "Pope: choose 3 good characters; in-play good characters may also be bluffs." : "Choose 3 good characters that are not in play."}
      </p>
      <BluffSlotPicker
        bluffs={bluffs}
        rolePool={goodPool}
        roleById={roleById}
        onSetBluffs={onSetBluffs}
        inPlayRoles={inPlayRoles}
      />
      <PlayerInformation playerId={player.id} purpose="setup" />
    </section>
  );
}

// ---------------------------------------------------------------------------
// LunaticInfo
// ---------------------------------------------------------------------------

type LunaticInfoProps = {
  player: STPlayerRecord;
  roles: RoleDef[];
  roleById: Map<string, RoleDef>;
  otherPlayers: STPlayerRecord[];
  onSetBluffs: (bluffs: string[]) => void;
  onSetFakeMinions: (ids: string[]) => void;
};

function LunaticInfo({
  player,
  roles,
  roleById,
  otherPlayers,
  onSetBluffs,
  onSetFakeMinions,
}: LunaticInfoProps) {
  const bluffs = player.privateInfo?.bluffs ?? [];
  const fakeMinions = player.privateInfo?.fakeMinions ?? [];

  const goodPool = roles.filter(
    (r) => r.type === "townsfolk" || r.type === "outsider"
  );

  const toggleMinion = (pid: string) => {
    if (fakeMinions.includes(pid)) {
      onSetFakeMinions(fakeMinions.filter((m) => m !== pid));
    } else {
      onSetFakeMinions([...fakeMinions, pid]);
    }
  };

  const [extraTextDraft, setExtraTextDraft] = useState(player.privateInfo?.extraText ?? "");
  useEffect(() => {
    setExtraTextDraft(player.privateInfo?.extraText ?? "");
  }, [player.id, player.privateInfo?.extraText]);
  const commitExtraText = () => commitExtraTextDraft(player.id, extraTextDraft);

  return (
    <section className="drawer-section">
      <h4 className="drawer-section-title">Demon setup information</h4>
      <p className="behavior-help">
        Choose the bluffs and players they will see as their Minions. Bluffs may be in play.
      </p>

      <BluffSlotPicker
        bluffs={bluffs}
        rolePool={goodPool}
        roleById={roleById}
        onSetBluffs={onSetBluffs}
      />

      <div className="behavior-row">
        <label>Players shown as Minions:</label>
        <span className="label">{fakeMinions.length} chosen</span>
      </div>
      {otherPlayers.length === 0 ? (
        <p className="behavior-help">No other players to choose from.</p>
      ) : (
        <div className="fake-minion-list">
          {otherPlayers.map((p) => (
            <button
              key={p.id}
              className="toggle-pill"
              aria-pressed={fakeMinions.includes(p.id)}
              onClick={() => toggleMinion(p.id)}
            >
              {p.name}{" "}
              <span className="label">seat {p.seat + 1}</span>
            </button>
          ))}
        </div>
      )}
      <details className="information-review">
        <summary>Additional setup information</summary>
        <label className="information-input">Information
          <textarea className="input" rows={2} maxLength={4000} value={extraTextDraft}
            onChange={event => setExtraTextDraft(event.target.value)}
            onBlur={commitExtraText} />
        </label>
      </details>
      <PlayerInformation playerId={player.id} purpose="setup"
        pendingExtraText={{ value: extraTextDraft, commit: commitExtraText }} />
    </section>
  );
}
