// "Rejoin game" on the phone Home: the saved game this device could resume. Pure
// storage read, no React and no store import, so the Home screen stays light and
// the logic carries into any restyled Home. It only finds the code; resuming
// still goes through `?join=CODE`, where the server re-checks the seat.

const STORAGE_KEY = "new-blood-player"; // playerStore's persisted key
const CODE = /^[A-Z0-9]{4,12}$/;

/** The saved lobby code, or null when none is saved or storage is unreadable. */
export function savedGameCode(storage: Pick<Storage, "getItem"> = localStorage): string | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const code = (JSON.parse(raw) as { state?: { code?: unknown } } | null)?.state?.code;
    return typeof code === "string" && CODE.test(code) ? code : null;
  } catch {
    return null;
  }
}

/** `ABCD2345` as `ABCD 2345`, for display only. */
export const displayCode = (code: string): string => (code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code);

/** The page address that resumes a saved game. */
export const rejoinUrl = (code: string): string => `?join=${encodeURIComponent(code)}`;
