import type { AbilityDescriptor } from "../semantics";
import { MONK } from "./monk";
import { POISONER } from "./poisoner";

/**
 * Phase 10F Slice 7: the verified proof / support semantics, each traced to
 * its section of docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md. This list IS the
 * production Ability Semantics Registry (semantics.ts); it is only ever
 * consulted through the canonical ownership gate (resolveAbilitySemantics).
 */
export const VERIFIED_DESCRIPTORS: readonly AbilityDescriptor[] = [POISONER, MONK];
