import { useEffect, useMemo, useState } from "react";
import { usePlayerStore } from "@/stores/playerStore";
import { connectFirebase } from "@/firebase/session";
import { isFirebaseConfigured, getConfigSource } from "@/firebase/config";
import { applyJoinIntent, joinLobby, leaveLobby, usePlayerSync } from "@/firebase/playerSync";
import { lifecycleMessage } from "@/firebase/lifecycle";
import { FirebaseConfigDialog } from "@/features/firebase/FirebaseConfigDialog";
import type { RoomBackend } from "@/firebase/backend";
import { lookupOfficialRole } from "@/data/officialRoles";
import { getBuiltinScript } from "@/data/scripts";
import { iconUrlFor } from "@/data/iconUrl";
import type { PublicLobbyRecord, RoleDef } from "@/stores/types";
import { SeatNotePopup } from "./SeatNotePopup";
import { SeatNotePreview } from "./SeatNotePreview";
import { PlayerTabs } from "./PlayerTabs";
import { AlmanacBody } from "@/features/almanac/AlmanacBody";
import { RemoteScreenBoundary } from "@/features/remote/RemoteScreenBoundary";
import { DATA_ERROR_MESSAGE, CONNECTION_ERROR_MESSAGE } from "@/firebase/snapshots";

type PlayerTab = "role" | "town" | "almanac";

type Props = {
  initialCode?: string;
};

export function PlayerScreen({ initialCode }: Props) {
  return <RemoteScreenBoundary><PlayerScreenContent initialCode={initialCode} /></RemoteScreenBoundary>;
}

function PlayerScreenContent({ initialCode }: Props) {
  const status = usePlayerStore((s) => s.status);
  const code = usePlayerStore((s) => s.code);
  const requestedName = usePlayerStore((s) => s.requestedName);
  const playerId = usePlayerStore((s) => s.playerId);
  const self = usePlayerStore((s) => s.self);
  const publicLobby = usePlayerStore((s) => s.publicLobby);
  const revealed = usePlayerStore((s) => s.revealed);
  const error = usePlayerStore((s) => s.error);
  const remoteData = usePlayerStore((s) => s.remoteData);

  const setRevealed = usePlayerStore((s) => s.setRevealed);
  const reset = usePlayerStore((s) => s.reset);

  const [retry, setRetry] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [backend, setBackend] = useState<RoomBackend | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PlayerTab>("role");

  useEffect(() => {
    let mounted = true;
    if (!isFirebaseConfigured()) {
      if (getConfigSource() === "env") {
        usePlayerStore.getState().setStatus("error", "Unable to connect — contact your Storyteller.");
      } else {
        setConfigOpen(true);
      }
      return;
    }
    (async () => {
      try {
        const { backend: b, uid } = await connectFirebase();
        if (!mounted) return;
        applyJoinIntent(retry === 0 ? initialCode : undefined, uid);
        setBackend(b);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[player connect]", e instanceof Error ? e.message : e);
        usePlayerStore
          .getState()
          .setStatus("error", lifecycleMessage(e));
      }
    })();
    return () => {
      mounted = false;
    };
  }, [initialCode, retry]);

  usePlayerSync(backend, retry);

  const leave = async () => {
    if (!backend || leaving) return;
    setLeaving(true);
    try { await leaveLobby(backend); }
    catch (error) { usePlayerStore.getState().setStatus("error", lifecycleMessage(error)); }
    finally { setLeaving(false); }
  };

  // Script characters — used by Town note popup and Almanac tab.
  const scriptCharacters = useMemo((): RoleDef[] => {
    if (!publicLobby?.scriptId) return [];
    return getBuiltinScript(publicLobby.scriptId)?.characters ?? [];
  }, [publicLobby?.scriptId]);

  // Almanac roles: script + active Fabled + active Lorics + seated Travelers.
  const playerAlmanacRoles = useMemo((): RoleDef[] => {
    if (!publicLobby) return scriptCharacters;
    const roles: RoleDef[] = [...scriptCharacters];

    for (const id of publicLobby.fabled ?? []) {
      const r = lookupOfficialRole(id);
      if (r) roles.push(r);
    }
    for (const id of publicLobby.lorics ?? []) {
      const r = lookupOfficialRole(id);
      if (r) roles.push(r);
    }

    const seenTravelerIds = new Set<string>();
    for (const p of Object.values(publicLobby.players)) {
      if (p.isTraveler && p.publicDisplayRole && !seenTravelerIds.has(p.publicDisplayRole)) {
        const r = lookupOfficialRole(p.publicDisplayRole);
        if (r) { roles.push(r); seenTravelerIds.add(p.publicDisplayRole); }
      }
    }

    return roles;
  }, [scriptCharacters, publicLobby]);

  const onJoinSubmit = async (joinCode: string, name: string) => {
    if (!backend) {
      usePlayerStore
        .getState()
        .setStatus("error", "Not connected to Firebase yet — try again in a moment.");
      return;
    }
    try {
      const { uid } = await connectFirebase();
      await joinLobby(backend, joinCode, uid, name);
      const joinedCode = usePlayerStore.getState().code;
      if (joinedCode) window.history.replaceState(null, "", `?join=${encodeURIComponent(joinedCode)}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[joinSubmit]", e instanceof Error ? e.message : e);
      usePlayerStore
        .getState()
        .setStatus("error", lifecycleMessage(e));
    }
  };

  if (configOpen && getConfigSource() !== "env") {
    return (
      <div className="player">
        <h1 className="home-title">Silverwick Hallow</h1>
        <p className="home-subtitle">Configure Firebase to join a lobby.</p>
        <FirebaseConfigDialog
          onClose={() => setConfigOpen(false)}
          onSaved={async () => {
            try {
              const { backend: b } = await connectFirebase();
              setBackend(b);
              setConfigOpen(false);
            } catch {
              // Stay in config view if connect fails
            }
          }}
        />
      </div>
    );
  }

  if (status === "ended") {
    return (
      <div className="player player-status">
        <h2 className="title">Game ended</h2>
        <p className="behavior-help">
          The Storyteller has ended the game. Thanks for playing!
        </p>
        <button className="btn" onClick={() => reset()}>
          Back to start
        </button>
      </div>
    );
  }

  if (!code || status === "idle" || status === "configuring") {
    return (
      <div className="player">
        <h1 className="home-title">Join lobby</h1>
        <PlayerJoinForm
          initialCode={initialCode ?? ""}
          onSubmit={onJoinSubmit}
        />
        {error && (
          <div className="error-list" role="alert">
            <strong>Error:</strong>
            <p>{error}</p>
          </div>
        )}
      </div>
    );
  }

  if (status === "connecting" || status === "knocking" || status === "reconnecting") {
    return (
      <div className="player player-status">
        <h2 className="title">Connecting…</h2>
      </div>
    );
  }

  const remoteFailure = Object.values(remoteData).find((value) => value === "invalid" || value === "error");
  if (remoteFailure) {
    return (
      <div className="player player-status" role="alert">
        <h2>Game data unavailable</h2>
        <p>{remoteFailure === "invalid" ? DATA_ERROR_MESSAGE : CONNECTION_ERROR_MESSAGE}</p>
        <button className="btn" onClick={() => setRetry(value => value + 1)}>Retry connection</button>
        <button className="btn" onClick={leave} disabled={leaving}>Cancel / request to leave</button>
      </div>
    );
  }

  if (status === "waiting") {
    return (
      <div className="player player-status">
        <h2 className="title">Joined as {requestedName}</h2>
        <p className="behavior-help">
          Code: <strong>{code}</strong>. Waiting for the Storyteller to seat you.
        </p>
        <button
          className="btn btn-sm btn-danger"
          onClick={leave}
          disabled={leaving}
        >
          Leave
        </button>
      </div>
    );
  }

  if (status === "error" || status === "rejected" || status === "revoked" || status === "notFound" || status === "leaving") {
    return (
      <div className="player player-status">
        <h2 className="title">{status === "leaving" ? "Waiting for the Storyteller to confirm your departure" : "Lobby unavailable"}</h2>
        <div className="error-list" role="alert">
          <strong>Error:</strong>
          <p>{error}</p>
        </div>
        {status === "error" && <button className="btn" onClick={() => setRetry(value => value + 1)}>Retry connection</button>}
        {status !== "leaving" && <button className="btn" onClick={status === "error" ? leave : reset} disabled={leaving}>
          {status === "error" ? "Cancel / request to leave" : "Back to start"}
        </button>}
      </div>
    );
  }

  if (!publicLobby) {
    return <div className="player player-status" role="status"><h2>Waiting for game data…</h2><p>The Storyteller's game is synchronizing.</p></div>;
  }

  // Seated
  return (
    <div className="player player-seated">
      <header className="player-header">
        <span className="label">{requestedName}</span>
        <span className="label">Code {code}</span>
        <span className="label">{publicLobby?.phase ?? "—"}</span>
      </header>

      <button className="btn btn-sm" onClick={leave} disabled={leaving}>Request to leave lobby</button>
      <PlayerTabs active={activeTab} onChange={setActiveTab} />

      {activeTab === "role" && (
        <SealedCard
          self={self}
          revealed={revealed}
          onReveal={() => setRevealed(true)}
          onHide={() => setRevealed(false)}
        />
      )}

      {activeTab === "town" && (
        <TownView
          publicLobby={publicLobby}
          ownPlayerId={playerId}
          code={code}
          scriptCharacters={scriptCharacters}
        />
      )}

      {activeTab === "almanac" && (
        <div className="player-almanac-panel">
          <AlmanacBody roles={playerAlmanacRoles} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Join form
// ---------------------------------------------------------------------------

function PlayerJoinForm({
  initialCode,
  onSubmit,
}: {
  initialCode: string;
  onSubmit: (code: string, name: string) => Promise<void> | void;
}) {
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async () => {
    if (!code.trim()) { setFormError("Enter a lobby code."); return; }
    if (!name.trim()) { setFormError("Enter your name."); return; }
    setFormError(null);
    setSubmitting(true);
    try {
      await onSubmit(code, name);
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") submit();
  };

  return (
    <div className="player-join-form">
      <label className="field">
        <span className="field-label">Lobby code</span>
        <input
          className="input"
          value={code}
          onChange={(e) => { setCode(e.target.value.toUpperCase()); setFormError(null); }}
          onKeyDown={handleKeyDown}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={9}
          placeholder="XXXX-XXXX"
        />
      </label>
      <label className="field">
        <span className="field-label">Your name</span>
        <input
          className="input"
          value={name}
          onChange={(e) => { setName(e.target.value); setFormError(null); }}
          onKeyDown={handleKeyDown}
          autoCapitalize="words"
          maxLength={20}
          placeholder="Bob"
        />
      </label>
      {formError && (
        <p className="field-error" role="alert">
          {formError}
        </p>
      )}
      <button className="btn btn-gold" onClick={submit} disabled={submitting}>
        {submitting ? "Knocking…" : "Knock to join"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wiki link helper
// ---------------------------------------------------------------------------

function wikiUrlFor(name: string): string {
  const slug = name
    .trim()
    .replace(/['']/g, "")
    .replace(/[^A-Za-z0-9 _-]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .join("_");
  return `https://wiki.bloodontheclocktower.com/${slug}`;
}

// ---------------------------------------------------------------------------
// SealedCard — role reveal + per-bluff tap-to-reveal
// ---------------------------------------------------------------------------

function SealedCard({
  self,
  revealed,
  onReveal,
  onHide,
}: {
  self: { shownRole: string; shownAlignment: "good" | "evil"; bluffs?: string[]; fakeMinions?: string[] } | null;
  revealed: boolean;
  onReveal: () => void;
  onHide: () => void;
}) {
  const [waitedLong, setWaitedLong] = useState(false);
  const [revealedBluffs, setRevealedBluffs] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (self !== null) { setWaitedLong(false); return; }
    const t = setTimeout(() => setWaitedLong(true), 5000);
    return () => clearTimeout(t);
  }, [self]);

  const bluffsKey = (self?.bluffs ?? []).join("|");
  useEffect(() => {
    setRevealedBluffs(new Set());
  }, [bluffsKey]);

  if (!self) {
    return (
      <div className="sealed-card">
        <p className="behavior-help">
          The Storyteller hasn't sent your role yet.
        </p>
        {waitedLong && (
          <p className="behavior-help" style={{ marginTop: 8, opacity: 0.7 }}>
            Still waiting — the Storyteller may still be setting up.
          </p>
        )}
      </div>
    );
  }

  const role = lookupOfficialRole(self.shownRole);
  const roleName = role?.name ?? self.shownRole;
  const roleType = role?.type ?? "townsfolk";

  return (
    <div className="sealed-card-wrap">
      <button
        className={`sealed-card${revealed ? " revealed" : ""}`}
        onClick={revealed ? onHide : onReveal}
        aria-label={revealed ? "Tap to seal your role" : "Tap to reveal your role"}
      >
        {!revealed ? (
          <span className="sealed-card-back">Tap to reveal your role</span>
        ) : (
          <>
            <div className="sealed-card-art">
              <img
                src={iconUrlFor(role ?? self.shownRole)}
                alt=""
                loading="lazy"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            </div>
            <div className="sealed-card-name">
              {roleName}
              <span className={`label type-${roleType}`}>{roleType}</span>
              <span className={`label alignment-${self.shownAlignment}`}>
                {self.shownAlignment}
              </span>
            </div>
            {role?.ability && <p className="sealed-card-ability">{role.ability}</p>}
            {role?.flavor && <p className="sealed-card-flavor">{role.flavor}</p>}
            <span className="sealed-card-seal-hint">tap to seal</span>
          </>
        )}
      </button>

      {revealed && (
        <div className="sealed-card-extras">
          <a
            className="sealed-card-wiki"
            href={wikiUrlFor(roleName)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Wiki ↗
          </a>
          {self.bluffs && self.bluffs.length > 0 && (
            <div className="sealed-card-bluffs">
              <span className="label">Demon bluffs — tap to reveal individually</span>
              <div className="bluff-reveal-grid">
                {self.bluffs.map((b, i) => {
                  const r = lookupOfficialRole(b);
                  const open = revealedBluffs.has(i);
                  return (
                    <button
                      key={`${i}-${b}`}
                      type="button"
                      className={`bluff-reveal-card ${open ? "revealed" : ""}`}
                      onClick={() => {
                        setRevealedBluffs((prev) => {
                          const next = new Set(prev);
                          if (next.has(i)) next.delete(i);
                          else next.add(i);
                          return next;
                        });
                      }}
                      aria-label={`Bluff ${i + 1}${open ? "" : " — tap to reveal"}`}
                    >
                      {open ? (
                        <span className="bluff-reveal-name">{r?.name ?? b}</span>
                      ) : (
                        <>
                          <span className="bluff-reveal-q">?</span>
                          <span className="bluff-reveal-hint">Bluff {i + 1}</span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Town view — roster, online dot, per-seat notes (no neighbour subtitles)
// ---------------------------------------------------------------------------

function TownView({
  publicLobby,
  ownPlayerId,
  code,
  scriptCharacters,
}: {
  publicLobby: PublicLobbyRecord | null;
  ownPlayerId: string | null;
  code: string;
  scriptCharacters: RoleDef[];
}) {
  const townNotes = usePlayerStore((s) => s.townNotes);
  const setTownNote = usePlayerStore((s) => s.setTownNote);
  const [noteTarget, setNoteTarget] = useState<string | null>(null);

  const roleById = useMemo(
    () => new Map(scriptCharacters.map((r) => [r.id, r])),
    [scriptCharacters]
  );

  const counts = useMemo(() => {
    if (!publicLobby) return { alive: 0, dead: 0, online: 0, total: 0 };
    let alive = 0, dead = 0, online = 0;
    for (const id of publicLobby.seatOrder) {
      const p = publicLobby.players[id];
      if (!p) continue;
      if (p.alive) alive++;
      else dead++;
      if (p.online) online++;
    }
    return { alive, dead, online, total: publicLobby.seatOrder.length };
  }, [publicLobby]);

  if (!publicLobby) return null;

  const noteTargetPlayer = noteTarget
    ? publicLobby.players[noteTarget]
    : null;

  return (
    <div className="town-view">
      <div className="town-view-header">
        <h3 className="drawer-section-title" style={{ margin: 0 }}>Town</h3>
        <span className="label">{counts.alive}/{counts.total} alive</span>
        <span className="label">{counts.online}/{counts.total} online</span>
      </div>

      <ul className="town-list">
        {publicLobby.seatOrder.map((id) => {
          const p = publicLobby.players[id];
          if (!p) return null;
          const isYou = id === ownPlayerId;
          const nKey = `${code}:${id}`;
          const note = townNotes[nKey] ?? null;

          return (
            <li
              key={id}
              className={`town-row ${p.alive ? "" : "dead"} ${isYou ? "you" : ""}`}
            >
              <button
                type="button"
                className="town-row-main"
                onClick={() => {
                  if (!isYou) setNoteTarget(id);
                }}
                aria-label={`${p.name} — tap to add notes`}
              >
                <span className="label town-row-seat">seat {p.seat + 1}</span>
                <span className="town-name">
                  {p.name}
                  {isYou && " (you)"}
                </span>
                <span className="town-row-meta">
                  <span
                    className={`town-presence ${p.online ? "online" : "offline"}`}
                    title={p.online ? "Online" : "Offline"}
                    aria-label={p.online ? "Online" : "Offline"}
                  />
                  <span className="label">{p.alive ? "alive" : "dead"}</span>
                </span>
              </button>
              {note && (note.roles.length > 0 || note.confidence) && (
                <SeatNotePreview note={note} roleById={roleById} />
              )}
              {note?.text && (
                <p className="town-row-note">{note.text}</p>
              )}
            </li>
          );
        })}
      </ul>

      <p className="town-legend">Tap a seat to add private notes</p>

      {noteTarget && noteTargetPlayer && (
        <SeatNotePopup
          playerName={noteTargetPlayer.name}
          scriptCharacters={scriptCharacters}
          note={townNotes[`${code}:${noteTarget}`] ?? null}
          onSave={(next) => setTownNote(code, noteTarget, next)}
          onClose={() => setNoteTarget(null)}
        />
      )}
    </div>
  );
}
