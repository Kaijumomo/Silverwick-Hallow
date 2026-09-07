export type PlayerId = string;
export type RoleId = string;
export type Alignment = "good" | "evil";
export type RoleType =
  | "townsfolk"
  | "outsider"
  | "minion"
  | "demon"
  | "traveler"
  | "fabled"
  | "loric";

export type BehaviorMode =
  | "normal"
  | "drunk_fake_role_behavior"
  | "fake_demon_behavior"
  | "marionette_fake_good_behavior"
  | "poisoned"
  | "custom";

export type RoleDef = {
  id: RoleId;
  name: string;
  type: RoleType;
  edition?: string;
  alignment?: Alignment;
  ability?: string;
  flavor?: string;
  icon?: string;
  iconUrl?: string;
  firstNight?: number;
  otherNight?: number;
  firstNightPrompt?: string;
  otherNightPrompt?: string;
  firstNightReminder?: string;
  otherNightReminder?: string;
  oncePerGame?: boolean;
  setup?: boolean;
  reminders?: string[];
  remindersGlobal?: string[];
  jinxes?: { id: RoleId; reason: string }[];
  [extra: string]: unknown;
};

export type Script = {
  id: string;
  name: string;
  author?: string;
  characters: RoleDef[];
  fabled?: RoleDef[];
  [extra: string]: unknown;
};

export type PrivateInfo = {
  bluffs?: RoleId[];
  fakeMinions?: PlayerId[];
  extraText?: string;
};

export type Statuses = Record<string, boolean>;

export type GrimoireMode = "ring" | "freeRoam";
export type TokenPosition = { x: number; y: number };

export type STPlayerRecord = {
  id: PlayerId;
  name: string;
  seat: number;
  joinedAt: number;
  actualRole: RoleId;
  /** Explicit intended identity for the next sync. Null means unrevealed. */
  shownRole: RoleId | null;
  /** Null derives from shownRole only; never from actual identity. */
  shownAlignment: Alignment | null;
  behaviorMode: BehaviorMode;
  publicDisplayRole: RoleId | null;
  alive: boolean;
  ghostVote: boolean;
  abilityUsed: boolean;
  statuses: Statuses;
  reminders: string[];
  stNotes: string;
  isTraveler: boolean;
  privateInfo?: PrivateInfo;
  /** True for pre-allocated seats that haven't been assigned to a player yet. */
  isEmpty?: boolean;
};

export type NightStepStatus = "pending" | "done" | "skipped";

export type NightStepRecord = {
  status: NightStepStatus;
  notes: string;
};

export type StorytellerLobbyRecord = {
  code: string;
  storytellerUid: string;
  scriptId: string;
  phase: "setup" | "night" | "day" | "ended";
  day: number;
  bluffs: RoleId[];
  fabled: RoleId[];
  lorics: RoleId[];
  notes: string;
  players: Record<PlayerId, STPlayerRecord>;
  seatOrder: PlayerId[];
  /** Keys: "${day}:${stepKey}" — e.g. "1:demonInfo", "2:p:abc123" */
  nightProgress: Record<string, NightStepRecord>;
  /** Pre-picked roles waiting to be dealt. ST-only — never written to public/*. */
  rolePool: RoleId[];
  /** Target player count chosen at New Game setup time. */
  plannedPlayerCount: number;
  /** Players who have knocked but not yet been assigned to a seat. uid → requested name. */
  pendingPlayers: Record<string, string>;
};

/** Delivered identity at player/{id}; an absent record means unrevealed. */
export type PlayerSelfRecord = {
  shownRole: RoleId;
  shownAlignment: Alignment;
  bluffs?: RoleId[];
  fakeMinions?: PlayerId[];
  extraText?: string;
};

export type PlayerPublicRecord = {
  id: PlayerId;
  name: string;
  seat: number;
  alive: boolean;
  ghostVote: boolean;
  online: boolean;
  joinedAt: number;
  isTraveler: boolean;
  publicDisplayRole?: RoleId;
};

export type PublicLobbyRecord = {
  code: string;
  scriptId: string;
  phase: "setup" | "night" | "day" | "ended";
  day: number;
  seatOrder: PlayerId[];
  players: Record<PlayerId, PlayerPublicRecord>;
  fabled: RoleId[];
  lorics: RoleId[];
  winner?: Alignment;
  /** Legacy projection marker; lifecycle state is authoritative in session. */
  status?: "ended";
};
