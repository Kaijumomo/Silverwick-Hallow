import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStorytellerStore, selectScriptById } from "@/stores/storytellerStore";
import { deriveAlignment } from "@/data/roleRegistry";
import { TRAVELERS } from "@/data/travelers";
import { needsShownIdentity } from "@/stores/identity";
import { PlayerInformation } from "./PlayerInformation";
import { getPrivateInfoApplicability } from "@/stores/privatePackets";
import { roleAuthority } from "@/data/canonical";
import { evilInformationPolicy } from "@/features/nightOrder/nightRules";
import { buildRegistry } from "@/data/roleRegistry";
import { useModalBehavior } from "@/components/Modal";
import { usePrivacyStore } from "@/stores/privacyStore";
import type {
  Alignment,
  BehaviorMode,
  RoleDef,
  RoleType,
  STPlayerRecord,
} from "@/stores/types";

const STATUSES = ["drunk", "poisoned", "protected"] as const;
const TYPE_ORDER: RoleType[] = [
  "townsfolk",
  "outsider",
  "minion",
  "demon",
  "traveler",
  "fabled",
  "loric",
];

const REMINDER_PRESETS = [
  "Used",
  "Drunk",
  "Poisoned",
  "Protected",
  "Mad",
  "Knows",
  "Did not act",
  "Dies tonight",
];

const BEHAVIOR_MODES: { value: BehaviorMode; label: string; help: string }[] = [
  { value: "normal", label: "Normal", help: "Acts as their actual role." },
  {
    value: "drunk_fake_role_behavior",
    label: "Drunk (fake role)",
    help: "Believes they are their shown role. Follow its simulated wake and choose the information manually; no truthful result is computed.",
  },
  {
    value: "fake_demon_behavior",
    label: "Fake demon (Lunatic)",
    help: "Believes they are the demon. Wake at demon times; give fake bluffs and (optionally) fake minions.",
  },
  {
    value: "marionette_fake_good_behavior",
    label: "Fake good (Marionette)",
    help: "Follows the shown good character's simulated wake. Excluded from the normal Minion introduction.",
  },
  {
    value: "poisoned",
    label: "Poisoned",
    help: "Use the Poisoned status chip for nightly poisoning. Use this mode only for ongoing fake-info behavior.",
  },
  { value: "custom", label: "Custom", help: "Track manually with notes." },
];

function groupByType(roles: RoleDef[]) {
  const out: Record<RoleType, RoleDef[]> = {
    townsfolk: [],
    outsider: [],
    minion: [],
    demon: [],
    traveler: [],
    fabled: [],
    loric: [],
  };
  for (const r of roles) out[r.type].push(r);
  return out;
}

function RolePickerGrid({
  roles,
  selectedRoleId,
  onPick,
  filter,
}: {
  roles: RoleDef[];
  selectedRoleId: string | null;
  onPick: (id: string) => void;
  filter?: (r: RoleDef) => boolean;
}) {
  const filtered = filter ? roles.filter(filter) : roles;
  const grouped = groupByType(filtered);
  return (
    <div className="role-picker">
      {TYPE_ORDER.map((t) => {
        const list = grouped[t];
        if (!list.length) return null;
        return (
          <div key={t}>
            <div className={`role-picker-group-title type-${t}`}>{t}</div>
            <div className="role-picker-grid">
              {list.map((r) => (
                <button
                  key={r.id}
                  className={`role-card ${selectedRoleId === r.id ? "selected" : ""}`}
                  onClick={() => onPick(r.id)}
                  title={r.ability}
                >
                  <span className={`role-card-name type-${r.type}`}>{r.name}</span>
                  <span className="role-card-type">{r.type}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function shownRoleFilter(behavior: BehaviorMode): ((r: RoleDef) => boolean) | undefined {
  if (behavior === "drunk_fake_role_behavior")
    return (r) => r.type === "townsfolk";
  if (behavior === "fake_demon_behavior") return (r) => r.type === "demon";
  if (behavior === "marionette_fake_good_behavior")
    return (r) => r.type === "townsfolk" || r.type === "outsider";
  return undefined;
}

type PlayerDrawerProps = {
  player: STPlayerRecord;
  onRemove?: (id: string) => Promise<void> | void;
  onUnseat?: (id: string) => Promise<void> | void;
};

function DrawerShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const drawerRef = useRef<HTMLElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  useModalBehavior(drawerRef, layerRef, onClose);
  return <div ref={layerRef}>
    <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
    <aside ref={drawerRef} className="drawer" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
      {children}
    </aside>
  </div>;
}

function PrivacySafeContents({ player, onClose }: { player: STPlayerRecord; onClose: () => void }) {
  return <>
    <div className="drawer-header">
      <span className="drawer-name privacy-safe-name">Player</span>
      <button className="btn btn-sm" onClick={onClose} aria-label="Close">✕</button>
    </div>
    <div className="drawer-body">
      <section className="drawer-section">
        <h3 className="drawer-section-title">Safe view</h3>
        <p className="privacy-safe-player-name">{player.name || "Unnamed player"}</p>
        <div className="drawer-row">
          <span className="label">seat {player.seat + 1}</span>
          <span className="label">{player.alive ? "Alive" : "Dead"}</span>
        </div>
        <p className="behavior-help">Storyteller details are hidden while Privacy Mode is on.</p>
      </section>
    </div>
  </>;
}

export function PlayerDrawer({ player, onRemove, onUnseat }: PlayerDrawerProps) {
  const game = useStorytellerStore((s) => s.game);
  const script = useStorytellerStore((s) =>
    game ? selectScriptById(s, game.scriptId) : undefined
  );
  const selectPlayer = useStorytellerStore((s) => s.selectPlayer);
  const renamePlayer = useStorytellerStore((s) => s.renamePlayer);
  const removePlayer = useStorytellerStore((s) => s.removePlayer);
  const movePlayer = useStorytellerStore((s) => s.movePlayer);
  const assignRole = useStorytellerStore((s) => s.assignRole);
  const showAssignedRole = useStorytellerStore((s) => s.showAssignedRole);
  const setShownRole = useStorytellerStore((s) => s.setShownRole);
  const setShownAlignment = useStorytellerStore((s) => s.setShownAlignment);
  const setBehaviorMode = useStorytellerStore((s) => s.setBehaviorMode);
  const setBluffs = useStorytellerStore((s) => s.setBluffs);
  const setFakeMinions = useStorytellerStore((s) => s.setFakeMinions);
  const setIsTraveler = useStorytellerStore((s) => s.setIsTraveler);
  const setAlive = useStorytellerStore((s) => s.setAlive);
  const setGhostVote = useStorytellerStore((s) => s.setGhostVote);
  const setAbilityUsed = useStorytellerStore((s) => s.setAbilityUsed);
  const setStatus = useStorytellerStore((s) => s.setStatus);
  const setReminders = useStorytellerStore((s) => s.setReminders);
  const setNotes = useStorytellerStore((s) => s.setNotes);
  const privacyMode = usePrivacyStore((s) => s.enabled);

  const [nameDraft, setNameDraft] = useState(player.name);
  const [reminderDraft, setReminderDraft] = useState("");
  const [membershipBusy, setMembershipBusy] = useState(false);
  const [membershipError, setMembershipError] = useState<string | null>(null);
  useEffect(() => {
    setNameDraft(player.name);
  }, [player.id, player.name]);

  const roleById = useMemo(
    () => new Map((script?.characters ?? []).map((c) => [c.id, c])),
    [script]
  );
  const registry = useMemo(() => script ? buildRegistry(script) : null, [script]);
  const applicability = registry ? getPrivateInfoApplicability(player, registry) : null;

  // Roles currently assigned to any player — used to exclude from bluff pickers.
  const inPlayRoles = useMemo(
    () =>
      new Set(
        Object.values(game?.players ?? {})
          .map((p) => p.actualRole)
          .filter(Boolean)
      ),
    [game?.players]
  );

  if (!game || !script) return null;
  if (privacyMode) return <DrawerShell title={`Player ${player.name}`} onClose={() => selectPlayer(null)}>
    <PrivacySafeContents player={player} onClose={() => selectPlayer(null)} />
  </DrawerShell>;
  const role = player.actualRole ? roleById.get(player.actualRole) : undefined;
  const shownRoleDef = player.shownRole ? roleById.get(player.shownRole) ?? TRAVELERS.find(r => r.id === player.shownRole) : undefined;

  // When traveler, look up role from traveler list instead of script.
  const travelerRoleDef = player.isTraveler && player.actualRole
    ? TRAVELERS.find((t) => t.id === player.actualRole)
    : undefined;

  const displayRole = role ?? travelerRoleDef;

  const close = () => selectPlayer(null);

  const commitName = () => {
    if (nameDraft.trim() && nameDraft.trim() !== player.name) {
      renamePlayer(player.id, nameDraft);
    } else {
      setNameDraft(player.name);
    }
  };

  const addReminder = (text: string) => {
    const t = text.trim();
    if (!t) return;
    setReminders(player.id, [...player.reminders, t]);
    setReminderDraft("");
  };
  const removeReminder = (idx: number) => {
    setReminders(
      player.id,
      player.reminders.filter((_, i) => i !== idx)
    );
  };

  const runMembershipAction = async (action: () => Promise<void> | void) => {
    if (membershipBusy) return;
    setMembershipError(null);
    setMembershipBusy(true);
    try {
      await action();
      selectPlayer(null);
    } catch (e) {
      setMembershipError(e instanceof Error ? e.message : "Could not update this player's membership.");
    } finally {
      setMembershipBusy(false);
    }
  };

  const effectiveAlignment: Alignment | "—" = (() => {
    if (!player.shownRole) return "—";
    if (player.shownAlignment) return player.shownAlignment;
    const ref = shownRoleDef;
    return ref ? deriveAlignment(ref) : "—";
  })();

  // Role pool for the main "Actual role" picker.
  const rolePool = player.isTraveler ? TRAVELERS : script.characters;

  return (
    <DrawerShell title="Player editor" onClose={close}>
        <div className="drawer-header">
          <input
            className="drawer-name"
            aria-label="Player name"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value.slice(0, 20))}
            onBlur={commitName}
            maxLength={20}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setNameDraft(player.name);
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          <button className="btn btn-sm" onClick={close} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="drawer-body">
          <section className="drawer-section">
            <h3 className="drawer-section-title">Seat</h3>
            <div className="drawer-row">
              <button
                className="btn btn-sm"
                onClick={() => movePlayer(player.id, "left")}
              >
                ← move
              </button>
              <span className="label">seat {player.seat + 1}</span>
              <button
                className="btn btn-sm"
                onClick={() => movePlayer(player.id, "right")}
              >
                move →
              </button>
            </div>
          </section>

          <section className="drawer-section">
            <h3 className="drawer-section-title">State</h3>
            <div className="drawer-row">
              <button
                className="toggle-pill"
                aria-pressed={player.alive}
                onClick={() => setAlive(player.id, !player.alive)}
              >
                {player.alive ? "Alive" : "Dead"}
              </button>
              {!player.alive && (
                <button
                  className="toggle-pill"
                  aria-pressed={player.ghostVote}
                  onClick={() => setGhostVote(player.id, !player.ghostVote)}
                >
                  Ghost vote {player.ghostVote ? "available" : "used"}
                </button>
              )}
              <button
                className="toggle-pill"
                aria-pressed={player.abilityUsed}
                onClick={() => setAbilityUsed(player.id, !player.abilityUsed)}
              >
                Ability used
              </button>
            </div>
            <div className="drawer-row">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  className="toggle-pill"
                  data-kind={s}
                  aria-pressed={!!player.statuses[s]}
                  onClick={() => setStatus(player.id, s, !player.statuses[s])}
                >
                  {s}
                </button>
              ))}
            </div>
          </section>

          <section className="drawer-section">
            <h3 className="drawer-section-title">Travel status</h3>
            <div className="drawer-row">
              <button
                className="toggle-pill"
                aria-pressed={player.isTraveler}
                onClick={() => setIsTraveler(player.id, !player.isTraveler)}
              >
                {player.isTraveler ? "Traveler" : "Not a traveler"}
              </button>
              {player.isTraveler && (
                <span className="behavior-help">
                  Role picker shows travelers only.
                </span>
              )}
            </div>
          </section>

          <section className="drawer-section">
            <h3 className="drawer-section-title">Actual role (ST private)</h3>
            {displayRole ? (
              <div className="role-display">
                <span className={`role-display-label type-${displayRole.type}`}>
                  {displayRole.name}
                </span>
                <span className="label">{displayRole.type}</span>
                {displayRole.ability && (
                  <p className="role-display-ability">{displayRole.ability}</p>
                )}
                <p className="behavior-help">{roleAuthority(displayRole)}</p>
              </div>
            ) : (
              <p className="behavior-help">No role assigned yet.</p>
            )}
            <RolePickerGrid
              roles={rolePool}
              selectedRoleId={player.actualRole || null}
              onPick={(id) => assignRole(player.id, id)}
            />
            <p className="behavior-help">Assigning an actual role keeps the player's shown identity unchanged.</p>
            {displayRole && !needsShownIdentity(player.actualRole) && (
              <button className="btn btn-sm" onClick={() => showAssignedRole(player.id)}>
                Show assigned role
              </button>
            )}
            {displayRole && (
              <div className="drawer-row">
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => assignRole(player.id, "")}
                >
                  Clear role
                </button>
              </div>
            )}
          </section>

          {displayRole && (
            <section className="drawer-section">
              <h3 className="drawer-section-title">
                Behavior &amp; deception
              </h3>
              <div className="behavior-row">
                <label htmlFor="behavior-mode">Mode:</label>
                <select
                  id="behavior-mode"
                  className="select"
                  value={player.behaviorMode}
                  onChange={(e) =>
                    setBehaviorMode(player.id, e.target.value as BehaviorMode)
                  }
                >
                  {BEHAVIOR_MODES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <p className="behavior-help">
                {BEHAVIOR_MODES.find((m) => m.value === player.behaviorMode)?.help}
              </p>

              <div className="behavior-row">
                <label>Shown role:</label>
                {shownRoleDef ? (
                  <span className={`role-display-label type-${shownRoleDef.type}`}>
                    {shownRoleDef.name}
                  </span>
                ) : (
                  <span className="behavior-help">Role not revealed yet</span>
                )}
                {shownRoleDef && (
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => setShownRole(player.id, null)}
                  >
                    clear
                  </button>
                )}
              </div>
              <RolePickerGrid
                roles={rolePool}
                selectedRoleId={player.shownRole}
                onPick={(id) => setShownRole(player.id, id)}
                filter={shownRoleFilter(player.behaviorMode)}
              />
              <p className="behavior-help">Choosing a shown role sends that identity when connected. Clearing it returns the player to waiting. Previously delivered information cannot be unseen.</p>

              <div className="behavior-row">
                <label>Shown alignment:</label>
                <button
                  className="toggle-pill"
                  aria-pressed={player.shownAlignment === null}
                  onClick={() => setShownAlignment(player.id, null)}
                >
                  auto ({effectiveAlignment})
                </button>
                <button
                  className="toggle-pill"
                  aria-pressed={player.shownAlignment === "good"}
                  onClick={() => setShownAlignment(player.id, "good")}
                >
                  good
                </button>
                <button
                  className="toggle-pill"
                  aria-pressed={player.shownAlignment === "evil"}
                  onClick={() => setShownAlignment(player.id, "evil")}
                >
                  evil
                </button>
              </div>
            </section>
          )}

          {role && applicability?.fakeMinions && (
            <LunaticInfo
              player={player}
              roles={script.characters}
              roleById={roleById}
              otherPlayers={Object.values(game.players)
                .filter((p) => p.id !== player.id)
                .sort((a, b) => a.seat - b.seat)}
              onSetBluffs={(b) => setBluffs(player.id, b)}
              onSetFakeMinions={(ids) => setFakeMinions(player.id, ids)}
            />
          )}

          {role?.type === "demon" && player.behaviorMode === "normal" && (
            <DemonInfo
              player={player}
              roles={script.characters}
              roleById={roleById}
              inPlayRoles={registry && evilInformationPolicy(Object.values(game.players), registry, game).allowInPlayBluffs ? new Set() : inPlayRoles}
              allowInPlay={!!registry && evilInformationPolicy(Object.values(game.players), registry, game).allowInPlayBluffs}
              onSetBluffs={(b) => setBluffs(player.id, b)}
            />
          )}

          <section className="drawer-section">
            <h3 className="drawer-section-title">Reminders</h3>
            <div className="reminder-list">
              {player.reminders.map((r, i) => (
                <span key={`${r}-${i}`} className="reminder-tag">
                  {r}
                  <button onClick={() => removeReminder(i)} aria-label={`Remove ${r}`}>
                    ×
                  </button>
                </span>
              ))}
              {player.reminders.length === 0 && (
                <span className="behavior-help">none</span>
              )}
            </div>
            <div className="reminder-add">
              <input
                className="input"
                placeholder="Add reminder…"
                value={reminderDraft}
                onChange={(e) => setReminderDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addReminder(reminderDraft);
                }}
              />
              <button
                className="btn btn-sm"
                onClick={() => addReminder(reminderDraft)}
                disabled={!reminderDraft.trim()}
              >
                add
              </button>
            </div>
            <div className="reminder-presets">
              {REMINDER_PRESETS.map((p) => (
                <button
                  key={p}
                  className="reminder-preset"
                  onClick={() => addReminder(p)}
                >
                  + {p}
                </button>
              ))}
            </div>
          </section>

          <section className="drawer-section">
            <h3 className="drawer-section-title">ST notes</h3>
            <textarea
              className="textarea"
              value={player.stNotes}
              onChange={(e) => setNotes(player.id, e.target.value)}
              placeholder="Private notes for this seat…"
            />
          </section>

          <section className="drawer-section">
            <h3 className="drawer-section-title">Danger zone</h3>
            <div className="drawer-row">
              <button
                className="btn btn-sm btn-danger"
                onClick={() => {
                  if (!window.confirm(`Remove ${player.name}?`)) return;
                  void runMembershipAction(() => onRemove ? onRemove(player.id) : void removePlayer(player.id));
                }}
                disabled={membershipBusy}
              >
                Remove player
              </button>
              <button
                className="btn btn-sm"
                onClick={() => {
                  if (!window.confirm(`Unseat ${player.name}?`)) return;
                  void runMembershipAction(() => onUnseat ? onUnseat(player.id) : void useStorytellerStore.getState().unseatPlayer(player.id));
                }}
                disabled={membershipBusy}
              >
                Unseat player
              </button>
            </div>
            {membershipError && <p className="field-error" role="alert">{membershipError}</p>}
          </section>
        </div>
    </DrawerShell>
  );
}

// ---------------------------------------------------------------------------
// Shared bluff slot picker
// ---------------------------------------------------------------------------

const BLUFF_SLOT_COUNT = 3;

type BluffSlotPickerProps = {
  bluffs: string[];
  rolePool: RoleDef[];
  roleById: Map<string, RoleDef>;
  onSetBluffs: (bluffs: string[]) => void;
  inPlayRoles?: Set<string>;
};

function BluffSlotPicker({
  bluffs,
  rolePool,
  roleById,
  onSetBluffs,
  inPlayRoles,
}: BluffSlotPickerProps) {
  const removeBluff = (idx: number) => {
    onSetBluffs(bluffs.filter((_, i) => i !== idx));
  };

  const addBluff = (id: string) => {
    if (bluffs.includes(id)) return;
    if (bluffs.length >= BLUFF_SLOT_COUNT) return;
    onSetBluffs([...bluffs, id]);
  };

  return (
    <>
      <div className="behavior-row">
        <label>Bluffs:</label>
        <span className="label">
          {bluffs.length} / {BLUFF_SLOT_COUNT}
        </span>
      </div>
      <div className="bluff-slots">
        {Array.from({ length: BLUFF_SLOT_COUNT }).map((_, i) => {
          const id = bluffs[i];
          const def = id ? roleById.get(id) : undefined;
          return (
            <div
              key={i}
              className={`bluff-slot ${def ? "filled" : "empty"}`}
            >
              {def ? (
                <>
                  <span className={`bluff-slot-name type-${def.type}`}>
                    {def.name}
                  </span>
                  <button
                    className="bluff-slot-clear"
                    aria-label={`Remove bluff ${def.name}`}
                    onClick={() => removeBluff(i)}
                  >
                    ×
                  </button>
                </>
              ) : (
                <span className="bluff-slot-empty">empty</span>
              )}
            </div>
          );
        })}
      </div>
      <RolePickerGrid
        roles={rolePool}
        selectedRoleId={null}
        onPick={addBluff}
        filter={(r) => !bluffs.includes(r.id) && !(inPlayRoles?.has(r.id))}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// DemonInfo
// ---------------------------------------------------------------------------

type DemonInfoProps = {
  allowInPlay?: boolean;
  player: STPlayerRecord;
  roles: RoleDef[];
  roleById: Map<string, RoleDef>;
  inPlayRoles: Set<string>;
  onSetBluffs: (bluffs: string[]) => void;
};

function DemonInfo({ player, roles, roleById, inPlayRoles, onSetBluffs, allowInPlay }: DemonInfoProps) {
  const bluffs = player.privateInfo?.bluffs ?? [];
  const goodPool = roles.filter(
    (r) => r.type === "townsfolk" || r.type === "outsider"
  );

  return (
    <section className="drawer-section">
      <h3 className="drawer-section-title">Demon bluffs (ST private)</h3>
      <p className="behavior-help">
        {allowInPlay ? "Pope: choose 3 good characters; in-play good characters may also be bluffs." : "Choose 3 good characters that are not in play."}
      </p>
      <BluffSlotPicker
        bluffs={bluffs}
        rolePool={goodPool}
        roleById={roleById}
        onSetBluffs={onSetBluffs}
        inPlayRoles={inPlayRoles}
      />
      <PlayerInformation playerId={player.id} purpose="setup" />
    </section>
  );
}

// ---------------------------------------------------------------------------
// LunaticInfo
// ---------------------------------------------------------------------------

type LunaticInfoProps = {
  player: STPlayerRecord;
  roles: RoleDef[];
  roleById: Map<string, RoleDef>;
  otherPlayers: STPlayerRecord[];
  onSetBluffs: (bluffs: string[]) => void;
  onSetFakeMinions: (ids: string[]) => void;
};

function LunaticInfo({
  player,
  roles,
  roleById,
  otherPlayers,
  onSetBluffs,
  onSetFakeMinions,
}: LunaticInfoProps) {
  const bluffs = player.privateInfo?.bluffs ?? [];
  const fakeMinions = player.privateInfo?.fakeMinions ?? [];

  const goodPool = roles.filter(
    (r) => r.type === "townsfolk" || r.type === "outsider"
  );

  const toggleMinion = (pid: string) => {
    if (fakeMinions.includes(pid)) {
      onSetFakeMinions(fakeMinions.filter((m) => m !== pid));
    } else {
      onSetFakeMinions([...fakeMinions, pid]);
    }
  };

  return (
    <section className="drawer-section">
      <h3 className="drawer-section-title">Demon setup information</h3>
      <p className="behavior-help">
        Choose the bluffs and players they will see as their Minions. Bluffs may be in play.
      </p>

      <BluffSlotPicker
        bluffs={bluffs}
        rolePool={goodPool}
        roleById={roleById}
        onSetBluffs={onSetBluffs}
      />

      <div className="behavior-row">
        <label>Players shown as Minions:</label>
        <span className="label">{fakeMinions.length} chosen</span>
      </div>
      {otherPlayers.length === 0 ? (
        <p className="behavior-help">No other players to choose from.</p>
      ) : (
        <div className="fake-minion-list">
          {otherPlayers.map((p) => (
            <button
              key={p.id}
              className="toggle-pill"
              aria-pressed={fakeMinions.includes(p.id)}
              onClick={() => toggleMinion(p.id)}
            >
              {p.name}{" "}
              <span className="label">seat {p.seat + 1}</span>
            </button>
          ))}
        </div>
      )}
      <details className="information-review">
        <summary>Additional setup information</summary>
        <label className="information-input">Information
          <textarea className="input" rows={2} maxLength={4000} value={player.privateInfo?.extraText ?? ""}
            onChange={event => useStorytellerStore.getState().setPrivateText(player.id, event.target.value)} />
        </label>
      </details>
      <PlayerInformation playerId={player.id} purpose="setup" />
    </section>
  );
}
