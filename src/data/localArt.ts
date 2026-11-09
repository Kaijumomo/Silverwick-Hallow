// Self-hosted official character icons (public/art; see public/art/PROVENANCE.md).
// Pure data: no React, so both the Home art helpers and iconUrlFor can use it.

export const ART_BASE = "/art";

/** Self-hosted icons for the eight characters added in feature/missing-characters. */
const LOCAL_CHARACTER_ART: Record<string, string> = {
  ...Object.fromEntries(
    ["shugenja", "harpy", "summoner", "kazali", "lordoftyphon", "leviathan"].map((id) => [id, `${ART_BASE}/characters/carousel/${id}.png`]),
  ),
  deusexfiasco: `${ART_BASE}/characters/fabled/deusexfiasco.png`,
  ferryman: `${ART_BASE}/characters/fabled/ferryman.png`,
  // Package 2: the Fabled and Loric tokens shown in the New Game setup flow.
  ...Object.fromEntries(
    ["angel", "buddhist", "djinn", "doomsayer", "duchess", "fibbin", "fiddler", "hellslibrarian", "revolutionary", "sentinel", "spiritofivory", "toymaker"]
      .map((id) => [id, `${ART_BASE}/characters/fabled/${id}.png`]),
  ),
  ...Object.fromEntries(
    ["bigwig", "bootlegger", "gardener", "godofug", "hindu", "knaves", "pope", "stormcatcher", "tor", "ventriloquist", "zenomancer"]
      .map((id) => [id, `${ART_BASE}/characters/loric/${id}.png`]),
  ),
};

// Treacherous 30th: the two Carousel characters it uses that no built-in script covers.
for (const id of ["golem", "marionette"]) LOCAL_CHARACTER_ART[id] = `${ART_BASE}/characters/carousel/${id}.png`;

// Package 3: the three built-in scripts and the Travellers (default icon per id).
const SET_IDS: Record<"tb" | "snv" | "bmr" | "travellers", readonly string[]> = {"tb": ["washerwoman", "librarian", "investigator", "chef", "empath", "fortuneteller", "undertaker", "monk", "ravenkeeper", "virgin", "slayer", "soldier", "mayor", "butler", "drunk", "recluse", "saint", "poisoner", "spy", "scarletwoman", "baron", "imp"], "snv": ["clockmaker", "dreamer", "snakecharmer", "mathematician", "flowergirl", "towncrier", "oracle", "savant", "seamstress", "philosopher", "artist", "juggler", "sage", "mutant", "sweetheart", "barber", "klutz", "eviltwin", "witch", "cerenovus", "pithag", "fanggu", "vigormortis", "nodashii", "vortox"], "bmr": ["grandmother", "sailor", "chambermaid", "exorcist", "innkeeper", "gambler", "gossip", "courtier", "professor", "minstrel", "tealady", "pacifist", "fool", "tinker", "moonchild", "goon", "lunatic", "godfather", "devilsadvocate", "assassin", "mastermind", "zombuul", "pukka", "shabaloth", "po"], "travellers": ["scapegoat", "gunslinger", "beggar", "bureaucrat", "thief", "butcher", "cacklejack", "bonecollector", "harlot", "barista", "deviant", "apprentice", "matron", "voudon", "judge", "bishop", "gangster", "gnome"]};
for (const [dir, list] of Object.entries(SET_IDS)) {
  for (const id of list) LOCAL_CHARACTER_ART[id] ??= `${ART_BASE}/characters/${dir}/${id}.png`;
}

export const localCharacterArt = (id: string): string | undefined => LOCAL_CHARACTER_ART[id];

/** Self-hosted neutral (unsuffixed) Traveller icon: the phone player flow draws
 * every Traveller with it, whatever their alignment. */
export const travellerArt = (id: string): string | undefined =>
  SET_IDS.travellers.includes(id) ? `${ART_BASE}/characters/travellers/neutral/${id}.png` : undefined;
