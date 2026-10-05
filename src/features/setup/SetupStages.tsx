import { useStorytellerStore } from "@/stores/storytellerStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { revealViewed } from "@/stores/revealTokens";
import type { StorytellerLobbyRecord, STPlayerRecord } from "@/stores/types";

/**
 * Phase 10H (contract §§3.1 S2, 10; 10H-AC-025/027/036/037): the FROZEN Setup
 * stages, presented INSIDE the Grimoire-centred Setup panel -- an orientation
 * and a set of actionable rows, never a takeover wizard. The existing Setup
 * sequence (deal, refinement, Reveal, Begin Night 1) keeps its authority; the
 * stages only name where the Storyteller is.
 *
 *   1. Town / Lobby       -- seats filled (players join by phone; manual Add);
 *   2. Bag / Deal         -- choose the bag; the initial deal stays randomized;
 *   3. Preparation        -- Storyteller-private setup requirements, as rows
 *                            whose participant choices happen on the Table /
 *                            Roster (the Inspector), never in dropdowns;
 *   4. Private Reveal     -- roles reveal on phones; advisory "Viewed";
 *   5. Begin Night        -- NEVER gated by acknowledgement.
 */
export type SetupStage = "town" | "bag" | "prepare" | "reveal" | "begin";
export const SETUP_STAGES: { id: SetupStage; label: string }[] = [
  { id: "town", label: "Town" },
  { id: "bag", label: "Bag & Deal" },
  { id: "prepare", label: "Preparation" },
  { id: "reveal", label: "Private Reveal" },
  { id: "begin", label: "Begin Night" },
];

/** The current stage from the existing Setup sequence's next step. */
export function setupStageOf(next: string, revealed: boolean): SetupStage {
  if (next === "count" || next === "seats") return "town";
  if (next === "roles" || next === "review" || next === "deal") return "bag";
  if (next === "reveal") return "prepare";
  return revealed ? "reveal" : "begin";
}

export function SetupStageIndicator({ stage }: { stage: SetupStage }) {
  const index = SETUP_STAGES.findIndex((s) => s.id === stage);
  return (
    <ol className="setup-stages" aria-label="Setup stages">
      {SETUP_STAGES.map((s, i) => (
        <li key={s.id} className={`setup-stage${i < index ? " done" : ""}${i === index ? " current" : ""}`}
          aria-current={i === index ? "step" : undefined}>
          <span className="setup-stage-num" aria-hidden="true">{i < index ? "✓" : i + 1}</span>
          <span className="setup-stage-label">{s.label}</span>
          {i < index && <span className="sr-only"> (done)</span>}
        </li>
      ))}
    </ol>
  );
}

/** Stage 3: what still needs the Storyteller before Reveal, one actionable row
 * per participant -- "Open" selects them on the Table, where the Inspector
 * holds the (on-demand, searchable) choice. */
export function PreparationRows({ game, pendingIds }: { game: StorytellerLobbyRecord; pendingIds: readonly string[] }) {
  if (pendingIds.length === 0) return <p className="behavior-help setup-prep-ready">Every player's starting identity is ready to reveal.</p>;
  return (
    <ul className="setup-prep-rows" aria-label="Preparation">
      {pendingIds.map((id) => {
        const p = game.players[id];
        if (!p) return null;
        return (
          <li key={id} className="setup-prep-row">
            <span className="setup-prep-name">{p.name || `Seat ${p.seat + 1}`} <span className="setup-prep-seat">seat {p.seat + 1}</span></span>
            <span className="setup-prep-need">Needs a shown role</span>
            <button type="button" className="btn btn-sm" onClick={() => useStorytellerStore.getState().selectPlayer(id)}
              aria-label={`Open ${p.name || `seat ${p.seat + 1}`} on the Table`}>Open</button>
          </li>
        );
      })}
    </ul>
  );
}

/** Stage 4: advisory reveal readiness. "Viewed" is derived ONLY from current
 * reveal-token equality (10H-AC-036); it never gates Begin Night (AC-037). */
export function PrivateRevealReadiness({ game, live }: { game: StorytellerLobbyRecord; live: boolean }) {
  const acks = useSessionRuntime((s) => s.revealAcks);
  const seated = game.seatOrder.map((id) => game.players[id]).filter((p): p is STPlayerRecord => !!p && !p.isEmpty);
  if (!live) {
    return <p className="behavior-help">No phones are connected: reveal roles in person. Beginning Night 1 is always available.</p>;
  }
  const viewed = seated.filter((p) => revealViewed(p, acks[p.id]));
  return (
    <section className="reveal-readiness" aria-label="Private reveal">
      <p className="reveal-readiness-summary"><strong>{viewed.length}</strong> of {seated.length} have seen their role</p>
      <ul className="reveal-readiness-list">
        {seated.map((p) => {
          const seen = revealViewed(p, acks[p.id]);
          return (
            <li key={p.id} className={`reveal-readiness-row${seen ? " seen" : ""}`} data-viewed={seen}>
              <span className="reveal-readiness-name">{p.name || `Seat ${p.seat + 1}`}</span>
              <span className="reveal-readiness-state">{seen ? "✓ Viewed" : "Not yet viewed"}</span>
            </li>
          );
        })}
      </ul>
      <p className="behavior-help">Advisory only — Begin Night 1 is never blocked by who has looked.</p>
    </section>
  );
}
