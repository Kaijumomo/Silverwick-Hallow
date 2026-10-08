import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { iconUrlFor } from "@/data/iconUrl";
import { resolvedCharacters } from "@/data/roleRegistry";
import { selectScriptById, useStorytellerStore } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { effectAccessibleSummary } from "@/stores/effectRegistry";
import { lifeStatusOf } from "@/stores/lifeState";
import type { STPlayerRecord } from "@/stores/types";
import { LifeControls } from "@/features/life/LifeControls";
import { LifeStateText } from "@/features/life/LifeMarks";
import { ReminderControls } from "@/features/reminders/ReminderControls";
import { EffectControls } from "@/features/effects/EffectControls";
import { OfficialReminderToken } from "@/features/reminders/OfficialReminderToken";
import { officialEffectPresentation, officialNotationRole } from "@/features/reminders/officialReminderPresentation";

export type PlayerPopoverProps = {
  player: STPlayerRecord;
  onChangeCharacter: () => void;
  onSwapSeats: () => void;
  onMore: () => void;
  onClose: () => void;
};

/** Presentation only. The existing editors retain authority over Life,
 * Effects and notation; opening or moving this card never mutates the game. */
export function PlayerPopover(props: PlayerPopoverProps) {
  const hidden = usePrivacyStore(s => s.enabled);
  if (hidden) return null;
  return <PopoverContents key={props.player.participantId ?? props.player.id} {...props} />;
}

function PopoverContents({ player, onChangeCharacter, onSwapSeats, onMore, onClose }: PlayerPopoverProps) {
  const game = useStorytellerStore(s => s.game);
  const script = useStorytellerStore(s => game ? selectScriptById(s, game.scriptId) : undefined);
  const roles = resolvedCharacters(script);
  const role = roles.find(r => r.id === player.actualRole);
  const shown = roles.find(r => r.id === player.shownRole);
  const ended = game?.phase === "ended";
  const titleId = useId();
  const card = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [position, setPosition] = useState({ left: 16, top: 76, width: 316, maxHeight: 660 });
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [effectsOpen, setEffectsOpen] = useState(false);

  useLayoutEffect(() => {
    const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    heading.current?.focus({ preventScroll: true });
    return () => {
      if (document.activeElement !== document.body && !card.current?.contains(document.activeElement)) return;
      const seat = document.querySelector<HTMLElement>(`.grimoire .token[data-player-id="${CSS.escape(player.id)}"]`);
      (invoker?.isConnected && !invoker.closest("[inert]") ? invoker : seat)?.focus({ preventScroll: true });
    };
  }, [player.id]);

  useLayoutEffect(() => {
    const token = document.querySelector<HTMLElement>(`.grimoire .token[data-player-id="${CSS.escape(player.id)}"]`);
    const board = token?.closest<HTMLElement>(".grimoire-stage");
    const update = () => {
      const rect = token?.getBoundingClientRect();
      const measured = board?.getBoundingClientRect();
      // The measured stage already excludes a pinned panel and any remaining
      // legacy dock. A viewport-only clamp would cover those controls.
      const bounds = measured && measured.width > 0 && measured.height > 0
        ? { left: Math.max(0, measured.left), top: Math.max(0, measured.top), right: Math.min(window.innerWidth, measured.right), bottom: Math.min(window.innerHeight, measured.bottom) }
        : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
      const width = Math.max(1, Math.min(316, bounds.right - bounds.left - 32));
      const maxHeight = Math.max(1, Math.min(660, bounds.bottom - bounds.top - 32));
      const height = Math.min(card.current?.getBoundingClientRect().height || 560, maxHeight);
      const x = rect ? rect.left + rect.width / 2 : (bounds.left + bounds.right) / 2;
      const left = rect ? (x < (bounds.left + bounds.right) / 2 ? rect.right + 20 : rect.left - width - 20) : x - width / 2;
      const top = rect ? Math.max(bounds.top + 76, rect.top + rect.height / 2 - 130) : bounds.top + 76;
      setPosition(previous => {
        const next = { left: Math.max(bounds.left + 16, Math.min(bounds.right - width - 16, left)), top: Math.max(bounds.top + 16, Math.min(bounds.bottom - height - 16, top)), width, maxHeight };
        return next.left === previous.left && next.top === previous.top && next.width === previous.width && next.maxHeight === previous.maxHeight ? previous : next;
      });
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (card.current) observer?.observe(card.current);
    if (board) observer?.observe(board);
    const mutation = token ? new MutationObserver(update) : null;
    if (token) mutation?.observe(token, { attributes: true, attributeFilter: ["style"] });
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { observer?.disconnect(); mutation?.disconnect(); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [player.id]);

  if (!game || player.isEmpty) return null;
  const effects = effectAccessibleSummary(player);
  const officialEffects = officialEffectPresentation(player);
  return createPortal(<aside ref={card} className="player-popover" role="dialog" aria-modal="false" aria-labelledby={titleId}
    style={position} onKeyDown={event => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault(); event.stopPropagation(); onClose();
    }}>
    <header className="player-popover-header">
      <h2 ref={heading} id={titleId} tabIndex={-1}>{player.name || "Unnamed player"}<small>Seat {player.seat + 1}</small></h2>
      <button type="button" aria-label="Close player details" onClick={onClose}>×</button>
    </header>
    <div className="player-popover-scroll">
      <div className="player-popover-character">
        <button className="player-popover-portrait" type="button" aria-label="Change character" onClick={onChangeCharacter} disabled={ended}>
          {role && <img src={iconUrlFor(role)} alt="" onError={event => { event.currentTarget.style.visibility = "hidden"; }} />}
          {!ended && <span aria-hidden="true">⇄</span>}
        </button>
        <div><h3>{role?.name ?? "Unassigned"}</h3><p className={role ? `type-${role.type}` : undefined}>{role?.type ?? (player.isTraveler ? "Traveler" : "Resident")}</p></div>
      </div>
      {role?.ability && <p className="player-popover-ability">{role.ability}</p>}
      <p className="player-popover-identity">Shown to player: <strong>{shown?.name ?? "Not revealed"}</strong>{player.isTraveler && <span> · Traveler</span>}</p>
      {ended ? <p className="player-popover-readonly"><LifeStateText state={lifeStatusOf(player).state} /> · Game ended</p> : <LifeControls player={player} />}
      <section className="player-popover-markers" aria-label="On this player">
        <h4>On this player</h4>
        {effects && <p className="player-popover-effects">Effects: {effects}</p>}
        {!!officialEffects.tokens.length && <div className="player-popover-official-effects">{officialEffects.tokens.map(token =>
          <OfficialReminderToken key={token.key} role={token.role} label={token.label} count={token.instances.length} />
        )}</div>}
        {player.reminders.length ? <ul className="player-popover-reminders">{player.reminders.map(reminder => {
          const sourceRole = officialNotationRole(reminder.sourceCharacter, reminder.label);
          return <li key={reminder.id}>{sourceRole
            ? <OfficialReminderToken role={sourceRole} label={reminder.label} notation />
            : <span>✎ {reminder.label}</span>}</li>;
        })}</ul> : <p className="player-popover-empty">No reminders.</p>}
        {!ended && <>
          <button type="button" className="player-popover-disclosure" aria-expanded={remindersOpen} onClick={() => setRemindersOpen(value => !value)}>Edit reminders</button>
          {remindersOpen && <ReminderControls player={player} />}
          <button type="button" className="player-popover-disclosure" aria-expanded={effectsOpen} onClick={() => setEffectsOpen(value => !value)}>Edit effects</button>
          {effectsOpen && <EffectControls player={player} />}
        </>}
      </section>
    </div>
    {!ended && <footer className="player-popover-actions">
      <button type="button" onClick={onChangeCharacter}>Change character</button>
      <button type="button" onClick={onSwapSeats}>Swap seats</button>
      <button type="button" className="player-popover-more" onClick={onMore}>More settings</button>
    </footer>}
  </aside>, document.body);
}
