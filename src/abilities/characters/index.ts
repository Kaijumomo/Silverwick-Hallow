import type { AbilityDescriptor } from "../semantics";
import { AL_HADIKHIA } from "./alhadikhia";
import { CULT_LEADER } from "./cultleader";
import { EMPATH } from "./empath";
import { FORTUNE_TELLER } from "./fortuneteller";
import { HARLOT } from "./harlot";
import { IMP } from "./imp";
import { MONK } from "./monk";
import { POISONER } from "./poisoner";
import { SLAYER } from "./slayer";

/**
 * Phase 10F Slice 7: the verified proof / support semantics, each traced to
 * its section of docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md. This list IS the
 * production Ability Semantics Registry (semantics.ts); it is only ever
 * consulted through the canonical ownership gate (resolveAbilitySemantics).
 */
export const VERIFIED_DESCRIPTORS: readonly AbilityDescriptor[] = [POISONER, MONK, EMPATH, FORTUNE_TELLER, SLAYER, CULT_LEADER, HARLOT, AL_HADIKHIA, IMP];
