import { usePlayersInteraction } from "@/features/players/PlayersInteraction";
import { VotingCard, useVotingInteraction, hasDayExecution } from "@/features/voting/VotingWorkspace";
import { VotingBoardArt } from "@/features/voting/VotingBoardArt";
import { currentVotingState } from "@/stores/voting";
import { useTargetPicker } from "@/features/abilities/abilityUi";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStorytellerStore, selectScriptById } from "@/stores/storytellerStore";
import { pickDensityTier, placeTable, seatCentre, tableStage, tierFits, tierSpec, type DensityTier, type TierSpec } from "./densityTiers";
import { RosterView } from "./RosterView";
import { RitualCircle } from "./RitualCircle";
import { useShellStore } from "@/stores/shellStore";
import { seatPickable } from "@/features/abilities/abilityUi";
import { litActorIdOf, tapSeat as tapSeatShared } from "./seatTap";
import { iconUrlFor } from "@/data/iconUrl";
import type { GrimoireMode, PlayerId, RoleDef, STPlayerRecord } from "@/stores/types";
import { SeatAssignPopup } from "./SeatAssignPopup";
import type { RoomBackend } from "@/firebase/backend";
import { usePrivacyStore } from "@/stores/privacyStore";
import { arrivalsAreTravelers, publicTravelerRole } from "@/stores/travelers";
import { isInitialRevealComplete } from "@/stores/identity";
import { isPostDeal, selectSetupContext } from "@/features/setup/setupContext";
import { initialRevealReadiness } from "@/features/setup/revealReadiness";
import { effectsNeedingCheck } from "@/stores/effects";
import { identityNeedsCheck } from "@/stores/projections";
import { buildRegistry } from "@/data/roleRegistry";
import { effectAccessibleSummary, effectIndicatorLabel, effectIndicators, type EffectIndicatorSummary } from "@/stores/effectRegistry";
import { lifeAccessibleLabel, lifeStatusOf } from "@/stores/lifeState";
import { LifeShroud, LifeStateText, VoteToken } from "@/features/life/LifeMarks";
import { abilityUsedMarker, actualAlignmentMarker } from "./tokenMarkers";
import { OfficialReminderToken } from "@/features/reminders/OfficialReminderToken";
import { officialEffectPresentation } from "@/features/reminders/officialReminderPresentation";
import {
  cleanupStatusText,
  groupText,
  reminderAccessibleSummary,
  reminderTokenGroups,
  tierReminderGroups,
  type ReminderTokenGroup,
} from "@/features/reminders/reminderPresentation";

export { buildRoleDisplayMap } from "./roleDisplay";
import { buildRoleDisplayMap } from "./roleDisplay";

/** Indicators with artwork sit on the token's perimeter (drunk 10 o'clock,
 * poisoned 12, protected 2); every other indicator is a small labelled pill.
 * Phase 10B: one indicator per visual key -- aggregated, never one badge per
 * EffectRecord -- and only for Effects that currently apply. Decorative:
 * the token's own accessible name carries the same information in words. */
function EffectChip({ summary }: { summary: EffectIndicatorSummary }) {
  const { indicator, activeCount } = summary;
  return (
    <span
      className={`status-chip status-chip-${indicator.key}`}
      data-effect-indicator={indicator.key}
      title={effectIndicatorLabel(summary)}
      aria-hidden="true"
    >
      <img src={indicator.icon} alt="" width="100%" height="100%" />
      {activeCount > 1 && <span className="effect-count">×{activeCount}</span>}
    </span>
  );
}

function EffectPill({ summary }: { summary: EffectIndicatorSummary }) {
  const { indicator, activeCount } = summary;
  return (
    <span
      className={`effect-pill effect-family-${indicator.family}`}
      data-effect-indicator={indicator.key}
      title={effectIndicatorLabel(summary)}
      aria-hidden="true"
    >
      {indicator.label}{activeCount > 1 ? ` ×${activeCount}` : ""}
    </span>
  );
}

/**
 * Phase 10C: one aggregated Reminder chip -- the NOTATION visual family,
 * deliberately distinct from Effect indicators by shape and glyph as well as
 * colour: a dashed, notched tag with a leading pen mark, never the Effect
 * artwork or pill. A free-text "Poisoned" Reminder therefore never looks like
 * the authoritative Poisoned Effect. Identical labels aggregate ("Chosen ×2")
 * for display only. A due cleanup cue or a legacy check is shown in WORDS
 * ("· cleanup" / "· check"), never by colour alone.
 *
 * Presentational: the whole token is already one keyboard/touch control that
 * opens the Drawer, where each Reminder instance is a real control. Nesting
 * buttons inside it would be flattened by assistive technology, so the chips
 * are aria-hidden and the token's accessible name carries the same summary
 * in words.
 */
function ReminderChip({ group }: { group: ReminderTokenGroup }) {
  const status = group.status === "due" ? "cleanup" : group.status === "check" ? "check" : null;
  return (
    <span
      className={`reminder-pip ${status ? `reminder-pip-${group.status}` : ""}`}
      data-reminder-label={group.label}
      title={`${groupText(group)}${cleanupStatusText(group.status) ? ` (${cleanupStatusText(group.status)})` : ""}`}
      aria-hidden="true"
    >
      <span className="reminder-glyph">✎</span>{groupText(group)}{status && <span className="reminder-pip-status"> · {status}</span>}
    </span>
  );
}

/** Phase 10H: a text-less seat (S tier) carries its flags in short words; the
 * accessible name/description and the Roster keep the full wording. */
function shortMarker(key: string, player: STPlayerRecord): string {
  if (key === "abilityUsed") return "Used";
  if (key === "alignmentException" || key === "travelerAlignment") return player.actualAlignment === "evil" ? "Evil" : "Good";
  return "•";
}

const DRAG_MIME = "application/x-new-blood-seat";
const TAP_MAX_PX = 6;
const TAP_MAX_MS = 200;

type DragState = {
  id: PlayerId;
  offsetX: number;
  offsetY: number;
  startClientX: number;
  startClientY: number;
  startTime: number;
};

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

type TokenProps = {
  player: STPlayerRecord;
  role: RoleDef | undefined;
  shownRole: RoleDef | undefined;
  online: boolean | undefined;
  /** Phase 10H: the measured density tier and its fixed seat footprint. */
  spec: TierSpec;
  x: number;
  y: number;
  selected: boolean;
  /** Phase 10H (§6.4, V3): the current Night actor -- the lit seat. The caller
   * passes false at Day and under Privacy Mode. */
  acting: boolean;
  /** Phase 10H (§8.3): while a target pick is active, whether this seat is an
   * eligible target (null when no pick is active). */
  pickable: boolean | null;
  mode: GrimoireMode;
  /** Phase 10G: false for an ended game -- no ring drag-to-reorder. */
  reorderable?: boolean;
  draggedId: string | null;
  onRingDragStart: (id: string) => void;
  onRingDragEnd: () => void;
  onRingDropOn: (targetId: string) => void;
  onFreeRoamPointerDown: (e: React.PointerEvent, id: string, x: number, y: number) => void;
  onClick: () => void;
  isGhost?: boolean;
  /** Storyteller-only: this player's initial shown identity still needs
   * configuration before Reveal Roles can complete. Never shown to players;
   * never color-only. */
  needsShownRole?: boolean;
  votingRole?: string;
  votingLabel?: string;
};

function Token({
  player, role, shownRole, online, spec, x, y, selected, acting, pickable,
  mode, reorderable = true, draggedId, onRingDragStart, onRingDragEnd, onRingDropOn,
  onFreeRoamPointerDown, onClick, isGhost = false, needsShownRole = false,
  votingRole, votingLabel,
}: TokenProps) {
  const modern = usePlayersInteraction()?.active;
  const votingOpen = !!useVotingInteraction()?.open;
  const privacyMode = usePrivacyStore((s) => s.enabled);
  const descriptionId = React.useId();
  const arcId = `character-arc-${descriptionId.replace(/:/g, "")}`;
  const publicRole = publicTravelerRole(player);
  // Phase 10H (§6.2, H1): the Shown Role is primary on the Storyteller Table;
  // the Actual Role stays authoritative and is spelled out in the accessible
  // description, the Roster and the Inspector. Presentation only.
  const displayRole = privacyMode ? publicRole : shownRole ?? role;
  const diverges = !privacyMode && !!player.shownRole && !!player.actualRole && player.shownRole !== player.actualRole;
  const hasDeception = !privacyMode && (
    player.behaviorMode !== "normal" ||
    (!!player.shownRole && player.shownRole !== player.actualRole)
  );
  const isDragSource = draggedId === player.id;
  const isDragTarget = draggedId !== null && draggedId !== player.id;
  // Phase 10A: the one derived life state (lifeState.ts). Life, the vote
  // token and exile are public table information, so Privacy Mode never
  // hides them; "Needs check" is Storyteller-only and hidden there.
  const life = lifeStatusOf(player);
  // Phase 10B: Effects are Storyteller-private -- under Privacy Mode no
  // indicator, count, label or "Needs check" is rendered at all (not merely
  // hidden with CSS). A legacy Effect with an unresolved lifetime is a
  // concise Storyteller-only "Needs check".
  const indicators = privacyMode ? [] : effectIndicators(player);
  const officialEffects = modern && !privacyMode ? officialEffectPresentation(player) : null;
  const needsCheckBase = !privacyMode && (life.anomalies.length > 0 || effectsNeedingCheck(player).length > 0);
  const effectSummary = privacyMode ? "" : effectAccessibleSummary(player);
  // Phase 10C: Reminders are Storyteller-private notation -- under Privacy
  // Mode no chip, label, count, overflow, cleanup state or accessible text is
  // rendered at all (DOM absence, not CSS). Game is read here, not threaded,
  // because the derived cleanup status depends on the current moment.
  const game = useStorytellerStore((s) => s.game);
  // Phase 10D: a Shown Role that cannot be projected safely is a
  // Storyteller-private "Needs check" (never shown under Privacy Mode).
  const script = useStorytellerStore((s) => (game ? selectScriptById(s, game.scriptId) : undefined));
  const perceptionCheck = !privacyMode && !!script && identityNeedsCheck(player, buildRegistry(script));
  const reminderGroups = privacyMode || !game ? [] : reminderTokenGroups(player, game);
  // Phase 10H (H2): Reminder labels collapse progressively with density --
  // labels where the footprint permits, a count when dense.
  const { shown: shownReminders, hiddenCount: hiddenReminders } = tierReminderGroups(reminderGroups, spec.reminderLabels);
  const reminderSummary = privacyMode || !game ? "" : reminderAccessibleSummary(player, game);

  const needsCheck = needsCheckBase || perceptionCheck;
  // Phase 10G: Storyteller-private markers -- ability used, and an Actual
  // Alignment exception (or a resolved Traveler's alignment). Never rendered
  // under Privacy Mode.
  const markers = privacyMode ? [] : [abilityUsedMarker(player), script ? actualAlignmentMarker(player, buildRegistry(script)) : null]
    .filter((marker): marker is NonNullable<typeof marker> => !!marker);
  const markerSummary = markers.map((marker) => marker.spoken).join(", ");
  // Phase 10H: the accessible DESCRIPTION carries the role detail (Shown and
  // Actual separately, 10H-AC-022), the acting / pick state -- never under
  // Privacy Mode beyond the public Traveler character.
  const description = [
    privacyMode
      ? (publicRole ? `Traveler: ${publicRole.name}` : "")
      : [shownRole ? `Shown role: ${shownRole.name}` : player.actualRole ? "No shown role yet" : "",
        role ? `Actual role: ${role.name}${diverges ? " (differs from shown)" : ""}` : "Actual role: unassigned"].filter(Boolean).join(". "),
    acting ? "Acting now" : "",
    pickable === true ? "Eligible target" : pickable === false ? "Not an eligible target" : "",
  ].filter(Boolean).join(". ");
  const nonIconEffects = officialEffects?.fallback ?? indicators.filter((summary) => !summary.indicator.icon);
  const flagCount = (diverges ? 1 : 0) + markers.length + (!privacyMode && needsShownRole ? 1 : 0) + (needsCheck ? 1 : 0)
    + (spec.reminderLabels === 0 && nonIconEffects.length > 0 ? 1 : 0) + (spec.text && !player.alive ? 1 : 0);

  const classes = [
    "token",
    !player.alive ? "dead" : "",
    `life-${life.state}`,
    hasDeception ? "deception" : "",
    selected ? "selected" : "",
    acting ? "acting" : "",
    pickable === true ? "pickable" : pickable === false ? "unpickable" : "",
    isDragSource ? "dragging" : "",
    isDragTarget ? "drag-target" : "",
    isGhost ? "ghost" : "",
    mode === "freeRoam" ? "free-roam" : "",
  ].filter(Boolean).join(" ");

  const ringDragHandlers = mode === "ring" && reorderable ? {
    draggable: true as const,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(DRAG_MIME, player.id);
      onRingDragStart(player.id);
    },
    onDragEnd: () => onRingDragEnd(),
    onDragOver: (e: React.DragEvent) => {
      if (draggedId && draggedId !== player.id) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }
    },
    onDrop: (e: React.DragEvent) => {
      const sourceId = e.dataTransfer.getData(DRAG_MIME) || draggedId;
      if (sourceId && sourceId !== player.id) {
        e.preventDefault();
        onRingDropOn(player.id);
      }
    },
  } : {};

  const freeRoamHandlers = mode === "freeRoam" && !isGhost ? {
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      onFreeRoamPointerDown(e, player.id, x, y);
    },
  } : {};

  return (
    <div
      className={classes}
      data-tier={spec.tier}
      data-player-id={player.id}
      data-voting={votingRole}
      data-voting-active={votingOpen || undefined}
      data-team={displayRole?.type}
      style={{ left: `calc(50% + ${x}px)`, top: `calc(50% + ${y}px)`, width: spec.width, height: spec.height }}
      onClick={isGhost ? undefined : onClick}
      role="button"
      aria-label={lifeAccessibleLabel(player.name, player.seat + 1, life.state, needsCheck) + (votingLabel ? `, ${votingLabel}` : "") + (votingRole === "now" ? ", Now voting" : "") + (markerSummary ? `, ${markerSummary}` : "") + (effectSummary ? `, ${effectSummary}` : "") + (reminderSummary ? `, ${reminderSummary}` : "")}
      aria-describedby={description ? descriptionId : undefined}
      aria-pressed={selected}
      tabIndex={isGhost ? -1 : 0}
      onKeyDown={(e) => {
        if (!isGhost && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          if (!e.repeat) onClick();
        }
      }}
      {...ringDragHandlers}
      {...freeRoamHandlers}
    >
      {description && <span id={descriptionId} className="sr-only">{description}</span>}
      <div className="token-disc-frame" style={{ width: spec.disc, height: spec.disc }}>
        {votingLabel && <span className="voting-seat-tag" aria-hidden="true">{votingLabel}</span>}
        <div className="token-disc" style={{ width: spec.disc, height: spec.disc }}>
          {privacyMode && !publicRole ? (
            <span className="token-private-mark" aria-hidden="true">•</span>
          ) : displayRole?.iconUrl !== undefined || displayRole ? (
            <img
              className="token-art"
              src={iconUrlFor(displayRole ?? player.actualRole)}
              alt=""
              loading="lazy"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : null}
          {modern && displayRole && (!privacyMode || publicRole) && spec.text && <svg className="token-character-arc" viewBox="0 0 100 100" aria-hidden="true">
            <defs><path id={arcId} d="M 10,56 A 41,41 0 0 0 90,56" /></defs>
            <text><textPath href={`#${arcId}`} startOffset="50%" textAnchor="middle">{displayRole.name}</textPath></text>
          </svg>}
          {online === false && (
            <span className="token-presence offline" title="Offline" aria-label="Offline" />
          )}
          <LifeShroud state={life.state} />
        </div>
        <VoteToken state={life.state} />
        {spec.tier !== "XS" && !modern && indicators.filter((summary) => summary.indicator.icon).map((summary) => (
          <EffectChip key={summary.indicator.key} summary={summary} />
        ))}
        {spec.tier !== "XS" && !!officialEffects?.tokens.length && <span className="token-official-effects" aria-hidden="true"
          style={{ width: spec.width, left: (spec.disc - spec.width) / 2 }}>
          {officialEffects.tokens.map(token => <OfficialReminderToken key={token.key} role={token.role} label={token.label}
            count={token.instances.length} decorative />)}
        </span>}
        {/* Phase 10H (§6.4): the lit Night actor -- a static treatment plus
            the words "Acting now", distinct from selection and focus. */}
        {acting && <span className="token-acting" aria-hidden="true">{spec.text ? "Acting now" : "Acting"}</span>}
        {/* Phase 10G: overlaid on the disc frame so a marker never makes the
            token taller. Phase 10H: every flag lives in this overlay, so a
            seat's footprint is fixed by its tier (no content can move a seat
            or overprint a neighbour); the Actual≠Shown marker joins them as
            words, never colour alone. */}
        {spec.tier !== "XS" && (flagCount > 0) && (
          <div className="token-markers" style={{ maxWidth: spec.width }} aria-hidden="true">
            {diverges && <span className="token-marker token-marker-divergence" data-divergence="true" title={`Actually ${role?.name ?? "another role"}`}>{spec.text ? "≠ Actual" : "≠"}</span>}
            {markers.map((marker) => <span key={marker.key} className={`token-marker token-marker-${marker.key}`} data-token-marker={marker.key}>{spec.text ? marker.text : shortMarker(marker.key, player)}</span>)}
            {!privacyMode && needsShownRole && <span className="token-marker token-needs-reveal">{spec.text ? "Needs shown role" : "Shown?"}</span>}
            {needsCheck && <span className="token-marker token-needs-check">{spec.text ? "Needs check" : "Check"}</span>}
            {spec.reminderLabels === 0 && nonIconEffects.length > 0 && <span className="token-marker token-marker-effects" data-effect-count={nonIconEffects.length} title={nonIconEffects.map(effectIndicatorLabel).join(", ")}>{`+${nonIconEffects.length} eff.`}</span>}
            {spec.text && !player.alive && <LifeStateText state={life.state} className="token-marker token-ghost" />}
          </div>
        )}
        {/* Count-only Reminders (M2 / S): the notation family's pen mark and a number. */}
        {spec.reminderLabels === 0 && spec.reminderCount && player.reminders.length > 0 && !privacyMode && (
          <span className="token-reminder-count" aria-hidden="true" data-reminder-count={player.reminders.length}>✎{player.reminders.length}</span>
        )}
      </div>
      {votingOpen && !spec.text && <div className="voting-compact-name" title={player.name}><span>{player.seat + 1} {player.name}</span>{!player.alive && <small>{player.ghostVote ? "Vote available" : "Vote used"}</small>}</div>}
      {spec.text && <>
        {privacyMode && !publicRole ? (
          <div className="token-role token-role-private">role hidden</div>
        ) : displayRole ? (
          <div className={`token-role type-${displayRole.type}${modern ? " sr-only" : ""}`}>{displayRole.name}</div>
        ) : (
          <div className="token-role unassigned">unassigned</div>
        )}
        <div className="token-name" title={player.name}>{modern && <span className="token-seat-label" aria-hidden="true">{player.seat + 1}</span>}<span>{player.name}</span></div>
        {spec.reminderLabels > 0 && nonIconEffects.length > 0 && (
          <div className="token-effects">
            {nonIconEffects.slice(0, spec.reminderLabels).map((summary) => (
              <EffectPill key={summary.indicator.key} summary={summary} />
            ))}
            {nonIconEffects.length > spec.reminderLabels && (
              <span className="effect-pill effect-overflow" aria-hidden="true">+{nonIconEffects.length - spec.reminderLabels}</span>
            )}
          </div>
        )}
        {spec.reminderLabels > 0 && (shownReminders.length > 0 || hiddenReminders > 0) && (
          <div className="token-reminders" data-reminder-count={player.reminders.length}>
            {shownReminders.map((group) => <ReminderChip key={group.label} group={group} />)}
            {hiddenReminders > 0 && (
              <span className="reminder-pip reminder-overflow" aria-hidden="true" title={`${hiddenReminders} more reminder${hiddenReminders === 1 ? "" : "s"}`}>
                +{hiddenReminders} more
              </span>
            )}
          </div>
        )}
      </>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GrimoireCircle
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// EmptySeat token
// ---------------------------------------------------------------------------

type EmptySeatProps = {
  seatNumber: number;
  spec: TierSpec;
  x: number;
  y: number;
  onClick: () => void;
};

function EmptySeat({ seatNumber, spec, x, y, onClick }: EmptySeatProps) {
  return (
    <button
      type="button"
      className="token empty-seat"
      data-tier={spec.tier}
      style={{ left: `calc(50% + ${x}px)`, top: `calc(50% + ${y}px)`, width: spec.width, height: spec.height }}
      onClick={onClick}
      aria-label={`Empty seat ${seatNumber}. Tap to fill this planned seat.`}
      title={`Seat ${seatNumber} — click to assign a player`}
    >
      <div className="token-disc-frame" style={{ width: spec.disc, height: spec.disc }}>
        <div className="token-disc empty-seat-disc">
          <span className="empty-seat-icon">+</span>
        </div>
      </div>
      {spec.text && <>
        <div className="token-role empty-seat-label">Empty seat</div>
        <div className="token-name empty-seat-num">Seat {seatNumber}</div>
      </>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// GrimoireCircle
// ---------------------------------------------------------------------------

type Props = {
  online?: Record<string, boolean>;
  backend?: RoomBackend | null;
  code?: string;
};

export function GrimoireCircle({ online, backend = null, code = "" }: Props = {}) {
  const voting = useVotingInteraction();
  const playersInteraction = usePlayersInteraction();
  const game = useStorytellerStore((s) => s.game);
  const script = useStorytellerStore((s) =>
    game ? selectScriptById(s, game.scriptId) : undefined
  );
  const selectedPlayerId = useStorytellerStore((s) => s.selectedPlayerId);
  const picking = useTargetPicker((s) => s.active);
  const privacyMode = usePrivacyStore((s) => s.enabled);
  const litActor = useShellStore((s) => s.litActor);
  const addPlayerToSeat = useStorytellerStore((s) => s.addPlayerToSeat);
  const addEmptySeat = useStorytellerStore((s) => s.addEmptySeat);
  const removePlayer = useStorytellerStore((s) => s.removePlayer);
  const setSeatOrder = useStorytellerStore((s) => s.setSeatOrder);
  const grimoireMode = useStorytellerStore((s) => s.grimoireMode);
  const tokenPositions = useStorytellerStore((s) => s.tokenPositions);
  const setGrimoireMode = useStorytellerStore((s) => s.setGrimoireMode);
  const setTokenPosition = useStorytellerStore((s) => s.setTokenPosition);
  const clearTokenPositions = useStorytellerStore((s) => s.clearTokenPositions);

  const canvasRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // Track width + height separately so free-roam uses the full rectangle.
  const [canvasW, setCanvasW] = useState(680);
  const [canvasH, setCanvasH] = useState(680);
  const [ringDraggedId, setRingDraggedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [assigningSeatId, setAssigningSeatId] = useState<PlayerId | null>(null);

  // Phase 10H (10H-AC-024): while Privacy Mode is on the Table keeps the
  // geometry it had when Privacy Mode began -- a private surface closing (the
  // action card's column, the Inspector) must not move a seat and so reveal
  // that it was open. The latest measured size applies once Privacy Mode ends.
  const pendingSize = useRef<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!stageRef.current) return;
    const el = stageRef.current;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      if (usePrivacyStore.getState().enabled) {
        pendingSize.current = { w: entry.contentRect.width, h: entry.contentRect.height };
        return;
      }
      setCanvasW(entry.contentRect.width);
      setCanvasH(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (privacyMode || !pendingSize.current) return;
    setCanvasW(pendingSize.current.w);
    setCanvasH(pendingSize.current.h);
    pendingSize.current = null;
  }, [privacyMode]);

  const roleById = useMemo(() => buildRoleDisplayMap(script), [script]);

  if (!game || !script) return null;

  // Storyteller-only: while dealt-but-not-yet-revealed, mark exactly the
  // ordinary players whose shown identity still needs configuration before
  // Reveal Roles can complete. Never gates on color alone (see token-needs-
  // reveal below); disappears immediately once revealed or once that
  // player's own identity becomes ready.
  const pendingRevealIds = game.phase === "setup" && isPostDeal(game) && !isInitialRevealComplete(game)
    ? new Set(initialRevealReadiness(selectSetupContext(game, script)).pendingIds)
    : new Set<PlayerId>();

  // Phase 10G (Section 18): an ended game's Grimoire is a read-only review --
  // no seat reorder, seat assignment or seat creation is mounted. (Layout mode
  // and free-roam positions are local-only and never touch the game.)
  const readOnly = game.phase === "ended";
  const litActorId = litActorIdOf(game, privacyMode, litActor);
  const tapSeat = (id: PlayerId) => {
    if (voting?.tap(id)) return;
    const layout = playersInteraction?.swapping
      ? { game, positions: Object.fromEntries(game.seatOrder.map((seatId, index) => [seatId, getPos(seatId, index)])) }
      : undefined;
    if (!playersInteraction?.tap(id, layout)) tapSeatShared(game, id, litActorId);
  };
  const playerCount = game.seatOrder.length;
  // Phase 10H (§§5.1, 6.1; 10H-AC-009/010): the Table is an oval fitted to the
  // MEASURED stage rectangle (ResizeObserver state, never a layout read during
  // render) -- dominant on a wide desktop, a circle on a square stage -- with
  // the largest collision-free density tier. Every seat shares the tier's
  // fixed footprint, so content (and Privacy Mode) can never move a seat.
  const table = tableStage(canvasW, canvasH);
  const tier: DensityTier = pickDensityTier(grimoireMode === "freeRoam" ? { width: canvasW, height: canvasH } : table, playerCount);
  const spec = tierSpec(tier);
  const placement = placeTable(table, playerCount, spec);
  // Phase 10H (H3; 10H-AC-012): when even the last-resort disc cannot be
  // placed without overprint in the measured stage, the Roster REPLACES the
  // Table (the stage stays mounted and measured, so the Table returns as soon
  // as there is room).
  const tableFits = grimoireMode === "freeRoam" || tier !== "XS" || tierFits(table, playerCount, spec);
  /** A seat's box centre (the token is centred on its own footprint). */
  const seatBoxCentre = (seatIndex: number) => {
    const centre = seatCentre(seatIndex, playerCount, placement);
    return { x: centre.x, y: centre.y - spec.disc / 2 + spec.height / 2 };
  };

  // Rectangular clamp — each axis bounded independently by the full canvas.
  const maxX = Math.max(0, (canvasW - spec.width) / 2 - 16);
  const maxY = Math.max(0, (canvasH - spec.height) / 2 - 16);
  const clampX = (v: number) => Math.max(-maxX, Math.min(maxX, v));
  const clampY = (v: number) => Math.max(-maxY, Math.min(maxY, v));

  const getPos = (id: PlayerId, seatIndex: number) => {
    const point = seatBoxCentre(seatIndex);
    if (grimoireMode === "freeRoam") {
      const saved = tokenPositions[id] ?? point;
      return { x: clampX(saved.x), y: clampY(saved.y) };
    }
    return point;
  };

  const switchToFreeRoam = () => {
    game.seatOrder.forEach((id, i) => {
      if (!tokenPositions[id]) {
        const pos = seatBoxCentre(i);
        setTokenPosition(id, pos.x, pos.y);
      }
    });
    setGrimoireMode("freeRoam");
  };

  const handleAdd = () => {
    if (arrivalsAreTravelers(game) && code) { handleAddTraveler(); return; }
    const name = window.prompt(arrivalsAreTravelers(game) ? "Traveler name?" : "Player name?");
    if (name?.trim()) {
      const id = game.seatOrder.find(id => game.players[id]?.isEmpty);
      const seatCountBefore = game.seatOrder.length;
      addPlayerToSeat(name);
      const store = useStorytellerStore.getState();
      // FINAL POPULATION CLOSURE, Section 2: the command refuses atomically
      // at capacity -- never select/open an unrelated existing seat when no
      // seat was actually created (falling back to seatOrder.at(-1) here
      // would otherwise silently point at someone else's seat).
      const created = !id && (store.game?.seatOrder.length ?? 0) > seatCountBefore;
      const addedId = id ?? (created ? store.game?.seatOrder.at(-1) : undefined);
      if (addedId && store.game?.players[addedId]?.isTraveler) store.selectPlayer(addedId);
    }
  };
  const handleAddSeat = () => addEmptySeat();
  const handleAddTraveler = () => {
    const store = useStorytellerStore.getState();
    if (code) {
      // Section 3.E: add planned Traveler capacity and an ordinary-neutral
      // empty seat carrying only the plannedTravelerSeat reservation marker
      // -- never pre-flag the empty seat itself isTraveler. Actual
      // designation happens through arrivalPlayer() the moment a real
      // player occupies it, fulfilling this exact planned slot atomically.
      const seatCountBefore = game.seatOrder.length;
      store.addTravelerSeat();
      const next = useStorytellerStore.getState().game;
      // FINAL POPULATION CLOSURE, Section 2: refused atomically at capacity
      // -- never open the assignment popup for an unrelated existing seat.
      if ((next?.seatOrder.length ?? 0) <= seatCountBefore) return;
      const id = next?.seatOrder.at(-1);
      if (id) setAssigningSeatId(id);
      return;
    }
    const name = window.prompt("Traveler name?");
    if (!name?.trim()) return;
    const seatCountBefore = game.seatOrder.length;
    store.addPlayer(name);
    const next = useStorytellerStore.getState().game;
    if ((next?.seatOrder.length ?? 0) <= seatCountBefore) return;
    const id = next?.seatOrder.at(-1);
    if (id) { store.setIsTraveler(id, true); store.selectPlayer(id); }
  };

  // ── Free-roam pointer drag ────────────────────────────────────────────────

  const handleTokenPointerDown = useCallback(
    (e: React.PointerEvent, id: PlayerId, tokenX: number, tokenY: number) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      e.preventDefault();
      canvasRef.current?.setPointerCapture(e.pointerId);
      const rect = canvasRef.current!.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      setDrag({
        id,
        offsetX: e.clientX - cx - tokenX,
        offsetY: e.clientY - cy - tokenY,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startTime: Date.now(),
      });
      setGhostPos({ x: tokenX, y: tokenY });
    },
    []
  );

  const handleCanvasPointerMove = (e: React.PointerEvent) => {
    if (!drag || grimoireMode !== "freeRoam") return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    setGhostPos({
      x: clampX(e.clientX - cx - drag.offsetX),
      y: clampY(e.clientY - cy - drag.offsetY),
    });
  };

  const handleCanvasPointerUp = (e: React.PointerEvent) => {
    if (!drag || grimoireMode !== "freeRoam") return;
    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const elapsed = Date.now() - drag.startTime;
    if (dist < TAP_MAX_PX && elapsed < TAP_MAX_MS) {
      // Phase 10F: a tap may be a guided-ability target pick; a drag never is.
      tapSeat(drag.id);
    } else if (ghostPos) {
      setTokenPosition(drag.id, ghostPos.x, ghostPos.y);
    }
    setDrag(null);
    setGhostPos(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const modeControls = (
    <div className="grimoire-mode-controls">
      {picking && (
        <div className="grimoire-picking" role="status">
          {picking.label} · Tap a player
          <button className="grimoire-mode-btn" onClick={() => useTargetPicker.getState().cancel()}>Cancel</button>
        </div>
      )}
      {!readOnly && !playersInteraction?.active && <>
        {/* Phase 10H (10H-AC-068): Add player lives in the toolbar row -- never
            a floating control over the seats or the phone action zone. */}
        {playerCount > 0 && !arrivalsAreTravelers(game) && (
          <button className="grimoire-mode-btn grimoire-add-btn" onClick={handleAdd} aria-label="Add player">+ Player</button>
        )}
        <button className="grimoire-mode-btn" onClick={handleAddSeat} aria-label={arrivalsAreTravelers(game) ? "Add empty Traveler seat" : "Add empty planned seat"}>
          + New {arrivalsAreTravelers(game) ? "Traveler seat" : "seat"}
        </button>
        <button className="grimoire-mode-btn" onClick={handleAddTraveler}>Add Traveler</button>
      </>}
      {grimoireMode === "ring" ? (
        <button className="grimoire-mode-btn" onClick={switchToFreeRoam} title="Switch to free-roam layout">
          ⊞ Free Roam
        </button>
      ) : (
        <>
          <button
            className="grimoire-mode-btn"
            onClick={() => setGrimoireMode("ring")}
            title="Switch back to ring layout"
          >
            ⊙ Ring
          </button>
          {!playersInteraction?.active && <button
            className="grimoire-mode-btn grimoire-snap-btn"
            onClick={() => { clearTokenPositions(); setGrimoireMode("ring"); }}
            title="Reset all token positions to ring"
          >
            ↺ Snap to ring
          </button>}
        </>
      )}
    </div>
  );

  return (
    <div className="grimoire-wrap">
      <div className="grimoire-stage" ref={stageRef} data-table-fits={tableFits}>
      {!tableFits ? (
        <div className="table-replaced">
          <p className="table-replaced-note" role="status">Too many seats to draw the Table here — the Roster replaces it.</p>
          <VotingCard inline />
          <RosterView />
        </div>
      ) : (
      <div
        className="grimoire"
        data-mode={grimoireMode}
        data-tier={tier}
        style={grimoireMode === "ring" ? { width: table.width, height: table.height } : undefined}
        ref={canvasRef}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerCancel={() => { setDrag(null); setGhostPos(null); }}
      >
        {grimoireMode === "ring" && (
          <>
            <div className="grimoire-ring outer" />
            <div className="grimoire-ring inner" />
          </>
        )}
        {playersInteraction?.active && playerCount > 0 && <RitualCircle
          diameter={Math.max(0, Math.min(placement.rx, placement.ry) * 1.3)}
          offsetY={placement.cy}
        />}
        {playersInteraction?.active && playerCount > 0 && !voting?.open && <div className="grimoire-watermark" aria-hidden="true" style={{ marginTop: placement.cy }}>
          <span>{game.phase === "setup" ? "Setup" : `${game.phase} ${game.day}`}</span>
          <strong>Silverwick Hollow</strong>
          <em>{game.phase === "night" ? "The town sleeps" : game.phase === "day" ? "The town awakens" : game.phase === "ended" ? "The story is complete" : "Prepare your town"}</em>
        </div>}

        {voting?.open && <>
          <VotingBoardArt positions={Object.fromEntries(game.seatOrder.map((id, index) => { const pos = getPos(id, index); return [id, { x: pos.x, y: pos.y - spec.height / 2 + spec.disc / 2 }]; }))} width={table.width} height={table.height} rx={placement.rx} ry={placement.ry} cy={placement.cy} disc={spec.disc} />
          <VotingCard width={Math.min(560, Math.max(380, (placement.rx - spec.disc / 2 - 30) * 2), table.width - 40)} offsetY={placement.cy} />
        </>}
        {playerCount === 0 ? (
          <div className="grimoire-empty">
            <p>{readOnly ? "No players." : "Add players to begin."}</p>
            {!readOnly && <button className="btn btn-gold" onClick={handleAdd}>+ Add {arrivalsAreTravelers(game) ? "Traveler" : "player"}</button>}
          </div>
        ) : (
          game.seatOrder.map((id, i) => {
            const p = game.players[id];
            if (!p) return null;
            const pos = getPos(id, i);
            const isDragging = drag?.id === id;
            const nominator = voting?.open ? voting.round?.nominator ?? voting.draft?.nominator : null;
            const nominee = voting?.open ? voting.round?.nominee ?? voting.draft?.nominee : null;
            const block = !privacyMode && game.phase === "day" && !hasDayExecution(game) ? currentVotingState(game).block : null;
            const isBlock = !!p.participantId && block?.nominee?.participantId === p.participantId;
            const isNominee = !!p.participantId && nominee?.participantId === p.participantId;
            const isNominator = !!p.participantId && nominator?.participantId === p.participantId;
            const voteRole = !!p.participantId && voting?.open && voting.voter?.participantId === p.participantId ? "now" : isNominee ? "nominee" : isNominator ? "nominator" : isBlock ? "block" : undefined;
            const voteLabel = isBlock ? `On the block · ${block!.tally}` : isNominee ? (p.isTraveler ? "Exile" : "On trial") : isNominator ? "Nominator" : undefined;

            if (p.isEmpty) {
              return (
                <EmptySeat
                  key={id}
                  seatNumber={p.seat + 1}
                  spec={spec}
                  x={pos.x}
                  y={pos.y}
                  onClick={() => { if (!readOnly) setAssigningSeatId(id); }}
                />
              );
            }

            return (
              <Token
                key={id}
                player={p}
                votingRole={voteRole}
                votingLabel={voteLabel}
                role={p.actualRole ? roleById.get(p.actualRole) : undefined}
                shownRole={p.shownRole ? roleById.get(p.shownRole) : undefined}
                needsShownRole={pendingRevealIds.has(id)}
                online={online?.[id]}
                spec={spec}
                x={isDragging && ghostPos ? ghostPos.x : pos.x}
                y={isDragging && ghostPos ? ghostPos.y : pos.y}
                selected={selectedPlayerId === id || playersInteraction?.swappingPlayerId === id}
                acting={litActorId === id}
                pickable={picking ? seatPickable(game, id, picking) : null}
                mode={grimoireMode}
                reorderable={!readOnly && !playersInteraction?.swapping && !voting?.open}
                draggedId={ringDraggedId}
                onRingDragStart={(srcId) => setRingDraggedId(srcId)}
                onRingDragEnd={() => setRingDraggedId(null)}
                onRingDropOn={(targetId) => {
                  const src = ringDraggedId;
                  setRingDraggedId(null);
                  if (!src || src === targetId) return;
                  const order = [...game.seatOrder];
                  const si = order.indexOf(src);
                  const ti = order.indexOf(targetId);
                  if (si < 0 || ti < 0) return;
                  order.splice(si, 1);
                  const insertAt = order.indexOf(targetId);
                  if (insertAt < 0) return;
                  order.splice(insertAt, 0, src);
                  setSeatOrder(order);
                }}
                onFreeRoamPointerDown={playersInteraction?.swapping || voting?.open ? () => {} : handleTokenPointerDown}
                onClick={() => tapSeat(id)}
              />
            );
          })
        )}

      </div>
      )}
      </div>

      {/* Mode controls live outside the grimoire canvas so they never overlap tokens */}
      {modeControls}

      {assigningSeatId && !readOnly && (() => {
        const seat = game.players[assigningSeatId];
        if (!seat) return null;
        return (
          <SeatAssignPopup
            seatPlayerId={assigningSeatId}
            seatNumber={seat.seat + 1}
            backend={backend}
            code={code}
            onClose={() => setAssigningSeatId(null)}
            onRemoveSeat={() => {
              removePlayer(assigningSeatId);
              setAssigningSeatId(null);
            }}
          />
        );
      })()}
    </div>
  );
}
