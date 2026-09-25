import { useState } from "react";
import { Modal } from "@/components/Modal";
import { useStorytellerStore, type RepairTarget } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { currentLiveMoment, momentLabel, previousLiveMoment, sameMoment } from "@/stores/lifeEvents";
import type { LifeEventSpec } from "@/stores/lifeResolution";
import type { LifeState } from "@/stores/lifeState";
import type { LifeEvent, LiveGameMoment, StorytellerLobbyRecord, STPlayerRecord } from "@/stores/types";
import { useLifeRunner } from "./LifeControls";
import {
  currentSubjectOf,
  describeLifeEvent,
  eventStateNote,
  statusChoicesFor,
  statusTargetOf,
  suggestedStatusAfterRetract,
  suggestedStatusForEvent,
  type StatusChoice,
} from "./lifeEventText";

type Kind = LifeEvent["kind"];
const KIND_LABEL: Record<Kind, string> = { death: "Death", execution: "Execution", exile: "Exile", resurrection: "Resurrection" };
const OUTCOMES: Record<"execution" | "exile", { value: string; label: string }[]> = {
  execution: [{ value: "died", label: "Died" }, { value: "survived", label: "Survived" }, { value: "alreadyDead", label: "Already dead" }],
  exile: [{ value: "died", label: "Died" }, { value: "survived", label: "Survived" }],
};

const seated = (game: StorytellerLobbyRecord) =>
  game.seatOrder.map((id) => game.players[id]).filter((p): p is STPlayerRecord => !!p && !p.isEmpty && !!p.participantId);

function specOf(kind: Kind, outcome: string, playerId?: string): LifeEventSpec {
  const who = playerId ? { playerId } : {};
  if (kind === "execution") return { kind, outcome: outcome as "died" | "survived" | "alreadyDead", ...who };
  if (kind === "exile") return { kind, outcome: outcome as "died" | "survived", ...who };
  return { kind, ...who };
}

const repairOf = (player: STPlayerRecord | undefined, choice: StatusChoice): RepairTarget[] =>
  player && choice !== "keep" ? [{ playerId: player.id, target: statusTargetOf(choice as LifeState) }] : [];

function StatusRepair({ id, label, player, value, onChange }: {
  id: string; label: string; player: STPlayerRecord | undefined; value: StatusChoice; onChange: (v: StatusChoice) => void;
}) {
  if (!player) return <p className="behavior-help">{label}: no longer seated -- status cannot be changed here.</p>;
  return (
    <div className="drawer-row">
      <label className="label" htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as StatusChoice)}>
        {statusChoicesFor(player).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

/** Kind/outcome pickers shared by amend and late record. */
function EventSpecFields({ idPrefix, moment, kind, outcome, onKind, onOutcome }: {
  idPrefix: string; moment: LiveGameMoment; kind: Kind; outcome: string;
  onKind: (k: Kind) => void; onOutcome: (o: string) => void;
}) {
  const kinds: Kind[] = moment.phase === "day" ? ["death", "execution", "exile", "resurrection"] : ["death", "resurrection"];
  return (
    <div className="drawer-row">
      <label className="label" htmlFor={`${idPrefix}-kind`}>Event</label>
      <select id={`${idPrefix}-kind`} value={kind} onChange={(e) => {
        const next = e.target.value as Kind;
        onKind(next);
        if (next === "execution" || next === "exile") onOutcome("died");
      }}>
        {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
      </select>
      {(kind === "execution" || kind === "exile") && <>
        <label className="label" htmlFor={`${idPrefix}-outcome`}>Outcome</label>
        <select id={`${idPrefix}-outcome`} value={outcome} onChange={(e) => onOutcome(e.target.value)}>
          {OUTCOMES[kind].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </>}
    </div>
  );
}

function RetractForm({ game, event, onDone }: { game: StorytellerLobbyRecord; event: LifeEvent; onDone: () => void }) {
  const { attempt, errorNode } = useLifeRunner();
  const subject = currentSubjectOf(game, event);
  const [repair, setRepair] = useState<StatusChoice>(() => suggestedStatusAfterRetract(game, event));
  return (
    <div className="life-correction-form">
      <p className="behavior-help">Retracting removes the event. Status changes only if you choose one here.</p>
      <StatusRepair id={`retract-${event.id}`} label="Also set status" player={subject} value={repair} onChange={setRepair} />
      <button className="btn btn-sm btn-danger" onClick={() => {
        if (attempt(() => useStorytellerStore.getState().retractLifeEvent(event.id, repairOf(subject, repair)))) onDone();
      }}>Retract event</button>
      {errorNode}
    </div>
  );
}

function AmendForm({ game, event, onDone }: { game: StorytellerLobbyRecord; event: LifeEvent; onDone: () => void }) {
  const { attempt, errorNode } = useLifeRunner();
  const original = currentSubjectOf(game, event);
  const [kind, setKind] = useState<Kind>(event.kind);
  const [outcome, setOutcome] = useState<string>("outcome" in event ? event.outcome : "died");
  const [who, setWho] = useState<string>(""); // "" keeps the original subject
  const replacementPlayer = who ? game.players[who] : original;
  const [newRepair, setNewRepair] = useState<StatusChoice>("keep");
  const [oldRepair, setOldRepair] = useState<StatusChoice>("keep");
  const changedSubject = !!who && who !== original?.id;
  const players = seated(game);
  return (
    <div className="life-correction-form">
      <p className="behavior-help">Amending retracts this event and records a corrected one (a new event, same {momentLabel(event.moment)}).</p>
      <EventSpecFields idPrefix={`amend-${event.id}`} moment={event.moment} kind={kind} outcome={outcome}
        onKind={(k) => { setKind(k); setNewRepair(suggestedStatusForEvent(replacementPlayer, k, outcome)); }}
        onOutcome={(o) => { setOutcome(o); setNewRepair(suggestedStatusForEvent(replacementPlayer, kind, o)); }} />
      <div className="drawer-row">
        <label className="label" htmlFor={`amend-${event.id}-who`}>Player</label>
        <select id={`amend-${event.id}-who`} value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">{event.subject.nameAtTime || "Same player"} (same player)</option>
          {players.filter((p) => p.participantId !== event.subject.participantId)
            .map((p) => <option key={p.id} value={p.id}>{p.name} (seat {p.seat + 1})</option>)}
        </select>
      </div>
      <StatusRepair id={`amend-${event.id}-status`} label={changedSubject ? "New player's status" : "Also set status"}
        player={replacementPlayer} value={newRepair} onChange={setNewRepair} />
      {changedSubject && (
        <StatusRepair id={`amend-${event.id}-old-status`} label={`${event.subject.nameAtTime}'s status`}
          player={original} value={oldRepair} onChange={setOldRepair} />
      )}
      <button className="btn btn-sm btn-gold" onClick={() => {
        const repair = [...repairOf(replacementPlayer, newRepair), ...(changedSubject ? repairOf(original, oldRepair) : [])];
        if (attempt(() => useStorytellerStore.getState().amendLifeEvent(event.id, specOf(kind, outcome, who || undefined), repair))) onDone();
      }}>Save amendment</button>
      {errorNode}
    </div>
  );
}

function LateRecordForm({ game, previous }: { game: StorytellerLobbyRecord; previous: LiveGameMoment }) {
  const { attempt, errorNode } = useLifeRunner();
  const [kind, setKind] = useState<Kind>(previous.phase === "day" ? "execution" : "death");
  const [outcome, setOutcome] = useState("died");
  const [who, setWho] = useState("");
  const [repair, setRepair] = useState<StatusChoice>("keep");
  const player = who ? game.players[who] : undefined;
  const players = seated(game).filter((p) => kind !== "exile" || p.isTraveler);
  return (
    <details className="life-correction">
      <summary>Late record for {momentLabel(previous)}…</summary>
      <div className="life-correction-form">
        <p className="behavior-help">Record something that happened during {momentLabel(previous)} but was not recorded then.</p>
        <EventSpecFields idPrefix="late" moment={previous} kind={kind} outcome={outcome}
          onKind={(k) => { setKind(k); setRepair(suggestedStatusForEvent(player, k, outcome)); }}
          onOutcome={(o) => { setOutcome(o); setRepair(suggestedStatusForEvent(player, kind, o)); }} />
        <div className="drawer-row">
          <label className="label" htmlFor="late-who">Player</label>
          <select id="late-who" value={who} onChange={(e) => {
            setWho(e.target.value);
            setRepair(suggestedStatusForEvent(game.players[e.target.value], kind, outcome));
          }}>
            <option value="">Choose a player…</option>
            {players.map((p) => <option key={p.id} value={p.id}>{p.name} (seat {p.seat + 1})</option>)}
          </select>
        </div>
        {player && <StatusRepair id="late-status" label="Also set status" player={player} value={repair} onChange={setRepair} />}
        <button className="btn btn-sm btn-gold" disabled={!player} onClick={() => {
          if (!player) return;
          if (attempt(() => useStorytellerStore.getState().lateRecordLifeEvent(
            { ...specOf(kind, outcome, player.id), playerId: player.id }, repairOf(player, repair)))) {
            setWho(""); setRepair("keep");
          }
        }}>Record for {momentLabel(previous)}</button>
        {errorNode}
      </div>
    </details>
  );
}

/**
 * Phase 10A Section 25: a bounded view of the recent Life Event Window (the
 * current and previous phase only -- not a History browser) with its
 * corrections. Older mistakes are outside the window and mechanically inert.
 */
export function LifeEventsPanel({ onClose }: { onClose: () => void }) {
  const game = useStorytellerStore((s) => s.game);
  // 10A-ASTRA-003: Storyteller-private; never rendered under Privacy Mode.
  const privacyMode = usePrivacyStore((s) => s.enabled);
  const [open, setOpen] = useState<{ mode: "retract" | "amend"; id: string } | null>(null);
  const current = game ? currentLiveMoment(game) : null;
  if (privacyMode || !game || !current) return null;
  const previous = previousLiveMoment(current);
  const groups = [current, ...(previous ? [previous] : [])].map((moment) => ({
    moment, events: game.lifeEventWindow.events.filter((e) => sameMoment(e.moment, moment)),
  }));
  return (
    <Modal title="Recent life events" onClose={onClose} className="life-events-panel">
      <div className="dialog-body">
        {groups.map(({ moment, events }) => (
          <section key={momentLabel(moment)} className="drawer-section">
            <h3 className="drawer-section-title">{momentLabel(moment)}</h3>
            {events.length === 0 ? <p className="behavior-help">No life events recorded.</p> : (
              <ul className="life-event-list">
                {events.map((event) => {
                  const note = eventStateNote(game, event);
                  return (
                    <li key={event.id} className="life-event-row">
                      <span>{describeLifeEvent(event, false)}</span>
                      {note && <span className="label life-event-note">{note}</span>}
                      <span className="life-event-actions">
                        <button className="btn btn-sm" aria-expanded={open?.id === event.id && open.mode === "amend"}
                          onClick={() => setOpen(open?.id === event.id && open.mode === "amend" ? null : { mode: "amend", id: event.id })}>
                          Amend…
                        </button>
                        <button className="btn btn-sm" aria-expanded={open?.id === event.id && open.mode === "retract"}
                          onClick={() => setOpen(open?.id === event.id && open.mode === "retract" ? null : { mode: "retract", id: event.id })}>
                          Retract…
                        </button>
                      </span>
                      {open?.id === event.id && (open.mode === "retract"
                        ? <RetractForm game={game} event={event} onDone={() => setOpen(null)} />
                        : <AmendForm game={game} event={event} onDone={() => setOpen(null)} />)}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
        {previous && <LateRecordForm game={game} previous={previous} />}
        <p className="behavior-help">
          Coverage: absence of an event is meaningful from {momentLabel(game.lifeEventWindow.coverageFrom)} onward.
        </p>
      </div>
    </Modal>
  );
}
