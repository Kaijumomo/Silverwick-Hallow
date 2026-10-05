import { useMemo } from "react";
import { useStorytellerStore, selectScriptById } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useShellStore } from "@/stores/shellStore";
import { seatPickable, useTargetPicker } from "@/features/abilities/abilityUi";
import { lifeAccessibleLabel, lifeStatusOf } from "@/stores/lifeState";
import { effectAccessibleSummary, effectIndicatorLabel, effectIndicators } from "@/stores/effectRegistry";
import { effectsNeedingCheck } from "@/stores/effects";
import { identityNeedsCheck } from "@/stores/projections";
import { buildRegistry } from "@/data/roleRegistry";
import { publicTravelerRole } from "@/stores/travelers";
import { LifeStateText } from "@/features/life/LifeMarks";
import { cleanupStatusText, groupText, reminderAccessibleSummary, reminderTokenGroups } from "@/features/reminders/reminderPresentation";
import { abilityUsedMarker, actualAlignmentMarker } from "./tokenMarkers";
import { buildRoleDisplayMap } from "./roleDisplay";
import { litActorIdOf, tapSeat } from "./seatTap";
import type { STPlayerRecord } from "@/stores/types";

/**
 * Phase 10H (contract §§5.3, 6.3; H2, H3; 10H-AC-011/012/017/022/023): the
 * textual readers of the Table.
 *
 *  - Roster: one row per seat, in seat order -- the reliable reader and picker
 *    (the phone's reader; at RS-20 on a phone it REPLACES the Table). A row tap
 *    has exactly the Table's seat-tap semantics and the same eligibility while
 *    a target pick is active.
 *  - Labels: every Effect and Reminder in full -- the detail the dense Table
 *    collapses to counts.
 *
 * Privacy Mode: only public fields (seat, name, Life, a Traveler's public
 * character) are rendered; every private field, the acting marker and the
 * whole Labels view are DOM-absent.
 */
function useTableContext() {
  const game = useStorytellerStore((s) => s.game);
  const script = useStorytellerStore((s) => (game ? selectScriptById(s, game.scriptId) : undefined));
  const privacyMode = usePrivacyStore((s) => s.enabled);
  const litActor = useShellStore((s) => s.litActor);
  const selectedPlayerId = useStorytellerStore((s) => s.selectedPlayerId);
  const picking = useTargetPicker((s) => s.active);
  const roleById = useMemo(() => buildRoleDisplayMap(script), [script]);
  const registry = useMemo(() => (script ? buildRegistry(script) : null), [script]);
  return { game, privacyMode, litActor, selectedPlayerId, picking, roleById, registry };
}

export function RosterView() {
  const { game, privacyMode, litActor, selectedPlayerId, picking, roleById, registry } = useTableContext();
  if (!game) return null;
  const litActorId = litActorIdOf(game, privacyMode, litActor);
  return (
    <section className="roster" aria-label="Roster">
      {picking && (
        <p className="roster-picking" role="status">Choosing {picking.label}: press an eligible row (or a seat on the Table).</p>
      )}
      <ol className="roster-list">
        {game.seatOrder.map((id) => {
          const p = game.players[id];
          if (!p) return null;
          if (p.isEmpty) {
            return (
              <li key={id} className="roster-row roster-row-empty">
                <span className="roster-seat">{p.seat + 1}</span>
                <span className="roster-name roster-dim">Empty seat — fill it on the Table</span>
              </li>
            );
          }
          return (
            <RosterRow key={id} player={p} privacyMode={privacyMode} acting={litActorId === id}
              selected={selectedPlayerId === id} pickable={picking ? seatPickable(game, id, picking) : null}
              roleById={roleById} registry={registry} onTap={() => tapSeat(game, id, litActorId)} />
          );
        })}
      </ol>
    </section>
  );
}

function RosterRow({ player, privacyMode, acting, selected, pickable, roleById, registry, onTap }: {
  player: STPlayerRecord;
  privacyMode: boolean;
  acting: boolean;
  selected: boolean;
  pickable: boolean | null;
  roleById: ReturnType<typeof buildRoleDisplayMap>;
  registry: ReturnType<typeof buildRegistry> | null;
  onTap: () => void;
}) {
  const game = useStorytellerStore((s) => s.game)!;
  const life = lifeStatusOf(player);
  const publicRole = publicTravelerRole(player);
  const shown = player.shownRole ? roleById.get(player.shownRole) : undefined;
  const actual = player.actualRole ? roleById.get(player.actualRole) : undefined;
  const diverges = !!player.shownRole && !!player.actualRole && player.shownRole !== player.actualRole;
  const needsCheck = !privacyMode && (life.anomalies.length > 0 || effectsNeedingCheck(player).length > 0
    || (!!registry && identityNeedsCheck(player, registry)));
  const markers = privacyMode ? [] : [abilityUsedMarker(player), registry ? actualAlignmentMarker(player, registry) : null]
    .filter((m): m is NonNullable<typeof m> => !!m);
  const effects = privacyMode ? "" : effectAccessibleSummary(player);
  const reminders = privacyMode ? "" : reminderAccessibleSummary(player, game);
  const label = lifeAccessibleLabel(player.name, player.seat + 1, life.state, needsCheck)
    + (markers.length ? `, ${markers.map((m) => m.spoken).join(", ")}` : "")
    + (effects ? `, ${effects}` : "") + (reminders ? `, ${reminders}` : "");
  return (
    <li className={`roster-row${selected ? " selected" : ""}${acting ? " acting" : ""}${pickable === false ? " unpickable" : ""}`}>
      <button type="button" className="roster-button" aria-label={label} aria-pressed={selected}
        data-player-id={player.id} onClick={onTap}>
        <span className="roster-seat">{player.seat + 1}</span>
        <span className="roster-main">
          <span className="roster-name">{player.name || "Unnamed player"}</span>
          {privacyMode ? (
            publicRole && <span className="roster-role">Traveler: {publicRole.name}</span>
          ) : (
            <span className="roster-role">
              {shown ? <span className={`roster-shown type-${shown.type}`}>{shown.name}</span> : <span className="roster-dim">No shown role</span>}
              {diverges && <span className="roster-diverge">≠ Actual: {actual?.name ?? player.actualRole}</span>}
              {!player.shownRole && actual && <span className="roster-dim"> · Actual: {actual.name}</span>}
            </span>
          )}
        </span>
        <span className="roster-state">
          <LifeStateText state={life.state} />
          {acting && <span className="roster-acting">Acting now</span>}
          {pickable !== null && <span className="roster-pick">{pickable ? "Eligible" : "Not eligible"}</span>}
          {markers.map((m) => <span key={m.key} className="roster-flag">{m.text}</span>)}
          {needsCheck && <span className="roster-flag roster-check">Needs check</span>}
          {!privacyMode && effectIndicators(player).length > 0 && (
            <span className="roster-effects">{effectIndicators(player).map(effectIndicatorLabel).join(" · ")}</span>
          )}
          {!privacyMode && player.reminders.length > 0 && (
            <span className="roster-reminders">✎ {player.reminders.length}</span>
          )}
        </span>
      </button>
    </li>
  );
}

export function LabelsView() {
  const { game, privacyMode } = useTableContext();
  if (!game) return null;
  if (privacyMode) {
    return (
      <section className="labels-view" aria-label="Labels">
        <p className="behavior-help">Labels are hidden while Privacy Mode is on.</p>
      </section>
    );
  }
  const seats = game.seatOrder.map((id) => game.players[id]).filter((p): p is STPlayerRecord => !!p && !p.isEmpty);
  return (
    <section className="labels-view" aria-label="Labels">
      <ol className="labels-list">
        {seats.map((p) => {
          const effects = effectIndicators(p);
          const groups = reminderTokenGroups(p, game);
          return (
            <li key={p.id} className="labels-seat">
              <h3 className="labels-seat-title">{p.seat + 1} · {p.name || "Unnamed player"}</h3>
              {effects.length === 0 && groups.length === 0 ? <p className="roster-dim">No Effects or Reminders.</p> : (
                <div className="labels-columns">
                  {effects.length > 0 && (
                    <div className="labels-family labels-effects">
                      <span className="labels-family-title">Effects</span>
                      <ul>{effects.map((e) => <li key={e.indicator.key} className={`effect-pill effect-family-${e.indicator.family}`}>{effectIndicatorLabel(e)}</li>)}</ul>
                    </div>
                  )}
                  {groups.length > 0 && (
                    <div className="labels-family labels-reminders">
                      <span className="labels-family-title">Reminders</span>
                      <ul>{groups.map((g) => (
                        <li key={g.label} className={`reminder-pip${g.status === "due" || g.status === "check" ? ` reminder-pip-${g.status}` : ""}`}>
                          <span className="reminder-glyph" aria-hidden="true">✎</span>{groupText(g)}
                          {cleanupStatusText(g.status) && <span className="reminder-pip-status"> · {cleanupStatusText(g.status)}</span>}
                        </li>
                      ))}</ul>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
