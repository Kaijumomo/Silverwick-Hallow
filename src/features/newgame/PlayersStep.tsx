import { ROMAN } from "./setupFlowModel";
import { QrCode, buildPlayerJoinLink } from "./qr";

/** Step III, screen 1: how will the town gather? Tapping a card goes to its screen. */
export function ChooseMode({ onLive, onOffline, busy }: { onLive: () => void; onOffline: () => void; busy: boolean }) {
  return (
    <section className="sf-main" aria-labelledby="sf-step-title">
      <div className="sf-heading sf-heading-stack">
        <h1 className="sf-title" id="sf-step-title">How will the town gather?</h1>
        <span className="sf-sub">Phones are optional. You can run the whole game from this tablet.</span>
      </div>
      <div className="sf-modes">
        <button type="button" className="sf-mode sf-leather" disabled={busy} onClick={onLive}>
          <span className="sf-mode-kicker">Live</span>
          <span className="sf-mode-title">Invite to phones</span>
          <span className="sf-mode-body">Players join with a code. Each sees their character privately and can follow the game on their phone.</span>
          <span className="sf-mode-points">
            <span className="sf-mode-point">Needs Wi-Fi or mobile data</span>
            <span className="sf-mode-point">Night information goes to phones</span>
          </span>
        </button>
        <button type="button" className="sf-mode sf-leather" disabled={busy} onClick={onOffline}>
          <span className="sf-mode-kicker">Offline</span>
          <span className="sf-mode-title">Play offline</span>
          <span className="sf-mode-body">Seat the players on this tablet. Characters are handed out in person, the way the box game is played.</span>
          <span className="sf-mode-points">
            <span className="sf-mode-point">Works anywhere, no connection</span>
            <span className="sf-mode-point">Nothing is sent to players</span>
          </span>
        </button>
      </div>
    </section>
  );
}

export type Arrival = { key: string; name: string };

const initialOf = (name: string) => (name.trim().charAt(0) || "?").toUpperCase();

/** Step III, Live: the QR and code on the left, real arrivals on the right. */
export function LiveInvite({ code, arrivals, total, status, onBegin, canBegin, message, onRetry, retrying }: {
  code: string | null;
  arrivals: Arrival[];
  total: number;
  /** "ready" once the lobby is attached; "starting" while it is being opened; "failed" otherwise. */
  status: "ready" | "starting" | "failed";
  canBegin: boolean;
  onBegin: () => void;
  message: string | null;
  onRetry: () => void;
  retrying: boolean;
}) {
  const here = arrivals.length;
  const pills = Math.max(total, here);
  const link = code ? buildPlayerJoinLink(window.location, code) : null;
  return (
    <section className="sf-main" aria-labelledby="sf-step-title">
      <div className="sf-heading">
        <h1 className="sf-title" id="sf-step-title">Invite the town</h1>
        <span className="sf-sub">Players scan the code or enter it on their phones.</span>
      </div>
      <div className="sf-invite">
        <div className="sf-invite-card sf-leather">
          {code && link ? (
            <>
              <div className="sf-qr-plate"><QrCode text={link} label={`QR code to join with code ${code.split("").join(" ")}`} /></div>
              <div className="sf-code" aria-label={`Join code ${code.split("").join(" ")}`}>{code}</div>
            </>
          ) : (
            <div className="sf-invite-wait">
              <span className="sf-invite-wait-text" role="status">{status === "failed" ? "The lobby is not open." : "Opening the lobby…"}</span>
              {status === "failed" && <button type="button" className="sf-cta" disabled={retrying} onClick={onRetry}>Try again</button>}
            </div>
          )}
        </div>
        <div className="sf-arrivals">
          <div className="sf-arrivals-head">
            <span className="sf-arrivals-label">Arrivals</span>
            <span className="sf-arrivals-count" aria-live="polite">{here} of {total}</span>
          </div>
          <ul className="sf-pills" aria-label="Arrivals">
            {Array.from({ length: pills }, (_, i) => {
              const arrival = arrivals[i];
              return arrival ? (
                <li key={arrival.key} className="sf-pill sf-pill-here">
                  <span className="sf-badge sf-badge-token">{initialOf(arrival.name)}</span>
                  <span className="sf-pill-name">{arrival.name}</span>
                </li>
              ) : (
                <li key={`wait-${i}`} className="sf-pill sf-pill-wait">
                  <span className="sf-badge">{ROMAN[i]}</span>
                  <span className="sf-pill-name">Waiting…</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <div className="sf-foot">
        <div className="sf-foot-status" role="status">{message && <span className="sf-foot-note">{message}</span>}</div>
        <button type="button" className="sf-cta" disabled={!canBegin} aria-describedby="sf-live-reason" onClick={onBegin}>
          {here >= total ? "Begin the night" : `Begin with ${here}`}
        </button>
        {!canBegin && <span id="sf-live-reason" className="sr-only">At least 5 players must have joined and the lobby must be live.</span>}
      </div>
    </section>
  );
}

/** Step III, Offline: write names clockwise; empty seats keep their number. */
export function SeatTown({ total, names, onName, minNamed, onBegin, busy, message }: {
  total: number;
  names: string[];
  onName: (index: number, value: string) => void;
  minNamed: number;
  onBegin: () => void;
  busy: boolean;
  message: string | null;
}) {
  const named = names.slice(0, total).filter((name) => name.trim()).length;
  const canBegin = named >= minNamed && !busy;
  return (
    <section className="sf-main" aria-labelledby="sf-step-title">
      <div className="sf-heading">
        <h1 className="sf-title" id="sf-step-title">Seat the town</h1>
        <span className="sf-sub">Write names clockwise from your left. Nobody needs a phone.</span>
      </div>
      <div className="sf-seats">
        {Array.from({ length: total }, (_, i) => {
          const value = names[i] ?? "";
          return (
            <label key={i} className="sf-seat">
              <span className={`sf-badge${value.trim() ? " sf-badge-token" : ""}`} aria-hidden="true">{value.trim() ? initialOf(value) : ROMAN[i]}</span>
              <input
                className="sf-seat-input"
                type="text"
                value={value}
                maxLength={20}
                placeholder={`Seat ${ROMAN[i]}…`}
                aria-label={`Seat ${ROMAN[i]}`}
                autoComplete="off"
                onChange={(e) => onName(i, e.target.value.replace(/[\r\n\t]/g, " "))}
              />
            </label>
          );
        })}
      </div>
      <div className="sf-foot">
        <div className="sf-foot-status" role="status">
          <span className="sf-foot-note">{message ?? (named >= total ? "Every seat is named." : `${named} of ${total} named · empty seats keep their number.`)}</span>
        </div>
        <button type="button" className="sf-cta" disabled={!canBegin} aria-describedby="sf-offline-reason" onClick={onBegin}>Begin the night</button>
        {!canBegin && <span id="sf-offline-reason" className="sr-only">Name at least {minNamed} seats to begin.</span>}
      </div>
    </section>
  );
}
