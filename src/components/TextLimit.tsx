/**
 * Phase 10G (PHASE10G Section 20): visible feedback for a bounded Storyteller
 * text field. The input itself carries `maxLength`; the store command boundary
 * independently REFUSES oversized changed text (never truncates). This hint
 * makes the limit explicit, so reaching it is never silent. A legacy value
 * already longer than the limit is reported as such (it stays loadable; it
 * just cannot be saved again until shortened).
 */
export function TextLimit({ length, max, id }: { length: number; max: number; id?: string }) {
  if (length < max * 0.9) return null;
  const over = length > max;
  return (
    <span className="text-limit" id={id} data-over={over || undefined} role={length >= max ? "status" : undefined}>
      {length.toLocaleString()} / {max.toLocaleString()}
      {over ? " — too long to save; shorten it (nothing is cut off automatically)" : length === max ? " — limit reached" : ""}
    </span>
  );
}
