type Props = {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  label?: string;
  decrementLabel?: string;
  incrementLabel?: string;
};

export function PlayerCountStepper({
  value,
  onChange,
  min,
  max,
  label = "players",
  decrementLabel,
  incrementLabel,
}: Props) {
  const dec = () => onChange(Math.max(min, value - 1));
  const inc = () => onChange(Math.min(max, value + 1));

  return (
    <div className="ng-stepper">
      <button
        className="btn btn-sm ng-stepper-btn"
        onClick={dec}
        disabled={value <= min}
        aria-label={decrementLabel ?? `Fewer ${label}`}
      >
        −
      </button>
      <span className="ng-stepper-value" aria-live="polite">
        {value} <span className="ng-stepper-label">{label}</span>
      </span>
      <button
        className="btn btn-sm ng-stepper-btn"
        onClick={inc}
        disabled={value >= max}
        aria-label={incrementLabel ?? `More ${label}`}
      >
        +
      </button>
    </div>
  );
}
