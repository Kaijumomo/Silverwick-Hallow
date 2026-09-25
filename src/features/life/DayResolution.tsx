import { useState } from "react";
import { Modal } from "@/components/Modal";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { currentLiveMoment, executionsAt, exilesAt, type LifeEventQueryResult } from "@/stores/lifeEvents";
import type { LifeEvent, LiveGameMoment, StorytellerLobbyRecord, STPlayerRecord } from "@/stores/types";
import { useLifeRunner, executionOptions } from "./LifeControls";
import { describeLifeEvent } from "./lifeEventText";

const seatedPlayers = (game: StorytellerLobbyRecord): STPlayerRecord[] =>
  game.seatOrder.map((id) => game.players[id]).filter((p): p is STPlayerRecord => !!p && !p.isEmpty && !!p.participantId);

const playerOption = (p: STPlayerRecord) =>
  `${p.name || "Unnamed player"} (seat ${p.seat + 1}${p.alive ? "" : ", dead"})`;

/** Lists a query result honestly: "none" only when coverage is known. */
export function LifeEventList({ result, emptyText, unknownText }: {
  result: LifeEventQueryResult; emptyText: string; unknownText: string;
}) {
  const events: LifeEvent[] = result.status === "known" ? result.events : result.recorded;
  return (
    <>
      {events.length > 0 ? (
        <ul className="life-event-list">
          {events.map((event) => <li key={event.id}>{describeLifeEvent(event, false)}</li>)}
        </ul>
      ) : result.status === "known" ? (
        <p className="behavior-help">{emptyText}</p>
      ) : null}
      {result.status === "unknown" && <p className="life-coverage-unknown" role="note">{unknownText}</p>}
    </>
  );
}

const UNKNOWN_DAY = "Life Events for this Day were not fully recorded (this game was recorded before Life Events existed), so Silverwick cannot say whether anything else happened.";

/**
 * Phase 10A Section 19: record the Day's execution(s) and Traveler exile(s)
 * WHEN they happen. The actual executee is chosen explicitly (not
 * necessarily the nominee); Travelers are listed separately as the
 * exceptional executee case. No nominations or voting are modelled.
 */
export function DayResolutionPanel({ onClose }: { onClose: () => void }) {
  const game = useStorytellerStore((s) => s.game);
  // 10A-ASTRA-003: Life Event snapshots (names at the time, outcomes) are
  // Storyteller-private; under Privacy Mode nothing of this panel is
  // rendered, and turning Privacy Mode on unmounts it immediately.
  const privacyMode = usePrivacyStore((s) => s.enabled);
  const store = useStorytellerStore.getState;
  const [executee, setExecutee] = useState("");
  const [exilee, setExilee] = useState("");
  const moment = game ? currentLiveMoment(game) : null;
  const participantAt = (id: string) => (id && game?.players[id]?.participantId) || "";
  const { attempt, confirmation, errorNode, clear } = useLifeRunner(
    `${participantAt(executee)}|${participantAt(exilee)}|${moment?.phase ?? ""}|${moment?.day ?? ""}`);
  if (privacyMode || !game || !moment || moment.phase !== "day") return null;
  const players = seatedPlayers(game);
  const ordinary = players.filter((p) => !p.isTraveler);
  const travelers = players.filter((p) => p.isTraveler);
  const livingTravelers = travelers.filter((p) => p.alive);
  const chosen = players.find((p) => p.id === executee);
  const chosenExilee = livingTravelers.find((p) => p.id === exilee);

  const recordExecution = (outcome: "died" | "survived" | "alreadyDead") => {
    if (!chosen) return;
    if (attempt((c) => store().recordExecution(chosen.id, outcome, executionOptions(c)))) setExecutee("");
  };
  const recordExile = (outcome: "died" | "survived") => {
    if (!chosenExilee) return;
    if (attempt(() => store().recordExile(chosenExilee.id, outcome))) setExilee("");
  };

  return (
    <Modal title={`Day ${moment.day} resolution`} onClose={onClose} className="day-resolution">
      <div className="dialog-body">
        <section className="drawer-section">
          <h3 className="drawer-section-title">Executions</h3>
          <LifeEventList result={executionsAt(game, moment)} emptyText="No execution recorded yet today." unknownText={UNKNOWN_DAY} />
          <div className="drawer-row">
            <label className="label" htmlFor="day-executee">Executee</label>
            <select id="day-executee" value={executee} onChange={(e) => { clear(); setExecutee(e.target.value); }}>
              <option value="">Choose the executed player…</option>
              {ordinary.map((p) => <option key={p.id} value={p.id}>{playerOption(p)}</option>)}
              {travelers.length > 0 && (
                <optgroup label="Travelers (exceptional executee)">
                  {travelers.map((p) => <option key={p.id} value={p.id}>{playerOption(p)}</option>)}
                </optgroup>
              )}
            </select>
          </div>
          {chosen && (
            <div className="drawer-row" role="group" aria-label="Execution outcome">
              {chosen.alive ? <>
                <button className="btn btn-sm" onClick={() => recordExecution("died")}>Died</button>
                <button className="btn btn-sm" onClick={() => recordExecution("survived")}>Survived</button>
              </> : (
                <button className="btn btn-sm" onClick={() => recordExecution("alreadyDead")}>Already dead</button>
              )}
            </div>
          )}
        </section>
        <section className="drawer-section">
          <h3 className="drawer-section-title">Traveler exiles</h3>
          <LifeEventList result={exilesAt(game, moment)} emptyText="No exile recorded yet today." unknownText={UNKNOWN_DAY} />
          {livingTravelers.length === 0 ? (
            <p className="behavior-help">No living Traveler to exile.</p>
          ) : <>
            <div className="drawer-row">
              <label className="label" htmlFor="day-exilee">Traveler</label>
              <select id="day-exilee" value={exilee} onChange={(e) => { clear(); setExilee(e.target.value); }}>
                <option value="">Choose the exiled Traveler…</option>
                {livingTravelers.map((p) => <option key={p.id} value={p.id}>{playerOption(p)}</option>)}
              </select>
            </div>
            {chosenExilee && (
              <div className="drawer-row" role="group" aria-label="Exile outcome">
                <button className="btn btn-sm" onClick={() => recordExile("died")}>Died</button>
                <button className="btn btn-sm" onClick={() => recordExile("survived")}>Survived</button>
              </div>
            )}
          </>}
        </section>
        {confirmation}
        {errorNode}
      </div>
    </Modal>
  );
}

/**
 * Phase 10A Section 19: the dusk safety check before Day -> Night. Reads
 * the Life Event Window only (never History), creates no "no execution"
 * record, and never claims "nothing happened" when coverage is unknown.
 */
export function DuskReview({ onClose, onRecord, onContinue }: {
  onClose: () => void; onRecord: () => void; onContinue: () => void;
}) {
  const game = useStorytellerStore((s) => s.game);
  const privacyMode = usePrivacyStore((s) => s.enabled);
  const [confirmedNone, setConfirmedNone] = useState(false);
  const moment: LiveGameMoment | null = game ? currentLiveMoment(game) : null;
  if (!game || !moment || moment.phase !== "day") return null;
  // 10A-ASTRA-003: under Privacy Mode no Life Event snapshot is rendered at
  // all -- only a public-safe notice (the review itself needs private data).
  if (privacyMode) return (
    <Modal title={`Day ${moment.day} resolution`} onClose={onClose} className="dusk-review">
      <div className="dialog-body">
        <p className="behavior-help">Turn off Privacy Mode to review today&apos;s executions and exiles before continuing to Night {moment.day + 1}.</p>
        <div className="drawer-row dialog-actions">
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
  const executions = executionsAt(game, moment);
  const exiles = exilesAt(game, moment);
  const noExecutionRecorded = executions.status === "known" && executions.events.length === 0;
  return (
    <Modal title={`Day ${moment.day} resolution`} onClose={onClose} className="dusk-review">
      <div className="dialog-body">
        <section className="drawer-section">
          <h3 className="drawer-section-title">Executions</h3>
          <LifeEventList result={executions} emptyText="No execution recorded." unknownText={UNKNOWN_DAY} />
        </section>
        <section className="drawer-section">
          <h3 className="drawer-section-title">Exiles</h3>
          <LifeEventList result={exiles} emptyText="No exile recorded." unknownText={UNKNOWN_DAY} />
        </section>
        {noExecutionRecorded && (
          <label className="life-confirm-none">
            <input type="checkbox" checked={confirmedNone} onChange={(e) => setConfirmedNone(e.target.checked)} />
            {" "}No execution happened today
          </label>
        )}
        <div className="drawer-row dialog-actions">
          <button className="btn btn-sm" onClick={onRecord}>Record execution or exile…</button>
          <button className="btn btn-gold" disabled={noExecutionRecorded && !confirmedNone} onClick={onContinue}>
            Continue to Night {moment.day + 1}
          </button>
        </div>
      </div>
    </Modal>
  );
}
