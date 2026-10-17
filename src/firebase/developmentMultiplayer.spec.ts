// @vitest-environment jsdom
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment, type TokenOptions } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from 'firebase/database';
import { FirebaseRoomBackend } from './firebaseBackend';
import { createLobby, knockOnLobby, seatPlayer, revokeMembership } from './lobby';
import { SessionWriter } from './writer';
import { requireActiveSession } from './lifecycle';
import type { PlayerSelfRecord } from '@/stores/types';

let env: RulesTestEnvironment;
const code = 'ABCD2345', otherCode = 'BCDE3456';
const st = 'approved-storyteller', alice = 'approved-alice', bob = 'approved-bob', otherSt = 'other-storyteller';
const sessionId = 'synthetic-session-1';
const anonymous: TokenOptions = { firebase: { sign_in_provider: 'anonymous', identities: {} } };
const path = (suffix: string, room = code) => `lobbies/${room}/${suffix}`;
const db = (uid: string, claims = anonymous) => env.authenticatedContext(uid, claims).database();
const backend = (uid: string) => new FirebaseRoomBackend(db(uid) as unknown as Database);
const read = (uid: string, suffix: string, room = code) => db(uid).ref(path(suffix, room)).once('value');
const account = (role: string) => ({ enabled: true, role, expiresAt: Date.now() + 3_600_000 });
const grant = (id = sessionId) => ({ sessionId: id, expiresAt: Date.now() + 3_600_000, players: { [alice]: true, [bob]: true } });
async function adminUpdate(values: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (context) => { await context.database().ref().update(values); });
}
function room(owner = st, id = sessionId) {
  return {
    storytellerUid: owner, session: { version: 2, id, state: 'active' },
    writer: { token: 'current-writer', expiresAt: Date.now() + 30_000 },
    writeGuard: { token: 'current-writer', revision: 1 },
    public: { code, phase: 'day', day: 1 },
    roster: { [alice]: 'p-alice' },
    rosterParticipants: { [alice]: { playerId: 'p-alice', participantId: 'participant-alice', name: 'Alice' } },
    player: { 'p-alice': { shownRole: 'chef', shownAlignment: 'good' }, 'p-bob': { shownRole: 'imp', shownAlignment: 'evil' } },
    storyteller: { secret: 'synthetic hidden role' }, checkpoint: 'synthetic checkpoint',
    displayAccess: { version: 1, sessionId: id, token: 'a'.repeat(43) }, displayMembers: { [bob]: 'a'.repeat(43) },
  };
}
beforeAll(async () => {
  const address = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  if (!address || !/^(127\.0\.0\.1|localhost):\d+$/.test(address)) throw new Error('Local RTDB emulator required.');
  const [host, port] = address.split(':');
  env = await initializeTestEnvironment({ projectId: 'demo-silverwick-rules', database: {
    host, port: Number(port), rules: readFileSync(resolve(__dirname, 'development.multiplayer.rules.json'), 'utf8'),
  } });
});
afterAll(async () => { if (env) await env.cleanup(); });
beforeEach(async () => {
  await env.clearDatabase();
  await adminUpdate({
    developmentAccess: {
      users: { [st]: account('storyteller'), [otherSt]: account('storyteller'), [alice]: account('player'), [bob]: account('player') },
      games: { [code]: grant(), [otherCode]: grant('different-session') },
    },
    [`lobbies/${code}`]: room(), [`lobbies/${otherCode}`]: room(otherSt, 'different-session'),
  });
});

describe('administrator-only development enrollment', () => {
  it.each([null, 'unknown', st, alice])('cannot enumerate or self-enroll: %s', async (uid) => {
    const client = uid ? db(uid) : env.unauthenticatedContext().database();
    for (const target of ['developmentAccess', 'developmentAccess/users', `developmentAccess/users/${uid ?? 'unknown'}`, `developmentAccess/games/${code}`]) {
      await assertFails(client.ref(target).once('value'));
      await assertFails(client.ref(target).set(account('storyteller')));
      await assertFails(client.ref(target).remove());
    }
  });
  it('forged admin claims do not grant administrative data access', async () => {
    const client = env.authenticatedContext(alice, { ...anonymous, admin: true }).database();
    await assertFails(client.ref(`developmentAccess/users/${alice}`).update({ role: 'storyteller' }));
  });
  it('atomic self-enrollment plus game mutation is denied entirely', async () => {
    await assertFails(db('unknown').ref().update({
      'developmentAccess/users/unknown': account('storyteller'),
      [path('storytellerUid', 'CDEF4567')]: 'unknown',
    }));
    await env.withSecurityRulesDisabled(async (ctx) => {
      expect((await ctx.database().ref('developmentAccess/users/unknown').once('value')).exists()).toBe(false);
      expect((await ctx.database().ref('lobbies/CDEF4567').once('value')).exists()).toBe(false);
    });
  });
  it.each(['password', 'google.com', 'custom'] as const)('rejects allowlisted UID with provider %s', async (provider) => {
    const client = db(alice, { firebase: { sign_in_provider: provider, identities: {} } });
    await assertFails(client.ref(path('public')).once('value'));
    await assertFails(client.ref(path(`leaveRequests/${alice}`)).set(true));
  });
  it('rejects an allowlisted identity without an anonymous provider claim', async () => {
    await assertFails(env.authenticatedContext(alice).database().ref(path('public')).once('value'));
  });
  it.each([null, 'admin', 'unknown'])('rejects missing/unknown role %s', async (role) => {
    await adminUpdate({ [`developmentAccess/users/${alice}/role`]: role });
    await assertFails(read(alice, 'public'));
    await assertFails(db(alice).ref(path(`leaveRequests/${alice}`)).set(true));
  });
  it.each([null, 'unknown'])('rejects unauthorized identity %s despite existing game records', async (uid) => {
    if (uid) await adminUpdate({ [path(`roster/${uid}`)]: 'p-alice', [`developmentAccess/games/${code}/players/${uid}`]: true });
    const client = uid ? db(uid) : env.unauthenticatedContext().database();
    for (const suffix of ['session', 'storytellerUid', 'public', 'player/p-alice', 'storyteller', 'checkpoint']) {
      await assertFails(client.ref(path(suffix)).once('value'));
    }
    await assertFails(client.ref(path(`joinRequests/${uid ?? 'unknown'}`)).set('Unknown'));
  });
  it.each([false, 'true', null])('requires boolean enabled=true, not %s', async (enabled) => {
    await adminUpdate({ [`developmentAccess/users/${alice}/enabled`]: enabled });
    await assertFails(read(alice, 'public'));
  });
  it.each([0, '9999999999999', null])('requires unexpired numeric account expiry: %s', async (expiresAt) => {
    await adminUpdate({ [`developmentAccess/users/${st}/expiresAt`]: expiresAt });
    await assertFails(read(st, 'storyteller'));
    await assertFails(db(st).ref(path('writer')).set({ token: 'current-writer', expiresAt: Date.now() + 30_000 }));
  });
  it('revocation denies future reads/writes and cancels an existing private subscription', async () => {
    const client = db(alice), target = client.ref(path('player/p-alice'));
    let received = false, cancelled = false;
    const listener = target.on('value', () => { received = true; }, () => { cancelled = true; });
    try {
      await vi.waitFor(() => expect(received).toBe(true));
      await adminUpdate({ [`developmentAccess/users/${alice}/enabled`]: false });
      await vi.waitFor(() => expect(cancelled).toBe(true));
      await assertFails(client.ref(path(`presence/${alice}`)).set({ online: false, lastSeen: Date.now() }));
      await assertFails(read(alice, 'player/p-alice'));
    } finally { target.off('value', listener); }
  });
});

describe('per-game permissions and private data', () => {
  it('allows only the seated player own private view; pending joins see only public', async () => {
    await assertSucceeds(read(alice, 'player/p-alice'));
    await assertFails(read(bob, 'public')); // old display membership cannot bypass admission
    await knockOnLobby(backend(bob), code, bob, 'Bob');
    await assertSucceeds(read(bob, 'public'));
    await assertFails(read(bob, 'player/p-bob'));
    await assertFails(read(bob, 'player/p-alice'));
  });
  it.each(['', 'roster', 'rosterParticipants', 'player', 'player/p-bob', 'storyteller', 'checkpoint', 'writer', 'writeGuard', 'joinRequests', `roster/${bob}`, `outcomes/${bob}`, 'displayAccess'])('denies player private/ancestor read: %s', async (suffix) => {
    await assertFails(read(alice, suffix));
  });
  it.each([st, alice])('denies root, lobby enumeration, unknown data for %s', async (uid) => {
    await assertFails(db(uid).ref().once('value'));
    for (const target of ['lobbies', 'unrecognized']) await assertFails(db(uid).ref(target).once('value'));
  });
  it.each(['storytellerUid', 'session', 'public', 'player/p-alice', `roster/${alice}`, 'storyteller', 'checkpoint', 'writer', 'writeGuard'])('player cannot write authoritative %s', async (suffix) => {
    await assertFails(db(alice).ref(path(suffix)).set('forged'));
    await assertFails(db(alice).ref(path(suffix)).remove());
  });
  it('cannot access an ungranted game even with a roster and leaked display token', async () => {
    await adminUpdate({ [`developmentAccess/games/${otherCode}/players/${alice}`]: null });
    for (const suffix of ['session', 'storytellerUid', 'public', 'player/p-alice', `roster/${alice}`]) await assertFails(read(alice, suffix, otherCode));
    await assertFails(db(alice).ref(path(`leaveRequests/${alice}`, otherCode)).set(true));
  });
  it('one unauthorized game rejects a mixed-game atomic update', async () => {
    await adminUpdate({ [`developmentAccess/games/${otherCode}/players/${alice}`]: null });
    await assertFails(db(alice).ref().update({ [path(`leaveRequests/${alice}`)]: true, [path(`leaveRequests/${alice}`, otherCode)]: true }));
    expect((await read(alice, `leaveRequests/${alice}`)).exists()).toBe(false);
  });
  it.each([['sessionId', 'old-session'], ['sessionId', null], ['expiresAt', 0], ['expiresAt', '9999999999999'], [`players/${alice}`, false], [`players/${alice}`, 'true']])('rejects revoked/stale/malformed game grant: %s=%s', async (field, value) => {
    await adminUpdate({ [`developmentAccess/games/${code}/${field}`]: value });
    await assertFails(read(alice, 'public'));
    await assertFails(db(alice).ref(path(`leaveRequests/${alice}`)).set(true));
    await assertFails(db(alice).ref(path(`joinRequests/${alice}`)).remove());
    await assertFails(db(alice).ref(path(`presence/${alice}`)).remove());
  });
  it('removing membership denies private/public views while preserving own revoked outcome', async () => {
    await adminUpdate({ [path(`roster/${alice}`)]: null, [path(`outcomes/${alice}`)]: 'revoked' });
    await assertFails(read(alice, 'player/p-alice'));
    await assertFails(read(alice, 'public'));
    expect((await read(alice, `outcomes/${alice}`)).val()).toBe('revoked');
    await assertFails(db(alice).ref(path(`joinRequests/${alice}`)).set('Alice'));
  });
  it('display token enrollment stays disabled even for approved users', async () => {
    for (const uid of [st, alice, bob]) await assertFails(db(uid).ref(path(`displayMembers/${uid}`)).set('a'.repeat(43)));
  });
  it('player requests cannot impersonate other UIDs or carry invalid payloads', async () => {
    for (const suffix of [`leaveRequests/${bob}`, `revealAcks/${bob}`, `presence/${bob}`, `travelerChoices/${bob}`]) await assertFails(db(alice).ref(path(suffix)).set(true));
    await assertFails(db(bob).ref(path(`joinRequests/${bob}`)).set('x'.repeat(21)));
    await assertFails(db(alice).ref(path(`travelerChoices/${alice}`)).set('imp'));
    await assertFails(db(alice).ref(path(`revealAcks/${alice}`)).set('short'));
    await assertSucceeds(db(alice).ref(path(`travelerChoices/${alice}`)).set('beggar'));
    await assertSucceeds(db(alice).ref(path(`revealAcks/${alice}`)).set('synthetic_token_123456'));
    await assertSucceeds(db(alice).ref(path(`leaveRequests/${alice}`)).set(true));
  });
});

describe('existing Storyteller authority and stale-session fencing', () => {
  const fenced = (uid = st, token = 'current-writer', revision = 2) => db(uid).ref().update({
    [path('public/day')]: 2, [path('writeGuard')]: { token, revision },
  });
  it('owner may publish through the existing fenced atomic write', async () => {
    await assertSucceeds(fenced());
    expect((await read(alice, 'public/day')).val()).toBe(2);
  });
  it('another approved Storyteller cannot read/write or take over the game', async () => {
    await assertFails(read(otherSt, 'storyteller'));
    await assertFails(read(otherSt, 'public'));
    await assertFails(fenced(otherSt));
    await assertFails(db(otherSt).ref(path('storytellerUid')).set(otherSt));
  });
  it('player role cannot claim a game or gain Storyteller privileges through a forged roster', async () => {
    await assertFails(createLobby(backend(alice), alice, { codeGenerator: () => 'CDEF4567' }));
    await adminUpdate({ [path('storytellerUid')]: alice });
    // Admin misassignment is still not a player-to-Storyteller escalation.
    await assertFails(read(alice, 'storyteller'));
    await assertFails(fenced(alice));
  });
  it('expired/deleted Storyteller allowlist denies even old secrets and cleanup writes', async () => {
    await adminUpdate({ [`developmentAccess/users/${st}`]: null });
    await assertFails(read(st, 'checkpoint'));
    await assertFails(fenced());
    await assertFails(db(st).ref(path('writer')).set({ token: 'current-writer', expiresAt: 0 }));
  });
  it('will not claim an orphan containing old private data', async () => {
    await adminUpdate({ 'lobbies/CDEF4567/player/p-alice': { secret: 'orphan' } });
    await assertFails(createLobby(backend(st), st, { codeGenerator: () => 'CDEF4567' }));
  });
  it.each([['stale-writer', 2], ['current-writer', 1]])('rejects stale writer token/revision %s %s', async (token, revision) => {
    await assertFails(fenced(st, token as string, revision as number));
  });
  it('rejects expired leases and bare projection writes', async () => {
    await assertFails(db(st).ref(path('public/day')).set(2));
    await adminUpdate({ [path('writer/expiresAt')]: 0 });
    await assertFails(fenced());
  });
  it('session IDs cannot rotate or ended sessions reopen through client writes', async () => {
    await assertFails(db(st).ref(path('session')).set({ version: 2, id: 'replacement', state: 'active' }));
    await adminUpdate({ [path('session/state')]: 'ended' });
    await assertFails(fenced());
    await assertFails(db(st).ref(path('session')).set({ version: 2, id: sessionId, state: 'active' }));
    await assertFails(read(alice, 'public'));
    await assertFails(read(alice, 'player/p-alice'));
    await assertFails(db(alice).ref(path(`leaveRequests/${alice}`)).set(true));
  });
  it('session-bound grants fail closed if an administrator replaces a session', async () => {
    await adminUpdate({ [path('session/id')]: 'replacement' });
    await assertFails(read(alice, 'session'));
    await assertFails(read(alice, 'player/p-alice'));
    await assertFails(db(alice).ref(path(`revealAcks/${alice}`)).set('synthetic_token_123456'));
  });
  it('ended results are own-UID only, require current grant, and never expose checkpoint', async () => {
    await adminUpdate({ [path('session/state')]: 'ended', [path(`results/${alice}`)]: {
      version: 1, sessionId, winner: 'good', declaredAt: { phase: 'day', day: 1 },
    } });
    await assertSucceeds(read(alice, `results/${alice}`));
    await assertFails(read(bob, `results/${alice}`));
    await assertFails(read(alice, 'checkpoint'));
    await adminUpdate({ [`developmentAccess/games/${code}/players/${alice}`]: null });
    await assertFails(read(alice, `results/${alice}`));
  });
  it('real create, lease, join, seat, private read, revoke and close work with admin admission', async () => {
    const freshCode = 'CDEF4567';
    await createLobby(backend(st), st, { codeGenerator: () => freshCode });
    const session = await requireActiveSession(backend(st), freshCode);
    await assertFails(read(alice, 'session', freshCode));
    await adminUpdate({ [`developmentAccess/games/${freshCode}`]: grant(session.id) });
    const writer = new SessionWriter(backend(st), freshCode, session.id);
    try {
      await writer.start();
      await writer.set(path('public', freshCode), { code: freshCode, phase: 'setup', day: 0 });
      await knockOnLobby(backend(alice), freshCode, alice, 'Alice');
      await seatPlayer(writer, freshCode, alice, 'p-alice', { shownRole: 'chef', shownAlignment: 'good' } as PlayerSelfRecord);
      expect((await read(alice, 'player/p-alice', freshCode)).val().shownRole).toBe('chef');
      await assertFails(read(bob, 'player/p-alice', freshCode));
      await revokeMembership(writer, freshCode, alice);
      await assertFails(read(alice, 'player/p-alice', freshCode));
      await writer.close([]);
      expect((await read(st, 'session/state', freshCode)).val()).toBe('ended');
    } finally { await writer.dispose(); }
  });
});
