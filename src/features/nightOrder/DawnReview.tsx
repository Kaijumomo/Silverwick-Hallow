import { Modal } from "@/components/Modal";
import { usePrivateDialog } from "@/features/life/usePrivateDialog";
import { lifeEventsAt } from "@/stores/lifeEvents";
import type { StorytellerLobbyRecord } from "@/stores/types";
import { nightStepName, type UnfinishedNightWork } from "./nightWork";

/**
 * Phase 10G: Dawn Review (PHASE10G Section 14) -- the Night -> Day counterpart
 * of Dusk Review. Its job is narrow: unfinished Night work must not silently
 * disappear because the Night Order unmounts on Day.
 *
 * ADVISORY, never a mechanical gate: the Storyteller may Review Night or
 * Continue to Day anyway (explicit authority). Nothing is persisted -- no
 * `nightComplete` field, no acknowledgment record. The unfinished items come
 * from the SAME derivation the Night Order renders (nightWork.ts).
 *
 * Storyteller-private: the caller never opens it under Privacy Mode, and if
 * Privacy Mode turns on while it is open it closes itself and never reappears
 * on its own (usePrivateDialog) -- no private item is rendered underneath.
 */
export function DawnReview({ game, unfinished, onClose, onReviewNight, onContinue }: {
  game: StorytellerLobbyRecord;
  unfinished: UnfinishedNightWork;
  onClose: () => void;
  onReviewNight: () => void;
  onContinue: () => void;
}) {
  const suppressed = usePrivateDialog(onClose);
  if (suppressed || game.phase !== "night") return null;
  const { rows, customSteps, triggers, triggerChecks } = unfinished;
  const deaths = lifeEventsAt(game, { phase: "night", day: game.day }, (event) => event.kind === "death");
  const nameOf = (playerId: string) => game.players[playerId]?.name || "A player";
  const section = (title: string, items: string[]) => items.length > 0 && (
    <section className="drawer-section" aria-label={title}>
      <h3 className="drawer-section-title">{title}</h3>
      <ul className="dawn-review-list">{items.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul>
    </section>
  );
  return (
    <Modal title={`Night ${game.day} — before Day`} onClose={onClose} className="dawn-review">
      <div className="dialog-body">
        <p className="behavior-help">Some of tonight's work is not marked done or skipped. Review it, or continue to Day anyway — continuing records nothing extra.</p>
        {section("Night steps not done or skipped", rows.map(nightStepName))}
        {section("Triggered abilities still open", triggers.map((t) => `${t.roleName} — ${t.player.name || `seat ${t.player.seat + 1}`}`))}
        {section("Triggers needing your check", triggerChecks.map((t) => `${t.roleName} — ${t.player.name || `seat ${t.player.seat + 1}`}`))}
        {section("Custom steps pending", customSteps.map((step) => game.nightProgress[`${game.day}:${step.stepKey}`]?.notes?.trim() || "Custom night step"))}
        {deaths.status === "known" && deaths.events.length > 0 && (
          <p className="behavior-help">Deaths tonight: {deaths.events.map((event) => event.subject.nameAtTime || nameOf(event.subject.playerId)).join(", ")}.</p>
        )}
        <div className="drawer-row dialog-actions">
          <button className="btn btn-sm" onClick={onReviewNight}>Review Night</button>
          <button className="btn btn-gold" onClick={onContinue}>Continue to Day anyway</button>
        </div>
      </div>
    </Modal>
  );
}
