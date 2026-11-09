import { GoldButton, PhoneFrame, ringPoint } from "./PhoneParts";

export type ChartSeat = { seat: number; name: string };

/** A neighbour disc is 42px: short names fit, longer ones shrink, then fall
 * back to their initial rather than overflow the disc. */
function discLabel(name: string): { text: string; size: number } {
  const text = name.trim();
  if (text.length <= 4) return { text, size: 13 };
  if (text.length <= 6) return { text, size: 11 };
  return { text: text.slice(0, 1).toUpperCase(), size: 13 };
}

/** "Your place in the circle": the seating chart (design screen 05 / 54).
 * `seats` is the public, seat-ordered roster (names and seat numbers only);
 * `ownSeat` is this player's own 1-based seat number. */
export function SeatedChart({ scriptName, seats, ownSeat, line, action }: {
  scriptName?: string;
  seats: readonly ChartSeat[];
  ownSeat: number;
  line: string;
  action?: { label: string; onClick: () => void };
}) {
  const count = seats.length;
  const own = seats.findIndex((s) => s.seat === ownSeat);
  const left = own >= 0 && count >= 2 ? seats[(own - 1 + count) % count] : undefined;
  const right = own >= 0 && count >= 2 ? seats[(own + 1) % count] : undefined;
  const eyebrow = `${scriptName ? `${scriptName} · ` : ""}${count} players`;
  return (
    <PhoneFrame glow="join" label="seated">
      <div className="swp-page">
        <div className="swp-seated">
          <div className="swp-seated-head">
            <div className="swp-seated-eyebrow">{eyebrow}</div>
            <h1 className="swp-title swp-seated-title">Your place in the circle</h1>
          </div>
          <p className="swp-sr-only">
            You are in seat {ownSeat} of {count}.
            {left && right ? ` On your left: ${left.name}. On your right: ${right.name}.` : ""}
          </p>
          <div className="swp-chart" aria-hidden="true">
            <div className="swp-chart-ring" />
            <div className="swp-chart-centre">
              <span className="swp-chart-seat">Seat</span>
              <span className="swp-chart-num">{ownSeat}</span>
              <span className="swp-chart-of">of {count}</span>
            </div>
            {seats.map((s, rank) => {
              const me = rank === own;
              const nb = !me && own >= 0 && count >= 2 && (rank === (own - 1 + count) % count || rank === (own + 1) % count);
              const size = me ? 50 : nb ? 42 : 26;
              const p = ringPoint(rank, count, 270, 116);
              const label = me ? { text: "You", size: 14 } : nb ? discLabel(s.name) : { text: String(s.seat), size: 11 };
              return (
                <span
                  key={s.seat}
                  className={`swp-chart-disc${me ? " swp-chart-me" : nb ? " swp-chart-nb" : ""}`}
                  style={{ left: p.x, top: p.y, width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, fontSize: label.size }}
                >
                  {label.text}
                </span>
              );
            })}
          </div>
          {left && right && (
            <div className="swp-neighbours">
              <div className="swp-neighbour"><span className="swp-neighbour-label">On your left</span><span className="swp-neighbour-name">{left.name}</span></div>
              <div className="swp-neighbour"><span className="swp-neighbour-label">On your right</span><span className="swp-neighbour-name">{right.name}</span></div>
            </div>
          )}
          <p className="swp-fell swp-seated-line">{line}</p>
          {action && <GoldButton className="swp-seated-cta" onClick={action.onClick}>{action.label}</GoldButton>}
        </div>
      </div>
    </PhoneFrame>
  );
}
