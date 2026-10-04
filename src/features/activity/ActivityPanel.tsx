import { useMemo, useState } from "react";
import { Modal } from "@/components/Modal";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { usePrivateDialog } from "@/features/life/usePrivateDialog";
import type { RoleRegistry } from "@/data/roleRegistry";
import type { StorytellerLobbyRecord } from "@/stores/types";
import {
  ACTIVITY_CATEGORIES,
  activityMoments,
  activityParticipants,
  buildActivity,
  describeDelivery,
  describeHistoryRecord,
  type ActivityCategory,
  type ActivityFilter,
  type ActivityItem,
} from "./activity";

/**
 * Phase 10G: the Storyteller-private Activity surface (PHASE10G Section 13) --
 * "Changes" (History) and "Information told" (Information Delivery) in one
 * place, grouped honestly by Game Moment and resolution. Presentation only:
 * History is read-only; a delivery RECORD may be removed (Section 13.4) --
 * with copy that removing it cannot unsay what was communicated. `readOnly`
 * (an ended game's review) mounts no removal control at all. Closes itself
 * under Privacy Mode and never reappears on its own (usePrivateDialog).
 */
export function ActivityPanel({ game, registry, readOnly = false, onClose }: {
  game: StorytellerLobbyRecord;
  registry: RoleRegistry;
  readOnly?: boolean;
  onClose: () => void;
}) {
  const suppressed = usePrivateDialog(onClose);
  const [filter, setFilter] = useState<ActivityFilter>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const participants = useMemo(() => activityParticipants(game), [game]);
  const moments = useMemo(() => activityMoments(game), [game]);
  const groups = useMemo(() => buildActivity(game, filter), [game, filter]);
  if (suppressed) return null;
  const empty = game.history.length === 0 && game.informationDeliveries.length === 0;
  const set = (patch: ActivityFilter) => setFilter((prev) => {
    const next = { ...prev, ...patch };
    for (const key of Object.keys(next) as (keyof ActivityFilter)[]) if (!next[key]) delete next[key];
    return next;
  });

  const historyRow = (item: Extract<ActivityItem, { source: "history" }>) => (
    <li key={`h${item.index}`} className="activity-row" data-activity-source="history" data-category={item.record.category}>
      {describeHistoryRecord(item.record, registry)}
    </li>
  );
  const deliveryRow = (item: Extract<ActivityItem, { source: "delivery" }>) => {
    const id = item.record.id;
    return (
      <li key={`d${item.index}`} className="activity-row" data-activity-source="delivery" data-delivery-kind={item.record.kind ?? "structured"}>
        <span>{describeDelivery(item.record, registry)}</span>
        {!readOnly && (confirming === id ? (
          <span className="activity-remove-confirm" role="group" aria-label="Remove this record">
            <span className="behavior-help">Removing the stored record does not undo or unsay what was already communicated.</span>
            <button className="btn btn-sm btn-danger" onClick={() => { useStorytellerStore.getState().removeInformationDelivery(id); setConfirming(null); }}>
              Remove record
            </button>
            <button className="btn btn-sm" onClick={() => setConfirming(null)}>Keep</button>
          </span>
        ) : (
          <button className="btn btn-sm" onClick={() => setConfirming(id)} aria-label={`Remove the record: ${describeDelivery(item.record, registry)}`}>
            Remove record…
          </button>
        ))}
      </li>
    );
  };
  const rows = (items: ActivityItem[]) => items.map((item) => (item.source === "history" ? historyRow(item) : deliveryRow(item)));

  return (
    <Modal title={readOnly ? "Activity (final)" : "Activity"} onClose={onClose} className="activity-panel">
      <div className="dialog-body activity-body">
        <div className="activity-filters" role="group" aria-label="Filter activity">
          <label className="activity-filter">
            <span className="label">Participant</span>
            <select aria-label="Filter by participant" value={filter.participant ?? ""} onChange={(e) => set({ participant: e.target.value })}>
              <option value="">Everyone</option>
              {participants.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </label>
          <label className="activity-filter">
            <span className="label">Kind</span>
            <select aria-label="Filter by kind" value={filter.category ?? ""} onChange={(e) => set({ category: e.target.value as ActivityCategory })}>
              <option value="">Everything</option>
              {ACTIVITY_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
          <label className="activity-filter">
            <span className="label">When</span>
            <select aria-label="Filter by moment" value={filter.moment ?? ""} onChange={(e) => set({ moment: e.target.value })}>
              <option value="">Whole game</option>
              {moments.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </label>
        </div>
        {empty ? <p className="behavior-help">Nothing has been recorded yet.</p>
          : groups.length === 0 ? <p className="behavior-help">Nothing matches this filter.</p>
            : groups.map((group) => (
              <section key={group.key} className="drawer-section activity-group" aria-label={group.label}>
                <h3 className="drawer-section-title">{group.label}</h3>
                {group.resolutions.map((resolution) => (
                  <div key={resolution.resolutionId} className="activity-resolution" data-resolution-id={resolution.resolutionId}>
                    <span className="label">One resolution</span>
                    <ul className="activity-list">{rows(resolution.changes)}{rows(resolution.told)}</ul>
                  </div>
                ))}
                {group.changes.length > 0 && (
                  <div className="activity-source">
                    <span className="label">Changes</span>
                    <ul className="activity-list">{rows(group.changes)}</ul>
                  </div>
                )}
                {group.told.length > 0 && (
                  <div className="activity-source">
                    <span className="label">Information told</span>
                    <ul className="activity-list">{rows(group.told)}</ul>
                  </div>
                )}
                {group.changes.length > 0 && group.told.length > 0 && (
                  <p className="behavior-help">The order between these changes and the information told is not recorded.</p>
                )}
              </section>
            ))}
      </div>
    </Modal>
  );
}
