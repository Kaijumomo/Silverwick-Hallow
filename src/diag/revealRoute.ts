/**
 * Diagnostic-only (branch package4-tablet-diag, never merged): the no-game Reveal test page lives at /diag-reveal
 * (or /?page=reveal where the host has no path fallback). Imported FIRST by main.tsx, so on that page the saved-game
 * storage is swapped for an in-memory copy before any store hydrates. Everywhere else this module does nothing.
 */
export const isRevealPage =
  /\/diag-reveal\/?$/.test(location.pathname) || new URLSearchParams(location.search).get("page") === "reveal";

class MemoryStorage implements Storage {
  #data = new Map<string, string>();
  get length() { return this.#data.size; }
  clear() { this.#data.clear(); }
  getItem(k: string) { return this.#data.has(k) ? this.#data.get(k)! : null; }
  key(i: number) { return [...this.#data.keys()][i] ?? null; }
  removeItem(k: string) { this.#data.delete(k); }
  setItem(k: string, v: string) { this.#data.set(k, String(v)); }
  [name: string]: unknown;
}

if (isRevealPage) {
  for (const name of ["localStorage", "sessionStorage"] as const) {
    try { Object.defineProperty(window, name, { value: new MemoryStorage(), configurable: true }); } catch { /* keep the real one */ }
  }
}
