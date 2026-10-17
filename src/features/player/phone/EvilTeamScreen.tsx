import { GoldButton, PhoneFrame } from "./PhoneParts";

export type TeamMate = { name: string; seat: number; designation: "Minion" | "Demon"; icon: string };
export type TeamBluff = { id: string; name: string; art: string };

/** "Sworn in darkness": the evil team (design screen 08).
 *
 * Privacy (D2): only what the Storyteller gave this player. Teammates are
 * shown by name, seat and Minion/Demon designation with a generic team icon,
 * never their specific characters. */
export function EvilTeamScreen({ me, mates, bluffs, onContinue }: {
  me: { name: string; roleName: string; art: string };
  mates: readonly TeamMate[];
  bluffs: readonly TeamBluff[];
  onContinue: () => void;
}) {
  // The player sits in the middle of the coven, lifted above the others.
  const mid = Math.floor(mates.length / 2);
  const coven: Array<{ key: string; name: string; sub: string; art: string; self: boolean }> = [
    ...mates.slice(0, mid).map((m) => ({ key: `m${m.seat}-${m.name}`, name: m.name, sub: `Seat ${m.seat + 1} · ${m.designation}`, art: m.icon, self: false })),
    { key: "me", name: me.name, sub: `You · ${me.roleName}`, art: me.art, self: true },
    ...mates.slice(mid).map((m) => ({ key: `m${m.seat}-${m.name}`, name: m.name, sub: `Seat ${m.seat + 1} · ${m.designation}`, art: m.icon, self: false })),
  ];
  return (
    <PhoneFrame dark evil label="evil-team">
      <div className="swp-page swp-reveal-page">
        <div className="swp-reveal-body swp-evil-body">
          <div className="swp-evil-head">
            <span className="swp-evil-eyebrow">The evil team</span>
            <h1 className="swp-evil-title">Sworn in darkness</h1>
          </div>
          <div className="swp-coven">
            {coven.map((m) => (
              <div key={m.key} className={`swp-coven-col${m.self ? " swp-coven-me" : ""}`}>
                <div className="swp-coven-token">
                  <span role="img" aria-label="" className="swp-token-art" style={{ backgroundImage: `url(${m.art})` }} />
                </div>
                <span className="swp-coven-name">{m.name}</span>
                <span className="swp-coven-sub">{m.sub}</span>
              </div>
            ))}
          </div>
          {bluffs.length > 0 && (
            <section className="swp-bluffs" aria-label="Bluffs, not in play">
              <span className="swp-bluffs-eyebrow">Bluffs · not in play</span>
              <div className="swp-bluffs-row">
                {bluffs.map((b) => (
                  <div key={b.id} className="swp-bluff">
                    <div className="swp-bluff-token"><span role="img" aria-label="" className="swp-token-art" style={{ backgroundImage: `url(${b.art})` }} /></div>
                    <span className="swp-bluff-name">{b.name}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
        <GoldButton full onClick={onContinue}>Enter the town</GoldButton>
      </div>
    </PhoneFrame>
  );
}
