import { useState } from "react";
import { buildRegistry } from "@/data/roleRegistry";
import { isInitialRevealComplete } from "@/stores/identity";
import { changeRoleIntent, correctRoleIntent, setPerceptionIntent, type RoleIntent } from "@/stores/roleResolution";
import { TRAVELERS } from "@/data/travelers";
import { selectScriptById, useStorytellerStore } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { publicTravelerRole, travelerDemonInformation, travelerGuidance, travelerNeedsFirstNight, travelerNeedsArrivalCheck } from "@/stores/travelers";
import { PlayerInformation } from "./PlayerInformation";
import { ActualAlignmentControls, PlayerFacingAlignmentControls } from "./AlignmentControls";

export function TravelerArrival({ playerId, compact = false }: { playerId: string; compact?: boolean }) {
  const state = useStorytellerStore();
  const hidden = usePrivacyStore(s => s.enabled);
  const [roleError, setRoleError] = useState<string | null>(null);
  const game = state.game;
  const p = game?.players[playerId];
  const script = game && selectScriptById(state, game.scriptId);
  if (!game || !p?.isTraveler || !script || p.isEmpty) return null;
  const role = publicTravelerRole(p);
  if (hidden) return <p>Traveler: {role?.name ?? "Character not chosen"}</p>;
  // Phase 10D (ASTRA-10D-003): every Traveler Role action is built from the
  // Traveler record THIS render shows (`p`) and submitted through the Role
  // seam -- never re-read at click time -- so if the character or the occupant
  // changed in between, the seam refuses it as stale (its message names no
  // character) and nothing changes.
  const runRoles = (intents: RoleIntent[]) => {
    const result = state.resolveRoles({ intents });
    setRoleError(result.ok ? null : result.message);
  };
  const guidance = travelerGuidance(p);
  const info = travelerDemonInformation(p, game, buildRegistry(script));
  const needsProcedure = travelerNeedsFirstNight(p) && !p.travelerArrival?.firstNightComplete;
  return <section className="drawer-section traveler-arrival" aria-label={`Traveler arrival for ${p.name}`}>
    <h3 className="drawer-section-title">{compact ? `${p.name} · Traveler` : "Traveler arrival"}</h3>
    {compact ? <button className="btn btn-sm" onClick={() => state.selectPlayer(playerId)}>Edit Traveler</button> : <>
      <label className="information-input">Public character
        <select className="select" value={role?.id ?? ""} onChange={e => {
          if (!e.target.value) return;
          // Phase 10D: through the Role seam. Between the initial Reveal and
          // Night 1 the committed starting assignment can only be CORRECTED;
          // assigning a Traveler's first character (or any later change) is an
          // ordinary Role change.
          const committedSetup = game.phase === "setup" && isInitialRevealComplete(game) && !!p.actualRole;
          runRoles([committedSetup ? correctRoleIntent(p, e.target.value) : changeRoleIntent(p, e.target.value)]);
        }}>
          <option value="" disabled>Choose Traveler</option>
          {TRAVELERS.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>
      {roleError && <p role="alert" className="field-error">{roleError}</p>}
      {/* Phase 10E: the same Alignment seam (Actual Alignment) and the same
          perception seam (player-facing alignment) as every participant --
          no Traveler-only alignment writer. Keyed by the participation
          instance. */}
      <ActualAlignmentControls key={`alignment:${p.participantId ?? p.id}`} player={p} />
      <PlayerFacingAlignmentControls key={`perceived:${p.participantId ?? p.id}`} player={p} />
      <p className="behavior-help">Character is public. With Normal, their actual alignment reaches their own private view automatically.</p>
      {role && p.shownRole !== role.id && <button className="btn btn-sm"
        onClick={() => runRoles([setPerceptionIntent(p, { shownRole: role.id, shownAlignment: null })])}>Show public character in player view</button>}
    </>}
    {guidance.length ? guidance.map(message => <p className="behavior-help" key={message}>{message}</p>) : <p role="status">Ready for play</p>}
    {p.alive && !p.exiled && travelerNeedsArrivalCheck(p) && !p.travelerArrival?.arrivalCheckComplete && <>
      <p className="behavior-help">{role?.ability}</p>
      <button className="btn btn-sm" disabled={!p.actualAlignment}
        onClick={() => state.completeTravelerArrivalCheck(playerId)}>Public starting information resolved</button>
    </>}
    {p.alive && !p.exiled && p.actualAlignment === "evil" && !p.travelerArrival?.demonInfoComplete && role && <>
      {info.check ? <p className="behavior-help">{info.check}</p> : <>
        <p>Demon: {info.demon!.name} · seat {info.demon!.seat + 1}</p>
        <button className="btn btn-sm" onClick={() => state.prepareTravelerDemon(playerId)}>Prepare Demon information</button>
        {p.privateInfo?.travelerDemon && <PlayerInformation playerId={playerId} purpose="traveler" />}
      </>}
      <button className="btn btn-sm" onClick={() => state.completeTravelerInformation(playerId)}>Information given in person</button>
    </>}
    {!compact && p.alive && !p.exiled && needsProcedure && <>
      <p className="behavior-help">{role?.firstNightPrompt ?? role?.firstNightReminder ?? role?.ability}</p>
      <p className="behavior-help">{game.phase === "night" ? "Use the Night Assistant to resolve this procedure and mark it Done. For a late arrival, check its timing manually." : "Resolve this Traveler's personal first-night procedure in the Night Assistant."}</p>
    </>}
    {!compact && role?.ability && <details><summary>Character reference</summary><p>{role.ability}</p></details>}
  </section>;
}
