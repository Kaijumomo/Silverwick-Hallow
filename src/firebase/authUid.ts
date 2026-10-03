/**
 * The supported Firebase Authentication UID contract (PHASE10F Section 44,
 * SOL-10F-E1). Pure constants only (no Firebase SDK, no I/O), so the
 * Storyteller store may import it.
 *
 * Firebase Authentication never issues or accepts a UID longer than 128
 * characters. Source of truth: Firebase's own Admin SDK (firebase-admin
 * 13.10.0, lib/utils/validator.js):
 *
 *   function isUid(uid) {
 *     return typeof uid === 'string' && uid.length > 0 && uid.length <= 128;
 *   }
 *
 * with AuthClientErrorCode.INVALID_UID "The uid must be a non-empty string
 * with at most 128 characters." -- enforced for every UID a project can
 * choose (createUser, importUsers, createCustomToken). UIDs Firebase mints
 * itself are shorter: Silverwick signs in anonymously only, and the
 * installed Auth emulator (firebase-tools 14.27.0, emulator/auth/state.js
 * generateLocalId) mints 28 alphanumeric characters. Every UID in a lobby's
 * roster or storytellerUid is an authenticated `auth.uid` (Firebase Rules:
 * joinRequests/{uid} requires `$uid === auth.uid`, and the Storyteller seats
 * only those UIDs), so this is a platform limit, not a Silverwick policy.
 */
export const MAX_AUTH_UID_LENGTH = 128;
