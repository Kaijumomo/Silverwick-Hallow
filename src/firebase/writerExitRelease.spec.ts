// @vitest-environment jsdom
// WP 4-3a: a page that unloads hands its writer lease back, and writer fencing still holds (production Rules, emulator).
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "firebase/database";
import { FirebaseRoomBackend } from "./firebaseBackend";
import { createLobby } from "./lobby";
import { requireActiveSession } from "./lifecycle";
import { SessionWriter } from "./writer";

const uid = "exit-st";
let env: RulesTestEnvironment;
const code = "EXITABCD";
const root = `lobbies/${code}`;
const be = () => new FirebaseRoomBackend(env.authenticatedContext(uid).database() as unknown as Database);
const adminRead = async (p: string) => { let r: unknown; await env.withSecurityRulesDisabled(async c => { r = (await c.database().ref(p).once("value")).val(); }); return r; };
beforeAll(async () => {
  const [host, port] = process.env.FIREBASE_DATABASE_EMULATOR_HOST!.split(":");
  env = await initializeTestEnvironment({ projectId: "demo-silverwick-rules", database: { host, port: Number(port), rules: readFileSync(resolve(__dirname, "rules.json"), "utf8") } });
});
beforeEach(async () => { await env.clearDatabase(); const b = be(); await createLobby(b, uid, { codeGenerator: () => code }); });
afterAll(async () => { await env.cleanup(); });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe("WP 4-3a: releaseOnExit against the production Rules (emulator)", () => {
  test("releases own lease; a new writer can start at once", async () => {
    const b1 = be(); const s = await requireActiveSession(b1, code);
    const a = new SessionWriter(b1, code, s.id); await a.start();
    expect(a.releaseOnExit()).toBe(true);
    await sleep(300);
    expect(await adminRead(`${root}/writer`)).toMatchObject({ token: a.token, expiresAt: 0 });
    const c = new SessionWriter(be(), code, s.id); await c.start();
    expect((await adminRead(`${root}/writer`) as any).token).toBe(c.token);
    c.stop();
  });
  test("stale writer A (lease taken over by B) cannot clobber B via releaseOnExit", async () => {
    const b1 = be(); const s = await requireActiveSession(b1, code);
    const a = new SessionWriter(b1, code, s.id); await a.start();
    // simulate A's lease lapsed and B took over
    await env.withSecurityRulesDisabled(async c => { await c.database().ref(`${root}/writer`).set({ token: "B", expiresAt: Date.now() + 20000 }); });
    expect(a.releaseOnExit()).toBe(true);
    await sleep(400);
    expect(await adminRead(`${root}/writer`)).toMatchObject({ token: "B" });
    expect(((await adminRead(`${root}/writer`)) as any).expiresAt).toBeGreaterThan(Date.now());
  });
  test("commit whose update is sent after the release is refused", async () => {
    const b1 = be(); const s = await requireActiveSession(b1, code);
    const a = new SessionWriter(b1, code, s.id); await a.start();
    // start a commit but make its receipt get slow: wrap raw get for writeGuard
    const raw: any = (a as any).raw; const get = raw.get.bind(raw);
    raw.get = async (p: string) => { const v = await get(p); if (p.endsWith("/writeGuard")) await sleep(400); return v; };
    const pending = a.update({ [`${root}/public/probe`]: "x" } as any).then(() => "ok", e => `err:${e?.message ?? e}`);
    await sleep(100);
    a.releaseOnExit();
    const res = await pending;
    await sleep(200);
    expect(res).toMatch(/^err:/);
    expect(await adminRead(`${root}/public/probe`)).toBeNull();
  });
  test("renewal transaction in flight when releaseOnExit fires: final server state is released", async () => {
    const b1 = be(); const s = await requireActiveSession(b1, code);
    const a = new SessionWriter(b1, code, s.id); await a.start();
    const p = (a as any).renew().then(() => "ok", (e: any) => `err:${e?.message}`);
    a.releaseOnExit();
    await p; await sleep(500);
    expect((await adminRead(`${root}/writer`) as any).expiresAt).toBe(0);
  });
});
