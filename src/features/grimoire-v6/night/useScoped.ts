import { useCallback, useState } from "react";

/**
 * `useState` whose value falls back to `initial` whenever `scope` changes (a new Night, Privacy Mode, a
 * different game), so Night-local drafts can never leak across them without an effect-driven reset.
 */
export function useScoped<T>(scope: string, initial: T): [T, (next: T | ((previous: T) => T)) => void] {
  const [state, set] = useState<{ scope: string; value: T }>({ scope, value: initial });
  const value = state.scope === scope ? state.value : initial;
  const setValue = useCallback((next: T | ((previous: T) => T)) => {
    set((previous) => {
      const base = previous.scope === scope ? previous.value : initial;
      return { scope, value: typeof next === "function" ? (next as (p: T) => T)(base) : next };
    });
    // `initial` is a constant at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);
  return [value, setValue];
}
