type PlayerTab = "role" | "town" | "more";

type Props = {
  active: PlayerTab;
  onChange: (tab: PlayerTab) => void;
};

/** Phase 10H (§§11.2, 11.8; F9): touch-safe bottom navigation. Reference (the
 * wiki / almanac) and Leave live under More. */
const TABS: { id: PlayerTab; label: string }[] = [
  { id: "role", label: "Role" },
  { id: "town", label: "Town" },
  { id: "more", label: "More" },
];

export function PlayerTabs({ active, onChange }: Props) {
  return (
    <nav className="player-tabs player-bottom-nav" aria-label="Player views">
      {TABS.map(({ id, label }) => (
        <button
          key={id}
          className="player-tab"
          aria-pressed={active === id}
          aria-current={active === id ? "page" : undefined}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
