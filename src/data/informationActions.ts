import type { InformationAction, RoleId } from "@/stores/types";

/**
 * Silverwick-authored structured Information Actions for canonical Roles.
 *
 * This is deliberately separate from src/data/canonical/roles.json: that
 * file is a pinned publisher snapshot (see canonical/README.md -- "Do not
 * hand-edit canonical meaning in wrappers or UI"), never a place for
 * Silverwick's own architecture to add fields. RoleRegistry.
 * informationActionsOf() is the single lookup point: it checks a Role's
 * own `informationActions` first (so a custom/homebrew script can define
 * its own), and falls back to this map for canonical Roles that have not
 * defined any of their own.
 *
 * Each entry's `id`/`requirements`/`timing` reflects only the exact
 * BOTC ability text already present in roles.json (see the exact ability
 * strings in the comments below) -- never an invented mechanic. Coverage
 * here is deliberately a representative sample proving the Information
 * Action model handles materially different requirement shapes, not an
 * attempt to structure every canonical Role in one pass. See PHASE9D3's
 * final report for the full coverage/gap list.
 */
export const INFORMATION_ACTIONS: Record<RoleId, InformationAction[]> = {
  // "You start knowing that 1 of 2 players is a particular Townsfolk."
  // Players + Role -- the two-player-plus-one-role shape shared by
  // Librarian/Investigator (not separately structured here; see the
  // Phase 9D.3 coverage report).
  washerwoman: [
    {
      id: "washerwoman-first-night",
      timing: { kind: "firstNight" },
      instruction: "Show the Townsfolk character token. Point to both the shown player and the wrong player.",
      requirements: [
        { id: "players", kind: "player", cardinality: { kind: "exactly", count: 2 }, label: "The two players shown" },
        { id: "role", kind: "role", label: "The Townsfolk character shown" },
      ],
    },
  ],

  // "You start knowing how many pairs of evil players there are." --
  // Number only, first night only.
  chef: [
    {
      id: "chef-first-night",
      timing: { kind: "firstNight" },
      instruction: "Give a finger signal for the number of pairs of evil players.",
      requirements: [
        { id: "pairs", kind: "number", label: "Number of evil pairs" },
      ],
    },
  ],

  // "Each night, you learn how many of your 2 alive neighbors are evil."
  // Number only, but recurring both nights -- two Information Actions
  // sharing the same requirement shape, one per timing.
  empath: [
    {
      id: "empath-first-night",
      timing: { kind: "firstNight" },
      instruction: "Give a finger signal for the number of evil alive neighbors.",
      requirements: [
        { id: "evilNeighbors", kind: "number", label: "Number of evil alive neighbors" },
      ],
    },
    {
      id: "empath-other-night",
      timing: { kind: "otherNight" },
      instruction: "Give a finger signal for the number of evil alive neighbors.",
      requirements: [
        { id: "evilNeighbors", kind: "number", label: "Number of evil alive neighbors" },
      ],
    },
  ],

  // "Each night, choose 2 players: you learn if either is a Demon." --
  // Players + Boolean, recurring both nights.
  fortuneteller: [
    {
      id: "fortuneteller-first-night",
      timing: { kind: "firstNight" },
      instruction: "The Fortune Teller chooses 2 players. Nod if either is the Demon (or the red herring).",
      requirements: [
        { id: "players", kind: "player", cardinality: { kind: "exactly", count: 2 }, label: "The two players chosen" },
        { id: "isDemon", kind: "boolean", label: "Whether either registers as the Demon" },
      ],
    },
    {
      id: "fortuneteller-other-night",
      timing: { kind: "otherNight" },
      instruction: "The Fortune Teller chooses 2 players. Nod if either is the Demon (or the red herring).",
      requirements: [
        { id: "players", kind: "player", cardinality: { kind: "exactly", count: 2 }, label: "The two players chosen" },
        { id: "isDemon", kind: "boolean", label: "Whether either registers as the Demon" },
      ],
    },
  ],

  // "Each night*, you learn which character died by execution today." --
  // Role only. Conditional on an execution having happened, but Phase
  // 9D.3 does not model that trigger condition (see InformationTiming) --
  // the Storyteller simply does not record this Action on a night with
  // no execution.
  undertaker: [
    {
      id: "undertaker-other-night",
      timing: { kind: "otherNight" },
      instruction: "If a player was executed today, show their character token.",
      requirements: [
        { id: "role", kind: "role", label: "The executed player's character" },
      ],
    },
  ],

  // "If you die at night, you are woken to choose a player: you learn
  // their character." -- Player + Role, and genuinely triggered (only
  // happens if the Ravenkeeper themself dies at night that night) rather
  // than a fixed per-night cadence.
  ravenkeeper: [
    {
      id: "ravenkeeper-triggered",
      timing: { kind: "triggered" },
      instruction: "If the Ravenkeeper died tonight, they choose a player. Show that player's character token.",
      requirements: [
        { id: "chosenPlayer", kind: "player", label: "The player the Ravenkeeper chose" },
        { id: "role", kind: "role", label: "That player's character" },
      ],
    },
  ],
};
