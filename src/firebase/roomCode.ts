/**
 * The ONE supported lobby (room) code contract -- shared by code generation,
 * join validation, display formatting and the Storyteller store's pre-commit
 * Firebase write-compatibility preflight (PHASE10F Section 39, SOL-10F-C3).
 * Pure constants only (no Firebase SDK, no I/O), so the store may import it.
 */

/** Confusable-glyph-free alphabet (no 0/O, 1/I/L). */
export const ROOM_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXYZ23456789";

/** Every supported lobby code is exactly this many characters. */
export const ROOM_CODE_LENGTH = 8;

/** A canonical (normalised) lobby code a player may join with. */
export const ROOM_CODE_PATTERN = new RegExp(`^[A-Z0-9]{${ROOM_CODE_LENGTH}}$`);

/**
 * SOL-10F-C3: the canonical MAXIMUM supported lobby-code shape -- a full-length
 * code of the generator's own alphabet. Every supported code is exactly
 * ROOM_CODE_LENGTH single-byte characters, so a destination path built with
 * this placeholder is exactly as long as one built with any real code: a game
 * resolved before a room exists is never accepted merely because an empty or
 * shorter placeholder made its Firebase paths fit.
 */
export const MAX_ROOM_CODE_SHAPE = ROOM_CODE_ALPHABET[ROOM_CODE_ALPHABET.length - 1]!.repeat(ROOM_CODE_LENGTH);
