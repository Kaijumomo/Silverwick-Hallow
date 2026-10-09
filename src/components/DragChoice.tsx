import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import "./DragChoice.css";

export type DragChoiceOption<T extends string> = { value: T; label: string; hint?: string; disabled?: boolean };

type Gesture<T extends string> = {
  pointerId: number; x: number; y: number; left: number; top: number; width: number; height: number;
  initialPosition: number; initialValue: T | null; contextKey: unknown; dragged: boolean;
  values: readonly [T, T]; enabled: readonly [boolean, boolean]; element: HTMLSpanElement;
};

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const MIN_DRAG = 8;

/** A two-position choice that supports taps and a draggable selected thumb.
 * A slide commits on release; keyboard and assistive activation retain radio semantics.
 * The thumb is a preview: the controlled value remains authoritative. */
export function DragChoice<T extends string>({ label, value, options, onChange, disabled = false, className = "", contextKey, hideLabel = false }: {
  label: string; value: T | null; options: readonly DragChoiceOption<T>[];
  onChange: (value: T) => void; disabled?: boolean; className?: string;
  contextKey?: unknown; hideLabel?: boolean;
}) {
  if (options.length !== 2) throw new Error("DragChoice requires exactly two options.");
  const first = options[0]!;
  const second = options[1]!;
  const selected = options.findIndex(option => option.value === value);
  const enabled: readonly [boolean, boolean] = [!disabled && !first.disabled, !disabled && !second.disabled];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const track = useRef<HTMLSpanElement>(null);
  const gesture = useRef<Gesture<T> | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const pointerClickPending = useRef(false);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintId = useId();
  const current = useRef({ value, contextKey, enabled, values: [first.value, second.value] as const });
  current.current = { value, contextKey, enabled, values: [first.value, second.value] };

  const release = () => {
    const active = gesture.current;
    gesture.current = null;
    if (active?.element.hasPointerCapture?.(active.pointerId)) active.element.releasePointerCapture(active.pointerId);
  };
  const cancel = (suppressClick = true) => {
    if (gesture.current && suppressClick) pointerClickPending.current = true;
    release(); setPreview(null);
  };
  const expirePointerClick = () => {
    if (clickTimer.current !== null) clearTimeout(clickTimer.current);
    // Native compatibility click follows pointerup in the same event turn.
    // Avoid leaving a stale blocker for a subsequent assistive activation.
    clickTimer.current = setTimeout(() => { pointerClickPending.current = false; clickTimer.current = null; }, 0);
  };
  useLayoutEffect(() => {
    cancel();
  }, [value, contextKey, disabled, first.value, second.value, first.disabled, second.disabled]);
  useLayoutEffect(() => () => {
    release();
    if (clickTimer.current !== null) clearTimeout(clickTimer.current);
  }, []);

  const valid = (active: Gesture<T>) => {
    const latest = current.current;
    return Object.is(active.contextKey, latest.contextKey) && active.initialValue === latest.value
      && active.values.every((option, i) => option === latest.values[i] && active.enabled[i] === latest.enabled[i]);
  };
  const start = (event: PointerEvent<HTMLButtonElement>, index: number) => {
    if (gesture.current) return;
    pointerClickPending.current = false;
    if (clickTimer.current !== null) { clearTimeout(clickTimer.current); clickTimer.current = null; }
    if (gesture.current || disabled || !enabled[index] || event.button !== 0 || event.isPrimary === false) return;
    const element = track.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || (selected >= 0 && selected !== index)) return;
    const relativeX = (event.clientX - rect.left) / rect.width;
    if (selected < 0 && (relativeX < .25 || relativeX > .75)) return;
    gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      left: rect.left, top: rect.top, width: rect.width, height: rect.height, initialPosition: selected < 0 ? .5 : selected,
      initialValue: value, contextKey, dragged: false, values: [first.value, second.value], enabled, element };
    setPreview(selected < 0 ? .5 : selected);
    element.setPointerCapture?.(event.pointerId);
  };
  const dragPosition = (active: Gesture<T>, x: number) => clamp(active.initialPosition + (x - active.x) / (active.width / 2));
  const isVertical = (active: Gesture<T>, x: number, y: number) => Math.abs(y - active.y) >= MIN_DRAG && Math.abs(y - active.y) > Math.abs(x - active.x);
  const move = (event: PointerEvent<HTMLSpanElement>) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (!valid(active) || isVertical(active, event.clientX, event.clientY)) { cancel(); expirePointerClick(); return; }
    if (Math.abs(event.clientX - active.x) >= MIN_DRAG) { active.dragged = true; event.preventDefault(); }
    setPreview(dragPosition(active, event.clientX));
  };
  const finish = (event: PointerEvent<HTMLSpanElement>) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) { expirePointerClick(); return; }
    const position = dragPosition(active, event.clientX);
    const releaseSide = position < .5 ? 0 : 1;
    const dragged = active.dragged || Math.abs(event.clientX - active.x) >= MIN_DRAG;
    const target = options[releaseSide]!;
    const commit = dragged && valid(active) && enabled[releaseSide] && target.value !== value
      && !isVertical(active, event.clientX, event.clientY)
      && event.clientY >= active.top && event.clientY <= active.top + active.height;
    cancel(dragged || !valid(active) || isVertical(active, event.clientX, event.clientY)); expirePointerClick();
    if (commit) { refs.current[releaseSide]?.focus(); onChange(target.value); }
  };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "Escape") { cancel(); return; }
    if (event.altKey || event.ctrlKey || event.metaKey || event.repeat || disabled) return;
    let next: number;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) next = 1 - index;
    else if (event.key === "Home") next = enabled[0] ? 0 : 1;
    else if (event.key === "End") next = enabled[1] ? 1 : 0;
    else if (event.key === " " || event.key === "Enter") next = index;
    else return;
    event.preventDefault(); cancel(); pointerClickPending.current = false;
    if (!enabled[next]) return;
    refs.current[next]?.focus();
    if (options[next]!.value !== value) onChange(options[next]!.value);
  };
  const focusIndex = selected >= 0 && enabled[selected] ? selected : enabled.findIndex(Boolean);
  const position = preview ?? (selected < 0 ? .5 : selected);
  return <div className={`drag-choice ${className}`.trim()} role="radiogroup" aria-label={label}
    aria-disabled={disabled || undefined} aria-describedby={hintId} data-dragging={preview !== null || undefined}>
    {!hideLabel && <span className="drag-choice-label" aria-hidden="true">{label}</span>}
    <span id={hintId} className="sr-only">Tap either choice or slide the highlighted side. Keyboard: arrow keys, Home or End; Enter or Space to choose.</span>
    <span className="drag-choice-track" ref={track} style={{ "--drag-choice-position": position } as CSSProperties}
      onPointerMove={move} onPointerUp={finish}
      onPointerCancel={event => { if (gesture.current?.pointerId === event.pointerId) { cancel(); expirePointerClick(); } }}
      onLostPointerCapture={event => { if (gesture.current?.pointerId === event.pointerId) { cancel(); expirePointerClick(); } }}>
      <span className="drag-choice-thumb" aria-hidden="true" />
      {options.map((option, index) => <button key={option.value} ref={element => { refs.current[index] = element; }} type="button"
        role="radio" className="drag-choice-option" data-value={option.value} aria-checked={value === option.value}
        disabled={!enabled[index]} tabIndex={index === focusIndex ? 0 : -1} title={option.hint}
        aria-describedby={option.disabled && option.hint ? `${hintId}-${index}` : undefined}
        onPointerDown={event => start(event, index)} onKeyDown={event => keyDown(event, index)}
        onKeyUp={event => { if (event.key === " " || event.key === "Enter") event.preventDefault(); }}
        onClick={event => {
          event.preventDefault();
          if (pointerClickPending.current) { pointerClickPending.current = false; return; }
          cancel();
          if (enabled[index] && value !== option.value) onChange(option.value);
        }}>{option.label}</button>)}
    </span>
    {options.filter(option => option.disabled && option.hint).length > 0 && <span className="drag-choice-reasons">
      {options.map((option, index) => option.disabled && option.hint && <span id={`${hintId}-${index}`} key={option.value}>{option.label}: {option.hint}</span>)}
    </span>}
  </div>;
}
