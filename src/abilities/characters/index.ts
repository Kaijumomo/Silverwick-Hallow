import type { AbilityDescriptor } from "../semantics";
import { AL_HADIKHIA } from "./alhadikhia";
import { CULT_LEADER } from "./cultleader";
import { DEVILS_ADVOCATE } from "./devilsadvocate";
import { CHEF } from "./chef";
import { EMPATH } from "./empath";
import { FORTUNE_TELLER } from "./fortuneteller";
import { GAMBLER } from "./gambler";
import { GODFATHER } from "./godfather";
import { HARLOT } from "./harlot";
import { IMP } from "./imp";
import { INNKEEPER } from "./innkeeper";
import { MONK } from "./monk";
import { MOONCHILD } from "./moonchild";
import { NO_DASHII } from "./nodashii";
import { ORACLE } from "./oracle";
import { PIT_HAG } from "./pithag";
import { POISONER } from "./poisoner";
import { PROFESSOR } from "./professor";
import { RAVENKEEPER } from "./ravenkeeper";
import { SHABALOTH } from "./shabaloth";
import { SLAYER } from "./slayer";
import { TOWN_CRIER } from "./towncrier";
import { UNDERTAKER } from "./undertaker";
import { WITCH } from "./witch";
import { VIGORMORTIS } from "./vigormortis";

/**
 * Phase 10F Slice 7: the verified proof / support semantics, each traced to
 * its section of docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md. This list IS the
 * production Ability Semantics Registry (semantics.ts); it is only ever
 * consulted through the canonical ownership gate (resolveAbilitySemantics).
 */
export const VERIFIED_DESCRIPTORS: readonly AbilityDescriptor[] = [POISONER, MONK, CHEF, EMPATH, FORTUNE_TELLER, SLAYER, CULT_LEADER, HARLOT, AL_HADIKHIA, IMP, RAVENKEEPER, UNDERTAKER, PIT_HAG, INNKEEPER, NO_DASHII, VIGORMORTIS, GAMBLER, SHABALOTH, WITCH, GODFATHER, MOONCHILD, TOWN_CRIER, ORACLE, PROFESSOR, DEVILS_ADVOCATE];
