import { useRef, type KeyboardEvent } from "react";

/**
 * Phase 10H (contract §2.2): a finite judgment or finite choice as explicit,
 * visible buttons -- never a dropdown. A radiogroup of `role="radio"` buttons
 * with roving focus (arrow keys move and choose, Home/End jump), 44px targets,
 * and an optional adjacent reason for a disabled option.
 */
export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
  /** Shown as the option's title and, when disabled, read as its reason. */
  hint?: string;
};

export function Segmented<T extends string>({ label, value, options, onChange, disabled = false, className = "", hideLabel = false }: {
  label: string;
  value: T | null;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  /** The label stays the group's accessible name; only its visible text is hidden. */
  hideLabel?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.map((option) => !disabled && !option.disabled);
  const focusIndex = Math.max(0, options.findIndex((option) => option.value === value && !option.disabled));
  const move = (from: number, step: 1 | -1) => {
    for (let i = 1; i <= options.length; i++) {
      const next = (from + step * i + options.length) % options.length;
      if (enabled[next]) return next;
    }
    return from;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = move(index, 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = move(index, -1);
    else if (event.key === "Home") next = enabled.indexOf(true);
    else if (event.key === "End") next = enabled.lastIndexOf(true);
    if (next === null || next < 0) return;
    event.preventDefault();
    refs.current[next]?.focus();
    onChange(options[next]!.value);
  };
  return (
    <div className={`segmented ${className}`.trim()} role="radiogroup" aria-label={label} aria-disabled={disabled || undefined}>
      {!hideLabel && <span className="segmented-label" aria-hidden="true">{label}</span>}
      <span className="segmented-options">
        {options.map((option, index) => (
          <button
            key={option.value}
            ref={(el) => { refs.current[index] = el; }}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            data-value={option.value}
            className={`segmented-option${value === option.value ? " checked" : ""}`}
            disabled={!enabled[index]}
            tabIndex={index === focusIndex ? 0 : -1}
            title={option.hint}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.label}
          </button>
        ))}
      </span>
      {options.some((option) => option.disabled && option.hint) && (
        <span className="segmented-reasons">
          {options.filter((option) => option.disabled && option.hint).map((option) => (
            <span key={option.value} className="disabled-reason">{option.label}: {option.hint}</span>
          ))}
        </span>
      )}
    </div>
  );
}
