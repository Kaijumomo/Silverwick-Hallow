import { buildRegistry } from "@/data/roleRegistry";
import { TRAVELERS } from "@/data/travelers";
import { selectScriptById, useStorytellerStore } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { publicTravelerRole, travelerDemonInformation, travelerGuidance, travelerNeedsFirstNight, travelerNeedsArrivalCheck } from "@/stores/travelers";
import { PlayerInformation } from "./PlayerInformation";

export function TravelerArrival({ playerId, compact = false }: { playerId: string; compact?: boolean }) {
  const state = useStorytellerStore();
  const hidden = usePrivacyStore(s => s.enabled);
  const game = state.game;
  const p = game?.players[playerId];
  const script = game && selectScriptById(state, game.scriptId);
  if (!game || !p?.isTraveler || !script || p.isEmpty) return null;
  const role = publicTravelerRole(p);
  if (hidden) return <p>Traveler: {role?.name ?? "Character not chosen"}</p>;
  const guidance = travelerGuidance(p);
  const info = travelerDemonInformation(p, game, buildRegistry(script));
  const needsProcedure = travelerNeedsFirstNight(p) && !p.travelerArrival?.firstNightComplete;
  return <section className="drawer-section traveler-arrival" aria-label={`Traveler arrival for ${p.name}`}>
    <h3 className="drawer-section-title">{compact ? `${p.name} · Traveler` : "Traveler arrival"}</h3>
    {compact ? <button className="btn btn-sm" onClick={() => state.selectPlayer(playerId)}>Edit Traveler</button> : <>
      <label className="information-input">Public character
        <select className="select" value={role?.id ?? ""} onChange={e => state.assignRole(playerId, e.target.value)}>
          <option value="">Choose Traveler</option>
          {TRAVELERS.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>
      <div className="drawer-row" role="group" aria-label="Actual Traveler alignment (Storyteller private)">
        <span>Actual alignment</span>
        {(["good", "evil"] as const).map(alignment => <button key={alignment} className="toggle-pill"
          aria-pressed={p.actualAlignment === alignment} onClick={() => state.setTravelerAlignment(playerId, alignment)}>
          {alignment === "good" ? "Good" : "Evil"}
        </button>)}
      </div>
      <p className="behavior-help">Character is public. Tell alignment privately in person, or explicitly show it below.</p>
      {role && p.shownRole !== role.id && <button className="btn btn-sm" onClick={() => state.showAssignedRole(playerId)}>Show public character in player view</button>}
      {role && p.actualAlignment && p.shownAlignment !== p.actualAlignment && <button className="btn btn-sm"
        onClick={() => state.setShownAlignment(playerId, p.actualAlignment!)}>Show alignment to Traveler</button>}
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
