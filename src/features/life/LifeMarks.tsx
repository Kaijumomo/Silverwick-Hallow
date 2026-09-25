import { hasVoteAvailable, isDeadState, isExiledState, lifeHeadline, voteTokenLabel, type LifeState } from "@/stores/lifeState";

/**
 * Phase 10A: the shared visual life grammar, used by the Storyteller
 * Grimoire, the public display and the player town list alike.
 *
 *  - Dead: a dark shroud laid over the top of the token (BOTC's physical
 *    shroud), with the Role/player art still readable below it -- never
 *    low opacity alone.
 *  - Exiled: the same shroud in the Traveler colour, labelled "Exiled".
 *  - Vote token: a solid disc while the dead player's vote is available; an
 *    empty, struck-through ring once it is used.
 *
 * Every mark is decorative (aria-hidden): the textual equivalent is always
 * rendered by LifeStateText, and accessible names come from
 * lifeAccessibleLabel() -- life state is never color/icon-only.
 */

export function lifeStateText(state: LifeState): string {
  const vote = voteTokenLabel(state);
  return vote ? `${lifeHeadline(state)} · ${vote}` : lifeHeadline(state);
}

export function LifeShroud({ state }: { state: LifeState }) {
  if (!isDeadState(state)) return null;
  const exiled = isExiledState(state);
  return (
    <span className={`life-shroud${exiled ? " exiled" : ""}`} aria-hidden="true" data-testid="life-shroud">
      <span className="life-shroud-label">{exiled ? "Exiled" : "Dead"}</span>
    </span>
  );
}

export function VoteToken({ state }: { state: LifeState }) {
  if (!isDeadState(state)) return null;
  const available = hasVoteAvailable(state);
  return (
    <span
      className={`vote-token ${available ? "available" : "used"}`}
      aria-hidden="true"
      data-testid="vote-token"
      title={available ? "Vote available" : "Vote used"}
    />
  );
}

export function LifeStateText({ state, className = "" }: { state: LifeState; className?: string }) {
  return (
    <span className={`life-state-text life-${state} ${className}`.trim()} data-life-state={state}>
      {lifeStateText(state)}
    </span>
  );
}
