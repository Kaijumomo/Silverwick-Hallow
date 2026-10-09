import { useEffect, useRef, useState } from "react";
import "./reminder-removal.css";

/** Arming is local presentation only; the second tap calls the existing owner. */
export function useReminderRemoval(scope: unknown, disabled = false) {
  const [armed, setArmed] = useState<{ id: string; scope: unknown; until: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const clear = () => { clearTimeout(timer.current); setArmed(null); };
  useEffect(() => { clear(); return () => clearTimeout(timer.current); }, [scope, disabled]);
  const armedId = !disabled && armed && armed.scope === scope && armed.until > Date.now() ? armed.id : null;
  return {
    armedId,
    tap: (id: string, remove: () => void) => {
      if (disabled) return;
      if (armedId === id) { clear(); remove(); return; }
      clearTimeout(timer.current);
      setArmed({ id, scope, until: Date.now() + 3000 });
      timer.current = setTimeout(() => setArmed(null), 3000);
    },
  };
}
