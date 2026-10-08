import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ReferenceWorkspace } from "@/features/almanac/ReferenceWorkspace";
import { useStorytellerStore, selectScriptById, type SeatSwapLayout } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { iconUrlFor } from "@/data/iconUrl";
import { resolvedCharacters } from "@/data/roleRegistry";
import { TRAVELERS } from "@/data/travelers";
import { selectSetupContext, isPostDeal } from "@/features/setup/setupContext";
import { analyzeSetup } from "@/features/setup/setupAnalyzer";
import { setupPresentation } from "@/features/setup/setupPresentation";
import { canRefineSetup } from "@/features/setup/setupRefinement";
import { isInitialRevealComplete } from "@/stores/identity";
import { changeRoleIntent, ordinaryRoleChoices } from "@/stores/roleResolution";
import { arrivalsAreTravelers } from "@/stores/travelers";
import { randomSetup } from "@/features/setup/randomSetup";
import { SetupFindings } from "@/features/setup/SetupFindings";
import { SetupPanel } from "@/features/setup/SetupPanel";
import { PrivateRevealReadiness } from "@/features/setup/SetupStages";
import { SeatAssignPopup } from "@/features/grimoire/SeatAssignPopup";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { Modal } from "@/components/Modal";
import { useTargetPicker } from "@/features/abilities/abilityUi";
import { PlayersInteraction } from "./PlayersInteraction";
import { RoleChooser } from "./RoleChooser";
import { PlayerPopover } from "./PlayerPopover";
import type { RoleDef, STPlayerRecord, StorytellerLobbyRecord } from "@/stores/types";

type Chooser = { kind: "distribute"; game: StorytellerLobbyRecord } |
  { kind: "choose"; game: StorytellerLobbyRecord; player: STPlayerRecord };

/** Coordinates presentation only; mutations use the existing store commands. */
export function PlayersWorkspace({ children, enabled, roles, onMore, advancedPlayerId, night, nightKey, nightOpenRequest }: {
  children: ReactNode; enabled: boolean; roles: RoleDef[];
  onMore: (id: string) => void; advancedPlayerId: string | null;
  night?: (visible: boolean, close: () => void) => ReactNode; nightKey?: string;
  nightOpenRequest?: number;
}) {
  const state = useStorytellerStore();
  const game = state.game;
  const privacy = usePrivacyStore(s => s.enabled);
  const script = game ? selectScriptById(state, game.scriptId) : undefined;
  const [chooser, setChooser] = useState<Chooser | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [generatedRoleIds, setGeneratedRoleIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addingSeat, setAddingSeat] = useState<string | undefined>();
  const [waitingSeat, setWaitingSeat] = useState<string | null>(null);
  const backend = useSessionRuntime(s => s.backend);
  const [name, setName] = useState("");
  const [swap, setSwap] = useState<STPlayerRecord | null>(null);
  const [notice, setNotice] = useState("");
  const definitions = useMemo(() => script ? resolvedCharacters(script) : [], [script]);
  useEffect(() => {
    if (privacy || !enabled || game?.phase === "ended") {
      if (privacy && enabled) useStorytellerStore.getState().selectPlayer(null);
      setChooser(null); setDetails(false); setAdding(false); setWaitingSeat(null); setSwap(null); setError(null); setNotice("");
    }
  }, [privacy, enabled, game?.phase]);
  useEffect(() => {
    if (!swap) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); setSwap(null); }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [swap]);
  if (!game || !script || !enabled) return <>{children}</>;
  const byId = new Map(definitions.map(r => [r.id, r]));
  const context = selectSetupContext(game, script);
  const analysis = analyzeSetup(context);
  const setup = setupPresentation(game, analysis, context);
  const privateSetup = game.phase === "setup" && !isInitialRevealComplete(game);
  const ended = game.phase === "ended";
  const selected = state.selectedPlayerId ? game.players[state.selectedPlayerId] : null;
  const ordinary = ordinaryRoleChoices(script);
  const report = (result: { ok: boolean; message?: string }) => setError(result.ok ? null : result.message ?? "Review setup before continuing.");
  const openDistribute = () => {
    setDraft(isPostDeal(game) ? [...context.assigned] : [...game.rolePool]);
    setChooser({ kind: "distribute", game }); setError(null); state.selectPlayer(null);
  };
  const openChoose = (player: STPlayerRecord) => { setError(null); setChooser({ kind: "choose", game, player }); };
  const choose = (roleId: string) => {
    if (chooser?.kind !== "choose") return;
    const current = useStorytellerStore.getState();
    if (current.game !== chooser.game) { setError("The game changed. Close this chooser and select the player again."); return; }
    const player = chooser.player;
    if (roleId === player.actualRole) { setChooser(null); return; }
    let result: { ok: boolean; message?: string };
    if (!player.isTraveler && canRefineSetup(game).ok) {
      const holders = context.ordinary.filter(p => p.id !== player.id && p.actualRole === roleId);
      if (holders.length > 1) { setError("More than one player has this character. Use More settings to choose a swap partner."); return; }
      result = holders.length ? current.swapSetupRoles(player.id, holders[0]!.id) : current.replaceSetupRole(player.id, roleId);
    } else {
      if (!player.isTraveler && game.phase === "setup") { setError("Deal roles before changing an assignment; revealed setup is locked until Night 1."); return; }
      result = current.resolveRoles({ intents: [changeRoleIntent(player, roleId)] });
    }
    report(result);
    if (result.ok) setChooser(null);
  };
  const distribute = () => {
    if (chooser?.kind !== "distribute") return;
    const current = useStorytellerStore.getState();
    if (current.game !== chooser.game) { setError("The roster or setup changed. Close and reopen Distribute Roles to review it."); return; }
    const result = current.dealRolePool(draft);
    report(result);
    if (result.ok) { setChooser(null); setNotice("Roles distributed privately. Review preparation before revealing."); }
  };
  const tap = (id: string, layout?: SeatSwapLayout) => {
    if (!swap) return false;
    setSwap(null);
    const latest = useStorytellerStore.getState();
    const current = latest.game;
    if (!current || privacy || current.phase === "ended" || current.players[swap.id]?.participantId !== swap.participantId || current.players[swap.id] !== swap || !current.players[id] || current.players[id]!.isEmpty) {
      setNotice("The roster changed. Select the player again to swap seats."); return true;
    }
    if (id === swap.id) return true;
    const result = latest.swapPlayerSeats({ playerId: swap.id, participantId: swap.participantId! }, { playerId: id, participantId: current.players[id]!.participantId! }, layout);
    setNotice(result.ok ? `${swap.name} and ${current.players[id]!.name} swapped seats.` : result.message);
    return true;
  };
  const add = () => {
    const trimmed = name.trim(); if (!trimmed) return;
    const before = useStorytellerStore.getState().game;
    if (!before || before.phase === "ended") return;
    state.addPlayerToSeat(trimmed, addingSeat);
    const after = useStorytellerStore.getState().game;
    if (after === before) { setError("Could not add a player. Check available seats and game capacity."); return; }
    setAdding(false); setName(""); setError(null);
  };
  const draftContext = selectSetupContext({ ...game, rolePool: draft }, script);
  const draftAnalysis = analyzeSetup(draftContext);
  const required = draftAnalysis.pool.candidates?.length === 1 ? draftAnalysis.pool.candidates[0]! : {};
  const holderNames: Record<string, string[]> = {};
  for (const p of context.occupied) if (p.actualRole) (holderNames[p.actualRole] ??= []).push(p.name || `Seat ${p.seat + 1}`);
  return <PlayersInteraction.Provider value={{ active: true, swapping: !!swap, swappingPlayerId: swap?.id, tap }}>
    <ReferenceWorkspace enabled privacyMode={privacy} roles={roles} scriptName={script.name} night={night} nightKey={nightKey} nightOpenRequest={nightOpenRequest}
      onPanelOpen={() => { state.selectPlayer(null); setSwap(null); }}
      players={dismiss => <>
        <div className="players-summary"><p>{context.ordinary.length} residents · {context.travelers.length} travelers · {context.occupied.filter(p => p.alive).length} alive</p>
          <div className="players-composition">{(["townsfolk", "outsider", "minion", "demon"] as const).map(type => <div key={type} className={`type-${type}`}><strong>{context.ordinary.filter(p => byId.get(p.actualRole)?.type === type).length}</strong><span>{type === "townsfolk" ? "Townsfolk" : type[0]!.toUpperCase() + type.slice(1)}</span></div>)}</div>
        </div>
        <div className="players-scroll"><ol className="players-list">{game.seatOrder.map(id => {
          const p = game.players[id]; if (!p) return null;
          const role = byId.get(p.actualRole);
          return <li key={id}><button type="button" className="players-row" data-dead={!p.alive || undefined}
            onClick={() => { if (p.isEmpty) { if (state.lobby) setWaitingSeat(id); else { setAddingSeat(id); setAdding(true); setError(null); } } else { dismiss(); state.selectPlayer(id); } }}>
            <span className="players-seat">{p.seat + 1}</span><span className={`players-art type-${role?.type ?? "townsfolk"}`}>{role && <img src={iconUrlFor(role)} alt="" />}</span>
            <span className="players-person"><strong>{p.isEmpty ? "Empty seat" : p.name || `Seat ${p.seat + 1}`}</strong><span className={`type-${role?.type ?? "townsfolk"}`}>{role?.name ?? "Unassigned"}</span></span>
            <span className="players-kind">{p.isTraveler || p.plannedTravelerSeat ? "Traveler" : "Resident"}</span>
          </button></li>;
        })}</ol>
        {game.phase === "setup" && <section className="players-preparation" aria-label="Setup preparation">
          <p>{setup.message}</p>
          {isPostDeal(game) && !isInitialRevealComplete(game) && <>
            {setup.revealReadiness?.pendingIds.map(id => <button className="btn btn-sm" key={id} onClick={() => { dismiss(); state.selectPlayer(id); onMore(id); }}>Prepare {game.players[id]?.name || "player"}</button>)}
            <button className="btn btn-gold" disabled={!setup.revealReadiness?.ready} onClick={() => report(state.revealRoles())}>Reveal Roles</button>
          </>}
          {isInitialRevealComplete(game) && <><PrivateRevealReadiness game={game} live={!!state.lobby} /><button className="btn btn-gold" onClick={() => report(state.beginNightOne())}>Begin Night 1</button></>}
          <button className="players-text-button" onClick={() => setDetails(true)}>Setup details &amp; modifiers</button>
        </section>}
        {error && !chooser && !adding && <p role="alert" className="field-error">{error}</p>}
        </div>
        {!ended && <footer className="players-footer"><div><button className="btn" onClick={() => { setAddingSeat(game.seatOrder.find(id => game.players[id]?.isEmpty)); setAdding(true); setError(null); }}>Add Player</button>
          {privateSetup && <button className="btn btn-gold" onClick={openDistribute}>Distribute Roles</button>}</div>
          <button className="players-text-button" onClick={() => { state.clearTokenPositions(); state.setGrimoireMode("ring"); }}>Reset Token Positions</button></footer>}
      </>}>
      {children}
      {!privacy && swap && <div className="players-swap-prompt" role="status">Tap another token to swap seats with {swap.name}<button className="btn btn-sm" onClick={() => setSwap(null)}>Cancel</button></div>}
      {!privacy && !ended && selected && !selected.isEmpty && advancedPlayerId !== selected.id && !swap && !chooser && <PlayerPopover player={selected}
        onClose={() => state.selectPlayer(null)} onMore={() => onMore(selected.id)} onChangeCharacter={() => openChoose(selected)}
        onSwapSeats={() => { useTargetPicker.getState().cancel(); setSwap(selected); state.selectPlayer(null); }} />}
      {!privacy && notice && <div className="players-notice" role="status">{notice}<button aria-label="Dismiss message" onClick={() => setNotice("")}>×</button></div>}
    </ReferenceWorkspace>
    {!privacy && !ended && chooser?.kind === "distribute" && <RoleChooser mode="distribute" roles={ordinary} scriptName={script.name} selected={draft}
      residents={context.population.targetNonTravelerCount ?? context.ordinary.length} travelers={context.travelers.length} required={required}
      distributionLabel={`Distribute to ${context.ordinary.length} residents`} canDistribute={privateSetup && draftAnalysis.readiness.deal.ok} status="Distributes residents privately. Traveler characters are managed individually."
      onClose={() => setChooser(null)} onToggle={id => setDraft(values => values.includes(id) ? values.filter(x => x !== id) : [...values, id])}
      onClear={() => setDraft([])} onRandom={() => { const result = randomSetup({ scriptCharacters: script.characters, targetPlayerCount: context.population.targetNonTravelerCount,
        fabledIds: game.fabled, loricIds: game.lorics }); if (result.ok) { setDraft(result.pool); setError(null); } else setError(result.failure.message); }}
      onDistribute={distribute} error={error ?? undefined} footerExtra={<SetupFindings findings={draftAnalysis.findings} />} />}
    {!privacy && !ended && chooser?.kind === "choose" && <RoleChooser mode="choose" scriptName={script.name}
      roles={chooser.player.isTraveler ? [...TRAVELERS] : ordinary} player={{ id: chooser.player.id, name: chooser.player.name, seat: chooser.player.seat + 1, roleId: chooser.player.actualRole }}
      holders={holderNames} allowSwap={!chooser.player.isTraveler && canRefineSetup(game).ok} onChoose={choose} onClose={() => setChooser(null)} error={error ?? undefined} />}
    {!privacy && !ended && details && <Modal title="Setup details" onClose={() => setDetails(false)} className="players-setup-details"><SetupPanel game={game} script={script} generatedRoleIds={generatedRoleIds} onGeneratedRoleIdsChange={setGeneratedRoleIds} onClose={() => setDetails(false)} /></Modal>}
    {!privacy && !ended && waitingSeat && <SeatAssignPopup seatPlayerId={waitingSeat} seatNumber={(game.players[waitingSeat]?.seat ?? 0) + 1} backend={backend} code={state.lobby?.code ?? ""} onClose={() => setWaitingSeat(null)} onRemoveSeat={() => { state.removePlayer(waitingSeat); setWaitingSeat(null); }} />}
    {!privacy && !ended && adding && <Modal title="Add Player" onClose={() => setAdding(false)}><form className="players-add" onSubmit={event => { event.preventDefault(); add(); }}>
      <label>Player name<input maxLength={20} className="input" value={name} onChange={event => setName(event.target.value)} autoComplete="off" /></label>
      {<p>{arrivalsAreTravelers(game) || (addingSeat && game.players[addingSeat]?.plannedTravelerSeat) ? "This player joins as a Traveler." : "This player joins as a resident."}{addingSeat ? ` Filling seat ${(game.players[addingSeat]?.seat ?? 0) + 1}.` : " A new seat will be added."}</p>}
      {error && <p role="alert">{error}</p>}<button className="btn btn-gold" disabled={!name.trim()}>Add Player</button>
      <button type="button" className="btn" onClick={() => { arrivalsAreTravelers(game) ? state.addTravelerSeat() : state.addEmptySeat(); setAdding(false); }}>Reserve empty seat</button>
      {!arrivalsAreTravelers(game) && <button type="button" className="btn" onClick={() => { state.addTravelerSeat(); setAdding(false); }}>Reserve Traveler seat</button>}
      {addingSeat && state.lobby && <button type="button" className="btn" onClick={() => { setAdding(false); setWaitingSeat(addingSeat); }}>Choose waiting player</button>}
    </form></Modal>}
  </PlayersInteraction.Provider>;
}
