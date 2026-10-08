import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { RoleDef } from "@/stores/types";
import { ReferenceBody } from "./ReferenceBody";

function BookIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15" />
  </svg>;
}

function PinIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M8 3h8l-1 7 3 4H6l3-4-1-7Zm4 11v7" />
  </svg>;
}

/** A local presentation boundary. Pinning changes available space, never game state. */
export function ReferenceWorkspace({ children, enabled, privacyMode, roles, scriptName, players, night, nightKey, nightOpenRequest = 0, onPanelOpen }: {
  children: ReactNode; enabled: boolean; privacyMode: boolean; roles: RoleDef[]; scriptName: string;
  players?: (dismiss: () => void) => ReactNode;
  night?: (visible: boolean, close: () => void) => ReactNode;
  nightKey?: string;
  /** Explicit navigation (for example, Review Night at dawn), never game state. */
  nightOpenRequest?: number;
  onPanelOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"Reference" | "Players" | "Night">("Reference");
  const [pinned, setPinned] = useState(false);
  const [search, setSearch] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const playersTrigger = useRef<HTMLButtonElement>(null);
  const nightTrigger = useRef<HTMLButtonElement>(null);
  const openedNight = useRef<string | undefined>();
  const handledNightRequest = useRef(nightOpenRequest);
  const heading = useRef<HTMLHeadingElement>(null);
  const panelId = useId();
  const titleId = useId();
  const close = () => {
    setOpen(false);
    setPinned(false);
    (tab === "Players" ? playersTrigger : tab === "Night" ? nightTrigger : trigger).current?.focus({ preventScroll: true });
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
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="9" cy="7" r="3"/><path d="M3 21v-4a6 6 0 0 1 12 0v4M17 4a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 5v2"/></svg><span>Players</span>
      </button>}
      {night && <button ref={nightTrigger} type="button" className="reference-edge-button" aria-label="Night"
        aria-expanded={open && tab === "Night" && !privacyMode} aria-controls={panelId} disabled={privacyMode}
        onClick={() => { if (open && tab === "Night") close(); else { setTab("Night"); setOpen(true); onPanelOpen?.(); } }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z" /></svg><span>Night</span>
      </button>}
      <button ref={trigger} type="button" className="reference-edge-button" aria-label="Reference"
        aria-expanded={open && tab === "Reference" && !privacyMode} aria-controls={panelId} disabled={privacyMode}
        title={privacyMode ? "Reference is hidden in Privacy Mode" : "Character reference"}
        onClick={() => { if (open && tab === "Reference") close(); else { setTab("Reference"); setOpen(true); onPanelOpen?.(); } }}>
        <BookIcon /><span>Reference</span>
      </button>
    </div>
    {!privacyMode && <aside id={panelId} className="reference-panel" aria-labelledby={titleId} hidden={!open}>
      <header className="reference-header">
        <div className="reference-title">
          <h2 id={titleId} ref={heading} tabIndex={-1}>{tab}</h2>
          {tab !== "Night" && <p>{scriptName}{tab === "Reference" ? ` · ${roles.length} characters` : ""}</p>}
        </div>
        <button type="button" className="reference-icon-button" aria-label={pinned ? `Unpin ${tab} panel` : `Pin ${tab} panel`}
          aria-pressed={pinned} title={pinned ? "Unpin to overlay the board" : "Pin to make room beside the board"}
          onClick={() => setPinned(value => !value)}><PinIcon /></button>
        <button type="button" className="reference-icon-button" aria-label={`Close ${tab} panel`} onClick={close}>×</button>
      </header>
      {tab === "Reference" && <ReferenceBody roles={roles} search={search} onSearch={setSearch} />}
      {tab === "Players" && players?.(() => { if (!pinned) close(); })}
      {night && <div className="reference-night-content" hidden={tab !== "Night"}>
        {night(open && tab === "Night", close)}
      </div>}
    </aside>}
  </div>;
}
