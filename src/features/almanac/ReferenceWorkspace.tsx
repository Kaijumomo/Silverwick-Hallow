import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { RoleDef } from "@/stores/types";
import { ReferenceBody } from "./ReferenceBody";
import { GrimoireIcon } from "@/components/GrimoireIcon";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { useVotingInteraction } from "@/features/voting/VotingWorkspace";
import { useShellStore } from "@/stores/shellStore";

function PinIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M8 3h8l-1 7 3 4H6l3-4-1-7Zm4 11v7" />
  </svg>;
}

/** A local presentation boundary. Pinning changes available space, never game state. */
export function ReferenceWorkspace({ children, enabled, privacyMode, roles, scriptName, players, info, night, nightKey, nightOpenRequest = 0, onPanelOpen,
  onEnd, endDisabled, onReviewHistory }: {
  children: ReactNode; enabled: boolean; privacyMode: boolean; roles: RoleDef[]; scriptName: string;
  info?: ReactNode;
  players?: (dismiss: () => void) => ReactNode;
  night?: (visible: boolean, close: () => void) => ReactNode;
  nightKey?: string;
  /** Explicit navigation (for example, Review Night at dawn), never game state. */
  nightOpenRequest?: number;
  onPanelOpen?: () => void;
  onEnd?: () => void; endDisabled?: boolean; onReviewHistory?: () => void;
}) {
  const phase = useStorytellerStore(state => state.game?.phase);
  const voting = useVotingInteraction();
  const actionRequest = useShellStore(state => state.actionRequest);
  const handledActorRequest = useRef(actionRequest);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"Reference" | "Players" | "Night" | "Info">("Reference");
  const [pinned, setPinned] = useState(false);
  const [search, setSearch] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const playersTrigger = useRef<HTMLButtonElement>(null);
  const infoTrigger = useRef<HTMLButtonElement>(null);
  const nightTrigger = useRef<HTMLButtonElement>(null);
  const dayTrigger = useRef<HTMLButtonElement>(null);
  const openedNight = useRef<string | undefined>();
  const handledNightRequest = useRef(nightOpenRequest);
  const heading = useRef<HTMLHeadingElement>(null);
  const panelId = useId();
  const titleId = useId();
  const close = () => {
    setOpen(false);
    setPinned(false);
    (tab === "Players" ? playersTrigger : tab === "Night" ? (phase === "day" && voting ? dayTrigger : nightTrigger) : tab === "Info" ? infoTrigger : trigger).current?.focus({ preventScroll: true });
  };

  // Each new Night opens once. Closing/switching tabs is a lasting choice for
  // that Night, and returning from Privacy never reopens private content.
  useEffect(() => {
    if (!enabled || !nightKey || openedNight.current === nightKey) return;
    openedNight.current = nightKey;
    if (!privacyMode) { setTab("Night"); setOpen(true); }
  }, [nightKey, enabled, privacyMode]);
  const hasNight = !!night;
  useEffect(() => {
    if (handledActorRequest.current === actionRequest) return;
    handledActorRequest.current = actionRequest;
    if (!enabled || privacyMode || !hasNight) return;
    setTab("Night"); setOpen(true); onPanelOpen?.();
  }, [actionRequest, enabled, privacyMode, hasNight, onPanelOpen]);
  useEffect(() => {
    if (handledNightRequest.current === nightOpenRequest) return;
    handledNightRequest.current = nightOpenRequest;
    if (!enabled || privacyMode || !hasNight) return;
    setTab("Night"); setOpen(true); onPanelOpen?.();
  }, [nightOpenRequest, enabled, privacyMode, hasNight, onPanelOpen]);
  useEffect(() => {
    if (!hasNight && tab === "Night") { setOpen(false); setPinned(false); setTab("Reference"); }
  }, [hasNight, tab]);

  useEffect(() => {
    if (privacyMode || !enabled) {
      setOpen(false);
      setSearch("");
    }
    // Keep a blank pinned footprint during Privacy Mode so concealed seats
    // don't move. Returning to the private view never reopens the panel.
    if (!privacyMode || !enabled) setPinned(false);
  }, [privacyMode, enabled]);

  useEffect(() => {
    if (!open || privacyMode || !enabled) return;
    // Focus the heading, not the search: opening on a tablet must not summon
    // the software keyboard and obscure the board.
    heading.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Modal layers own Escape. Non-modal action cards handle it at their
      // own event target; a mounted but hidden draft must not block Reference.
      if (Array.from(document.querySelectorAll('[aria-modal="true"]')).some(element => !element.closest('[hidden]'))) return;
      event.preventDefault();
      close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, privacyMode, enabled, tab]);

  if (!enabled) return <>{children}</>;
  const reserveSpace = pinned && (open || privacyMode);
  return <div className="reference-workspace" data-reference-pinned={reserveSpace || undefined}
    data-reference-open={(open && !privacyMode) || undefined} data-panel={tab.toLowerCase()}>
    {children}
    <div className="reference-edge" role="group" aria-label="Grimoire reference controls">
      {players && <button ref={playersTrigger} type="button" className="reference-edge-button" aria-label="Players"
        aria-expanded={open && tab === "Players" && !privacyMode} aria-controls={panelId} disabled={privacyMode}
        onClick={() => { if (open && tab === "Players") close(); else { setTab("Players"); setOpen(true); onPanelOpen?.(); } }}>
        <GrimoireIcon name="players" size={20} /><span>Players</span>
      </button>}
      {phase === "day" && voting ? <button ref={dayTrigger} type="button" className="reference-edge-button" aria-label="Day"
        disabled={privacyMode} aria-expanded={voting.surface === "history" && !privacyMode}
        onClick={() => { setOpen(false); setPinned(false); onPanelOpen?.(); voting.show("history"); }}>
        <GrimoireIcon name="day" size={20} /><span>Day</span>
      </button> : night && <button ref={nightTrigger} type="button" className="reference-edge-button" aria-label="Night"
        aria-expanded={open && tab === "Night" && !privacyMode} aria-controls={panelId} disabled={privacyMode}
        onClick={() => { if (open && tab === "Night") close(); else { setTab("Night"); setOpen(true); onPanelOpen?.(); } }}>
        <GrimoireIcon name="night" size={20} /><span>Night</span>
      </button>}
      {info && <button ref={infoTrigger} type="button" className="reference-edge-button" aria-label="Info"
        aria-expanded={open && tab === "Info" && !privacyMode} aria-controls={panelId} disabled={privacyMode}
        onClick={() => { if (open && tab === "Info") close(); else { setTab("Info"); setOpen(true); onPanelOpen?.(); } }}>
        <GrimoireIcon name="info" size={20} /><span>Info</span>
      </button>}
      <button ref={trigger} type="button" className="reference-edge-button" aria-label="Reference"
        aria-expanded={open && tab === "Reference" && !privacyMode} aria-controls={panelId} disabled={privacyMode}
        title={privacyMode ? "Reference is hidden in Privacy Mode" : "Character reference"}
        onClick={() => { if (open && tab === "Reference") close(); else { setTab("Reference"); setOpen(true); onPanelOpen?.(); } }}>
        <GrimoireIcon name="book" size={20} /><span>Reference</span>
      </button>
      {onEnd && <>
        <span className="reference-edge-divider" aria-hidden="true" />
        <button type="button" className="reference-edge-button reference-end-button" aria-label="End game"
          disabled={privacyMode || endDisabled}
          onClick={() => { setOpen(false); setPinned(false); onPanelOpen?.(); onEnd(); }}>
          <GrimoireIcon name="flag" size={18} /><span>End</span>
        </button>
      </>}
    </div>
    {!privacyMode && <aside id={panelId} className="reference-panel" aria-labelledby={titleId} hidden={!open}>
      <header className="reference-header">
        <div className="reference-title">
          <h2 id={titleId} ref={heading} tabIndex={-1}>{tab === "Info" ? "Game" : tab}</h2>
          {tab !== "Night" && <p>{scriptName}{tab === "Reference" ? ` · ${roles.length} characters` : ""}</p>}
        </div>
        <button type="button" className="reference-icon-button" aria-label={pinned ? `Unpin ${tab} panel` : `Pin ${tab} panel`}
          aria-pressed={pinned} title={pinned ? "Unpin to overlay the board" : "Pin to make room beside the board"}
          onClick={() => setPinned(value => !value)}><PinIcon /></button>
        <button type="button" className="reference-icon-button" aria-label={`Close ${tab} panel`} onClick={close}><GrimoireIcon name="close" size={16} strokeWidth={1.8} /></button>
      </header>
      {tab === "Info" && open && info}
      {tab === "Info" && open && phase === "ended" && onReviewHistory && <button type="button" className="players-text-button reference-history-button"
        onClick={() => { close(); onReviewHistory(); }}>History &amp; activity</button>}
      {tab === "Reference" && <ReferenceBody roles={roles} search={search} onSearch={setSearch} />}
      {tab === "Players" && players?.(() => { if (!pinned) close(); })}
      {night && <div className="reference-night-content" hidden={tab !== "Night"}>
        {night(open && tab === "Night", close)}
      </div>}
    </aside>}
  </div>;
}
