// Milestone 4 internal multiplayer game (WP 4-1b / 4-2a). Run through scripts/harness/run-multiplayer.mjs,
// which starts the local Firebase emulators (production Rules) and serves the harness build.
//
// One Storyteller tablet, five phones and a Public Display, each in its own browser context (separate
// storage, separate anonymous sign-in), play a short Trouble Brewing game. Every step records PASS or FAIL,
// why it matters, and screenshots. The run stops at the first failure, because later steps depend on it.
//
// What this proves: the real built app, real Firebase SDK and production Rules carry joining, seating,
// reveals, the Display, Undo, an offline phone, phone and Storyteller refreshes and the game end between
// separate devices. What it does not prove: real phone hardware and browsers (iOS Safari, installed app),
// real mobile networks, QR scanning, the on-screen keyboard, or the hosted test project.
//
// --script=<file.json> --cast=Alice:Clockwinder,Bob:Dread,... plays the same game with an imported custom script
// instead of Trouble Brewing, and adds a step that checks each phone's character and Script tab show the
// script's own names and ability text (homebrew and modified characters).
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const BASE = args.url ?? "http://127.0.0.1:5199/";
const OUT = args.out ?? join(process.cwd(), "harness-output");
const DB = `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST ?? "127.0.0.1:9000"}`;
const NS = "silverwick-hollow-default-rtdb";
mkdirSync(OUT, { recursive: true });

// Fixed characters so every run is the same game (a legal 5-player Trouble Brewing setup: 3 Townsfolk,
// 0 Outsiders, 1 Minion, 1 Demon).
const CAST = args.cast
  ? args.cast.split(",").map((pair) => { const [name, role] = pair.split(":"); return { name, role }; })
  : [
    { name: "Alice", role: "Chef" },
    { name: "Bob", role: "Imp" },
    { name: "Carol", role: "Empath" },
    { name: "Dan", role: "Poisoner" },
    { name: "Eve", role: "Washerwoman" },
  ];
/** Character id as the script spells it: "Hollow Bell" -> "hollowbell" (official ids follow the same rule). */
const roleId = (role) => role.toLowerCase().replace(/[^a-z0-9]/g, "");
const ROLE_IDS = CAST.map((c) => roleId(c.role));
// Imported custom script (optional): its character objects, by id, for the phone checks.
const SCRIPT = args.script ? resolve(args.script) : null;
const SCRIPT_OBJECTS = SCRIPT
  ? Object.fromEntries(JSON.parse(readFileSync(SCRIPT, "utf8")).filter((e) => e && typeof e === "object" && e.id !== "_meta").map((e) => [e.id, e]))
  : {};
for (const [i, c] of CAST.entries()) if (!c.name || !c.role) throw new Error(`--cast entry ${i + 1} must be Name:Role`);

const results = [];
let shot = 0;
const devices = {}; // label -> page
const frames = {}; // label -> Firebase websocket messages { dir: "in" | "out", text, conn }
let connections = 0;
const longPolls = {}; // label -> Firebase long-polling requests (traffic the websocket capture cannot see)

function track(label, page) {
  devices[label] = page;
  frames[label] ??= [];
  page.on("websocket", (ws) => {
    const conn = ++connections; // request ids restart on every connection
    // Firebase splits long messages: a frame holding only a count, then that many parts.
    const reader = (dir) => {
      let pending = null;
      return ({ payload }) => {
        const text = typeof payload === "string" ? payload : payload.toString("utf8");
        if (pending) {
          pending.parts.push(text);
          if (pending.parts.length === pending.count) { frames[label].push({ dir, text: pending.parts.join(""), conn }); pending = null; }
        } else if (/^\d+$/.test(text)) pending = { count: Number(text), parts: [] };
        else frames[label].push({ dir, text, conn });
      };
    };
    ws.on("framereceived", reader("in"));
    ws.on("framesent", reader("out"));
  });
  page.on("request", (req) => { if (/[?&]start=t|\/\.lp\?/.test(req.url())) longPolls[label] = (longPolls[label] ?? 0) + 1; });
  page.on("response", async (res) => {
    if (!/\/\.lp\?/.test(res.url())) return;
    const body = await res.text().catch(() => null);
    frames[label].push({ dir: "lp", text: body ?? "", url: res.url() });
  });
  page.on("pageerror", (e) => console.log(`[${label}] page error: ${e.message}`));
}

async function snap(labels, tag) {
  const files = [];
  for (const label of labels) {
    const page = devices[label];
    if (!page || page.isClosed()) continue;
    const file = `${String(++shot).padStart(2, "0")}-${tag}-${label}.png`;
    await page.screenshot({ path: join(OUT, file) }).catch(() => {});
    files.push(file);
  }
  return files;
}

async function step(name, why, fn, show = []) {
  const started = Date.now();
  try {
    const note = await fn();
    const files = await snap(show, slug(name));
    results.push({ name, why, ok: true, note: note ?? "", ms: Date.now() - started, files });
    console.log(`PASS  ${name}${note ? `: ${note}` : ""}`);
  } catch (error) {
    const files = await snap(Object.keys(devices), `FAIL-${slug(name)}`);
    results.push({ name, why, ok: false, note: String(error?.message ?? error).split("\n")[0], ms: Date.now() - started, files });
    console.log(`FAIL  ${name}: ${error?.message ?? error}`);
    throw error;
  }
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function expect(cond, message) { if (!cond) throw new Error(message); }

async function until(check, message, timeout = 15000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { last = await check(); if (last) return last; } catch (e) { last = e; }
    await sleep(250);
  }
  throw new Error(`${message}${last instanceof Error ? ` (${last.message})` : ""}`);
}

/** Server-side truth from the emulator, read with emulator admin rights (never available to an app). */
async function server(path) {
  const res = await fetch(`${DB}/${path}.json?ns=${NS}`, { headers: { Authorization: "Bearer owner" } });
  if (!res.ok) throw new Error(`emulator read ${path}: ${res.status}`);
  return res.json();
}

const button = (page, name) => page.getByRole("button", { name }).first();
const click = (page, name, timeout = 8000) => button(page, name).click({ timeout });

async function main() {
  const browser = await chromium.launch();
  const tablet = { viewport: { width: 1524, height: 968 } };
  const phone = { viewport: { width: 428, height: 926 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
  const st = await (await browser.newContext(tablet)).newPage();
  track("storyteller", st);
  let code = "";
  const phones = {};
  const ids = {}; // name -> playerId, read from the public node

  try {
    await step(`Storyteller creates an online ${SCRIPT ? "custom script" : "Trouble Brewing"} game`, "Invite to Phones must create a live lobby on Firebase", async () => {
      await st.goto(BASE);
      await click(st, /New game/);
      if (SCRIPT) await st.locator('label[title="Import a custom script"] input[type=file]').setInputFiles(SCRIPT);
      else await st.locator('button[title="Trouble Brewing"]').click();
      for (let i = 0; i < 5; i++) await click(st, "One fewer player");
      await click(st, /Fabled & Loric ›/);
      await click(st, /Skip to the town/);
      await click(st, /Players join by code/i);
      const invite = st.getByRole("button", { name: /^Invite / });
      await invite.waitFor({ timeout: 20000 });
      code = (await invite.innerText()).replace(/^INVITE\s*/i, "").replace(/[–\-\s]/g, "");
      expect(/^[A-Z0-9]{8}$/.test(code), `unexpected invite code "${code}"`);
      const owner = await until(() => server(`lobbies/${code}/storytellerUid`), "lobby never appeared on the server");
      return `lobby ${code} created (owner ${String(owner).slice(0, 6)}…)`;
    }, ["storyteller"]);

    await step("Public Display opens from the Storyteller's display link on its own device", "The TV must show the town without any Storyteller data", async () => {
      await st.getByRole("button", { name: /^Invite / }).click();
      const [popup] = await Promise.all([st.context().waitForEvent("page"), click(st, "Public display ↗")]);
      const link = popup.url();
      await popup.close();
      expect(link.includes("display=public") && link.includes("#"), `unexpected display link ${link.split("#")[0]}`);
      await click(st, /^Done$/);
      const tv = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
      track("display", tv);
      await tv.goto(link);
      await until(async () => (await server(`lobbies/${code}/displayAccess`)) !== null, "display was never admitted");
      await tv.waitForTimeout(1500);
      return "display admitted with its own sign-in";
    }, ["display"]);

    await step("Five phones join with the code", "Each phone must reach the lobby and see the whole town gather", async () => {
      for (const { name } of CAST) {
        const page = await (await browser.newContext(phone)).newPage();
        track(name, page);
        await page.goto(`${BASE}?join=${code}`);
        await page.getByLabel("Your name").fill(name);
        await click(page, /Enter the town/i);
        phones[name] = page;
      }
      for (const { name } of CAST) {
        await until(async () => (await phones[name].locator("body").innerText()).includes("5 of 5 arrived"), `${name} never saw 5 of 5 arrived`);
      }
      await until(async () => (await st.locator("body").innerText()).match(/5\s+WAITING/i), "Storyteller never saw 5 waiting");
      return "all five phones see 5 of 5 arrived; the Storyteller sees 5 waiting";
    }, ["storyteller", "Alice"]);

    await step("Storyteller seats all five", "Seating binds each phone to exactly one seat", async () => {
      await click(st, /waiting/i);
      for (let i = 0; i < 5; i++) await click(st, /^Assign$/);
      await st.keyboard.press("Escape");
      const pub = await until(async () => {
        const p = await server(`lobbies/${code}/public`);
        return p?.seatOrder?.length === 5 && Object.keys(p.players ?? {}).length === 5 ? p : null;
      }, "public seat order never reached 5");
      for (const [id, p] of Object.entries(pub.players)) ids[p.name] = id;
      for (const { name } of CAST) {
        await until(async () => (await phones[name].locator("body").innerText()).toUpperCase().includes("YOUR PLACE IN"), `${name} never saw a seat`);
      }
      return "five seats bound; every phone shows its place in the circle";
    }, ["Bob"]);

    await step("Storyteller deals fixed characters, seals and reveals", "Characters reach only their own phone", async () => {
      await click(st, /^Deal roles$/);
      for (const { role } of CAST) await click(st, new RegExp(`^${role}$`));
      await click(st, /Place one by one/);
      for (const { name, role } of CAST) await click(st, `Give ${role} to ${name}`);
      await click(st, /Seal the Grimoire/);
      await click(st, /^Reveal roles$/);
      for (const { name } of CAST) await button(phones[name], /Receive your character/i).waitFor({ timeout: 15000 });
      return "every phone offers Receive your character";
    }, ["storyteller"]);

    await step("Each phone turns over its own character", "Each player must see exactly their own character", async () => {
      for (const { name, role } of CAST) {
        const page = phones[name];
        await click(page, /Receive your character/i);
        await click(page, /Turn your token over/i);
        await until(async () => (await page.locator("body").innerText()).toUpperCase().includes(role.toUpperCase()), `${name} never saw ${role}`);
      }
      await snap(CAST.map((c) => c.name), "reveal");
      for (const { name } of CAST) await click(phones[name], /Enter the town/i);
      return CAST.map((c) => `${c.name} ${c.role}`).join(", ");
    });

    if (SCRIPT) await step("Phones show the script's own characters", "Homebrew and modified characters must reach phones as the script sheet prints them, with no wake line for homebrew", async () => {
      const seen = [];
      for (const { name, role } of CAST) {
        const def = SCRIPT_OBJECTS[roleId(role)];
        if (!def) continue; // an official character, already checked by name above
        const page = phones[name];
        const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
        expect(text.toUpperCase().includes(def.name.toUpperCase()), `${name}'s character tab does not name ${def.name}`);
        expect(text.includes(def.ability), `${name}'s character tab does not show the script's ability text for ${def.name}`);
        expect(!/\bwakes?\b|does not wake/i.test(text), `${name}'s character tab shows a wake line for ${def.name}`);
        seen.push(`${name} ${def.name}`);
      }
      await snap(CAST.filter((c) => SCRIPT_OBJECTS[roleId(c.role)]).map((c) => c.name), "own-character");
      const viewer = CAST[0].name;
      await phones[viewer].getByRole("button", { name: /^Script$/ }).click({ timeout: 8000 });
      await phones[viewer].waitForTimeout(800);
      const sheet = (await phones[viewer].locator("body").innerText()).replace(/\s+/g, " ");
      for (const def of Object.values(SCRIPT_OBJECTS)) {
        if (!["townsfolk", "outsider", "minion", "demon"].includes(def.team)) continue;
        expect(sheet.includes(def.name) && sheet.includes(def.ability), `${viewer}'s Script tab does not list ${def.name} with the script's ability text`);
      }
      await snap([viewer], "script-tab");
      await phones[viewer].getByRole("button", { name: /^Character$/ }).click({ timeout: 8000 });
      return `character tabs show the script's name and ability with no wake line: ${seen.join(", ")}; ${viewer}'s Script tab lists all ${Object.keys(SCRIPT_OBJECTS).length} script-defined characters with their text`;
    });

    await step("Night 1, then Day 1", "Phase changes must reach the phones and the Display", async () => {
      await click(st, /Begin night 1/i);
      await until(async () => (await server(`lobbies/${code}/public/phase`)) === "night", "public phase never became night");
      await click(st, /^Begin Day 1$/);
      await st.waitForTimeout(500);
      if (await button(st, /^Begin Day 1$/).isVisible().catch(() => false)) await click(st, /^Begin Day 1$/);
      await until(async () => (await server(`lobbies/${code}/public/phase`)) === "day", "public phase never became day");
      await until(async () => /DAY 1/i.test(await phones.Alice.locator("body").innerText()), "Alice's phone never showed Day 1");
      return "public phase is day; phones show Day 1";
    }, ["storyteller", "display", "Alice"]);

    const alive = async (name) => (await server(`lobbies/${code}/public/players/${ids[name]}/alive`));
    const killFromGrimoire = async (name) => {
      await st.getByLabel(new RegExp(`^Seat \\d, ${name}`)).first().click();
      await click(st, /^Kill$/);
    };

    await step("Storyteller kills Carol; everyone sees it", "A death must reach every phone and the Display", async () => {
      await killFromGrimoire("Carol");
      await until(async () => (await alive("Carol")) === false, "Carol never became dead on the server");
      await phones.Carol.waitForTimeout(1500);
      return "public record shows Carol dead";
    }, ["display", "Carol", "Alice"]);

    await step("Undo brings Carol back everywhere", "Undo must reverse what phones and the Display were shown", async () => {
      await st.keyboard.press("Escape");
      await click(st, /^Undo$/);
      await until(async () => (await alive("Carol")) === true, "Carol never came back alive on the server");
      await phones.Carol.waitForTimeout(1500);
      return "public record shows Carol alive again";
    }, ["display", "Carol"]);

    await step("A phone that was offline catches up", "A phone that drops its connection must show what it missed", async () => {
      await phones.Alice.context().setOffline(true);
      await killFromGrimoire("Eve");
      await until(async () => (await alive("Eve")) === false, "Eve never became dead on the server");
      await phones.Alice.waitForTimeout(1500);
      await phones.Alice.context().setOffline(false);
      await phones.Alice.getByRole("button", { name: /^Town$/ }).click({ timeout: 8000 });
      const town = await until(async () => {
        const t = (await phones.Alice.locator("body").innerText()).replace(/\s+/g, " ");
        return /\b4 ALIVE\b/i.test(t) && /Eve Ghost/.test(t) ? t : null;
      }, "after reconnecting, Alice's Town tab never showed Eve as a ghost with 4 alive");
      await snap(["Alice"], "alice-town-after-reconnect");
      await click(phones.Alice, /^Character$/).catch(() => {});
      return `Alice's Town tab after reconnecting: "${town.match(/4 ALIVE/i)[0]}", Eve shown as Ghost`;
    }, ["display"]);

    await step("A phone refresh keeps the player in their seat", "Reloading must not lose the player's seat or character", async () => {
      await phones.Dan.reload();
      // Observed behaviour: after a reload the phone shows the face-down token again, and one tap shows the
      // character. The seat and character are kept; only the reveal is repeated.
      await button(phones.Dan, /Turn your token over/i).waitFor({ timeout: 20000 });
      const text = (await phones.Dan.locator("body").innerText()).toUpperCase();
      expect(!text.includes("YOUR NAME"), "Dan's phone fell back to the join screen");
      await click(phones.Dan, /Turn your token over/i);
      await until(async () => /POISONER/i.test(await phones.Dan.locator("body").innerText()), "Dan's token did not show the Poisoner");
      return "Dan's phone came back to his face-down token; one tap shows the Poisoner again";
    }, ["Dan"]);

    await step("The Storyteller tab refreshes and still runs the game", "A Storyteller reload must get control back and publish what changed meanwhile", async () => {
      await st.reload();
      await st.getByLabel(/^Seat 5, Eve/).first().waitFor({ timeout: 20000 });
      const reloadedAt = Date.now();
      // Observed: the reloaded tab cannot prove it held the writer lease, so it waits for the old lease to expire
      // (30 seconds, PROTOCOL.md) and shows "Multiplayer is not live" with Retry. A Storyteller who keeps playing
      // meanwhile changes only their own tablet until Retry succeeds.
      const banner = await st.getByText(/Multiplayer is not live/i).first().waitFor({ state: "visible", timeout: 8000 }).then(() => true, () => false);
      await st.keyboard.press("Escape");
      await click(st, /^Undo$/); // Eve's death, undone while not live
      await sleep(1500);
      const meanwhile = await alive("Eve");
      await snap(["storyteller", "Alice"], "while-not-live");
      let retries = 0;
      await until(async () => {
        if ((await alive("Eve")) === true) return true;
        const retry = button(st, /^Retry$/);
        if (await retry.isVisible().catch(() => false)) { retries++; await retry.click().catch(() => {}); }
        await sleep(2500);
        return false;
      }, "after the reload and Retry, Eve's undone death never reached the server", 75000);
      const secs = Math.round((Date.now() - reloadedAt) / 1000);
      return `${banner ? '"Multiplayer is not live" shown after the reload' : "no banner after the reload"}; 1.5 s after the Undo on the tablet the server still had Eve ${meanwhile === false ? "dead" : "alive"}; the Undo reached the server ${secs} s after the reload (${retries} Retry press${retries === 1 ? "" : "es"})`;
    }, ["storyteller", "display"]);

    await step("Storyteller ends the game; the Display shows the winner", "The online winner screen (deferred from Milestone 3)", async () => {
      await click(st, /^End$/);
      await st.waitForTimeout(800);
      await click(st, /^Good wins$/);
      await st.waitForTimeout(800);
      if (await button(st, /^Good wins$/).isVisible().catch(() => false)) await click(st, /^Good wins$/);
      const winner = await until(async () => (await server(`lobbies/${code}/public/winner`)), "the public winner was never published", 20000);
      expect(winner === "good", `public winner is ${JSON.stringify(winner)}`);
      const tv = await until(async () => {
        const t = (await devices.display.locator("body").innerText()).replace(/\s+/g, " ");
        return /GAME OVER/i.test(t) ? t : null;
      }, "the Display never showed GAME OVER");
      expect(/GAME OVER/i.test(tv) && /Good Wins/i.test(tv), "the Display does not show Good Wins");
      for (const { name } of CAST) {
        await until(async () => /THE GAME IS OVER/i.test(await phones[name].locator("body").innerText()), `${name}'s phone never showed the game is over`);
      }
      return 'public winner "good"; the Display shows GAME OVER, Good Wins; every phone shows The game is over';
    }, ["storyteller", "display", "Alice"]);
  } catch {
    // The failing step is already recorded.
  } finally {
    for (const [label, list] of Object.entries(frames)) {
      writeFileSync(join(OUT, `frames-${label}.jsonl`), list.map((f) => JSON.stringify(f)).join("\n") + "\n");
    }
    writeFileSync(join(OUT, "ids.json"), JSON.stringify({ code, ids }, null, 2));
    if (code) {
      try { results.push(privacyCheck(code, ids)); }
      catch (e) { results.push({ name: "Privacy check", why: "", ok: false, note: `the check itself crashed: ${e.message}`, ms: 0, files: [] }); }
    }
    writeReport(code);
    await browser.close();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} steps passed. Report: ${join(OUT, "REPORT.md")}`);
  process.exitCode = failed ? 1 : 0;
}

/**
 * What each phone and the Display actually received over Firebase, read from the websocket. Every data
 * message is checked, both pushes from listeners and replies to one-off reads (matched to the request that
 * asked for them):
 * - the path must be on that device's allowlist (shared public paths, or its own uid / player id);
 * - outside the device's own player view, no value may be an assigned character id and no key may name a
 *   role or alignment (the public script sheet, scriptCharacters and scriptHomebrew, is removed first; each
 *   scriptHomebrew entry may carry only id, name, type and ability);
 * - each phone must have received its own character in its own view (proves the capture works);
 * - planted leaks of each kind must be flagged by the same code (proves the checks can fail).
 */
function privacyCheck(code, ids) {
  const name = "No device received another player's private data";
  const why = "Privacy: a phone or the Display must only receive public data and its own records";
  const lobby = `lobbies/${code}`;
  const strip = (p) => String(p ?? "").replace(/^\/+/, "");
  const shared = ["public", "session"];
  const perUid = ["joinRequests", "leaveRequests", "outcomes", "roster", "revealAcks", "results", "travelerChoices", "presence"];
  const ROLE_KEY = /(^|[a-z])(role|alignment|reminders?|notes?)$/i;
  // Exact keys of the public node and its player entries (PublicLobbyRecordSchema, PlayerPublicRecordSchema in
  // src/stores/schemas.ts). A new public field fails here until it is reviewed and added.
  const PUBLIC_KEYS = new Set(["code", "scriptId", "phase", "day", "seatOrder", "players", "fabled", "lorics", "scriptName", "scriptCharacters", "scriptHomebrew", "winner", "status", "arrivals", "plannedPlayers"]);
  const PUBLIC_PLAYER_KEYS = new Set(["id", "name", "seat", "alive", "ghostVote", "online", "joinedAt", "isTraveler", "publicDisplayRole", "exiled"]);
  const SESSION_KEYS = new Set(["id", "state", "version"]);
  // The public script sheet: official ids (scriptCharacters) and script-defined characters (scriptHomebrew, custom
  // scripts Stage 3, privacy-reviewed 2026-11-10). Each homebrew entry may carry only these fields.
  const SHEET = new Set(["scriptCharacters", "scriptHomebrew"]);
  const HOMEBREW_KEYS = new Set(["id", "name", "type", "ability"]);
  const WORDS = [...ROLE_IDS, "good", "evil"];
  const PROTOCOL_ACTIONS = new Set(["auth", "gauth", "unauth", "s"]);

  const ownUid = (label) => {
    const branch = label === "display" ? "displayMembers" : "joinRequests";
    for (const f of frames[label] ?? []) {
      if (f.dir !== "out") continue;
      try {
        const m = JSON.parse(f.text);
        const p = strip(m?.d?.b?.p);
        if (p.startsWith(`${lobby}/${branch}/`)) return p.split("/")[3];
      } catch { /* ignored here; counted below */ }
    }
    return null;
  };

  const allowed = (label, uid, rel) => {
    const [head, key] = rel.split("/");
    if (shared.includes(head)) return true;
    if (label === "display") return head === "displayMembers" && key === uid;
    if (head === "player") return key === ids[label];
    return perUid.includes(head) && key === uid && !!uid;
  };

  const withoutScript = (v) => {
    if (Array.isArray(v)) return v.map(withoutScript);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => !SHEET.has(k)).map(([k, x]) => [k, withoutScript(x)]));
    return v;
  };
  const roleKeys = (v, out = []) => {
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (ROLE_KEY.test(k)) out.push(k); roleKeys(x, out); }
    return out;
  };

  /** Keys under /public or /session that are not in the schema allowlists, as "a.b.c" paths. */
  const unknownKeys = (root, prefix, data) => {
    const bad = [];
    const visit = (path, value) => {
      if (root === "session") {
        if (path.length === 1 && !SESSION_KEYS.has(path[0])) bad.push(path.join("."));
        return;
      }
      if (path.length === 1 && !PUBLIC_KEYS.has(path[0])) bad.push(path[0]);
      if (path.length === 3 && path[0] === "players" && !PUBLIC_PLAYER_KEYS.has(path[2])) bad.push(path.join(".").replace(/[A-Za-z0-9_-]{20,}/g, "<id>"));
      if (path.length > 3 && path[0] === "players") bad.push(path.join(".").replace(/[A-Za-z0-9_-]{20,}/g, "<id>"));
      if (path[0] === "scriptHomebrew") {
        // Firebase may deliver the list whole, one entry at a time, or one field at a time.
        const fieldsOf = (entry) => (entry && typeof entry === "object" && !Array.isArray(entry) ? Object.keys(entry) : ["(not an object)"]);
        const entries = path.length === 1 ? (value && typeof value === "object" ? Object.values(value) : [value]) : path.length === 2 ? [value] : [];
        for (const entry of entries) for (const k of fieldsOf(entry)) if (!HOMEBREW_KEYS.has(k)) bad.push(`scriptHomebrew.${k}`);
        if (path.length === 3 && !HOMEBREW_KEYS.has(path[2])) bad.push(`scriptHomebrew.${path[2]}`);
        if (path.length > 3) bad.push(path.join("."));
        return;
      }
      if (value && typeof value === "object" && !Array.isArray(value) && !(path.length === 1 && path[0] === "scriptCharacters")) {
        for (const [k, v] of Object.entries(value)) visit([...path, k], v);
      }
    };
    if (data && typeof data === "object" && !Array.isArray(data)) for (const [k, v] of Object.entries(data)) visit([...prefix, k], v);
    else if (prefix.length) visit(prefix, data);
    return bad;
  };

  /** Any text value naming an assigned character or an alignment (whole word, any case), except a "winner"
   * field, which is announced to everyone at the end. Long id-like strings (ids, tokens) are skipped. */
  const privateWords = (segs, data) => {
    const hits = [];
    const visit = (path, value) => {
      if (typeof value === "string") {
        if (/^[A-Za-z0-9_-]{16,}$/.test(value)) return;
        if (path[path.length - 1] === "winner") return; // the declared result is announced to everyone
        for (const word of WORDS) if (new RegExp(`\\b${word}\\b`, "i").test(value)) hits.push([path.length ? ` (${path.join(".").replace(/[A-Za-z0-9_-]{20,}/g, "<id>")})` : "", word]);
      } else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) visit([...path, k], v);
    };
    visit(segs.slice(1), data);
    return hits;
  };

  /** Data messages a device received: [{ path, data }]. Unparsable frames are reported. */
  /**
   * Long-polling traffic (the SDK falls back to it when a websocket cannot connect, e.g. after a phone goes
   * offline): replies arrive as pRTLPCB(n, [messages]) in the response body; requests travel base64-encoded in
   * the URL as segN (message id), tsN (parts in that message) and dN (this part).
   */
  const expandLongPoll = (f, partial) => {
    const outFrames = [];
    let url;
    try { url = new URL(f.url ?? ""); } catch { url = null; }
    if (url) {
      for (const [key, id] of url.searchParams) {
        const n = key.match(/^seg(\d+)$/)?.[1];
        if (n === undefined) continue;
        const total = Number(url.searchParams.get(`ts${n}`));
        const part = url.searchParams.get(`d${n}`) ?? "";
        const parts = partial.get(id) ?? [];
        parts.push(part);
        partial.set(id, parts);
        if (parts.length === total) {
          partial.delete(id);
          const b64 = parts.join("").replace(/-/g, "+").replace(/_/g, "/").replace(/\./g, "=");
          outFrames.push({ dir: "out", text: Buffer.from(b64, "base64").toString("utf8") });
        }
      }
    }
    for (const match of String(f.text).matchAll(/pRTLPCB\(\d+,(\[[\s\S]*?\])\);/g)) {
      let list;
      try { list = JSON.parse(match[1]); } catch { outFrames.push({ dir: "in", text: "<unreadable long-poll body>" }); continue; }
      for (const m of list) outFrames.push({ dir: "in", text: JSON.stringify(m) });
    }
    return outFrames;
  };

  /** Data messages a device received: [{ path, data }], in arrival order. Unparsable messages are reported. */
  const messages = (list) => {
    // Request ids belong to the SDK's persistent connection: they continue across a websocket/long-poll switch
    // and restart after a page reload. Replies follow their request, so the latest request with an id wins.
    const sent = new Map();
    const out = [];
    const bad = [];
    const partial = new Map();
    const flat = list.flatMap((f) => (f.dir === "lp" ? expandLongPoll(f, partial) : [f]));
    for (const f of flat) {
      let m;
      try { m = JSON.parse(f.text); } catch { bad.push(String(f.text).slice(0, 40)); continue; }
      if (m?.t !== "d" || !m.d || typeof m.d !== "object") continue;
      const b = m.d.b;
      if (f.dir === "out") {
        if (typeof m.d.r === "number") sent.set(m.d.r, { action: m.d.a, path: typeof b?.p === "string" ? strip(b.p) : null });
        continue;
      }
      if (!b || typeof b !== "object") continue;
      if (typeof b.p === "string") out.push({ path: strip(b.p), data: b.d, kind: "push" });
      else if (typeof m.d.r === "number" && b.d !== undefined) {
        const req = sent.get(m.d.r);
        // Connection-level replies (sign-in token, client stats) carry no game data.
        if (req && PROTOCOL_ACTIONS.has(req.action)) continue;
        out.push({ path: req?.path ?? null, data: b.d, kind: "reply" });
      }
    }
    return { out, bad };
  };

  const scan = (label, uid, list) => {
    const problems = [];
    const { out, bad } = messages(list);
    if (bad.length) problems.push(`${label}: ${bad.length} unreadable message(s)`);
    let checked = 0;
    let ownRole = false;
    for (const { path, data, kind } of out) {
      const empty = data === null || data === undefined || data === "" || (typeof data === "object" && Object.keys(data).length === 0);
      if (empty) continue;
      checked++;
      if (path === null) { problems.push(`${label}: a ${kind} with data for an unknown request`); continue; }
      if (!path.startsWith(`${lobby}/`)) { problems.push(`${label} received data at /${path}`); continue; }
      const rel = path.slice(lobby.length + 1);
      if (!allowed(label, uid, rel)) { problems.push(`${label} received ${kind} for /${rel.replace(/[A-Za-z0-9_-]{20,}/g, "<id>")}`); continue; }
      if (label !== "display" && rel.startsWith(`player/${ids[label]}`)) {
        const role = CAST.find((c) => c.name === label)?.role;
        const own = role && roleId(role);
        if (own && JSON.stringify(data).includes(`"${own}"`)) ownRole = true;
        continue;
      }
      const segs = rel.split("/");
      if (segs[0] === "public" || segs[0] === "session") {
        for (const bad of unknownKeys(segs[0], segs.slice(1), data)) problems.push(`${label} saw unexpected key ${bad} in /${segs[0]}`);
      }
      const clean = withoutScript(data);
      for (const k of roleKeys(clean)) problems.push(`${label} saw key "${k}" in /${rel}`);
      for (const [where, word] of privateWords(segs, clean)) problems.push(`${label} saw "${word}" in /${rel}${where}`);
    }
    return { problems, checked, ownRole };
  };

  const problems = [];
  const counts = [];
  for (const label of Object.keys(frames)) {
    if (label === "storyteller") continue;
    const uid = ownUid(label);
    if (!uid) problems.push(`${label}: own sign-in id not found in its traffic`);
    const r = scan(label, uid, frames[label]);
    problems.push(...r.problems);
    if (r.checked === 0) problems.push(`${label}: no Firebase data captured`);
    if (label !== "display" && !r.ownRole) problems.push(`${label} never received its own character, so the capture is not working`);
    counts.push(`${label} ${r.checked}`);
  }


  // Controls: plant one leak of each kind into the first phone's real traffic and the Display's; every one must be flagged.
  // Planted into the first phone's traffic; the other cast members are the players whose data must not reach it.
  const [first, second, third, fourth] = CAST;
  const aliceUid = ownUid(first.name);
  const plant = (label, extra) => scan(label, label === "display" ? ownUid("display") : aliceUid, [...(frames[label] ?? []), ...extra]).problems.length;
  const base = { [first.name]: plant(first.name, []), display: plant("display", []) };
  const msg = (dir, conn, d) => ({ dir, conn, text: JSON.stringify({ t: "d", d }) });
  const controls = {
    "an unknown key with a harmless value on a public player": plant(first.name, [msg("in", 0, { a: "d", b: { p: `${lobby}/public/players/x`, d: { name: second.name, seat: 2, mood: "calm" } } })]) > base[first.name],
    "a character named inside a sentence under a public key": plant(first.name, [msg("in", 0, { a: "d", b: { p: `${lobby}/public/players/x/name`, d: `${second.name} is the ${second.role}` } })]) > base[first.name],
    "an alignment under a public key": plant("display", [msg("in", 0, { a: "d", b: { p: `${lobby}/public/arrivals`, d: ["Evil"] } })]) > base.display,
    "another player's view in a read reply": plant(first.name, [msg("out", 999, { r: 1, a: "g", b: { p: `/${lobby}/player/${ids[second.name]}` } }), msg("in", 999, { r: 1, b: { s: "ok", d: { seat: 2 } } })]) > base[first.name],
    "game data in a reply to an unseen request": plant(first.name, [msg("in", 998, { r: 99999, b: { s: "ok", d: { seat: 2, name: second.name } } })]) > base[first.name],
    "another player's view over long polling": plant(first.name, [{ dir: "lp", url: "http://127.0.0.1/.lp?id=1", text: `pRTLPCB(9,[${JSON.stringify({ t: "d", d: { a: "d", b: { p: `${lobby}/player/${ids[fourth.name]}`, d: { seat: 4 } } } })}]);` }]) > base[first.name],
    "Storyteller data": plant(first.name, [msg("in", 0, { a: "d", b: { p: `${lobby}/storyteller`, d: { phase: "day" } } })]) > base[first.name],
    "another phone's records": plant(first.name, [msg("in", 0, { a: "d", b: { p: `${lobby}/roster/some-other-uid`, d: "x" } })]) > base[first.name],
    "a night-order field on a public homebrew character": plant("display", [msg("in", 0, { a: "d", b: { p: `${lobby}/public/scriptHomebrew`, d: [{ id: "x", name: "X", type: "demon", ability: "A.", firstNight: 3 }] } })]) > base.display,
    "a player view on the Display": plant("display", [msg("in", 0, { a: "d", b: { p: `${lobby}/player/${ids[third.name]}`, d: { seat: 3 } } })]) > base.display,
  };
  for (const [what, caught] of Object.entries(controls)) if (!caught) problems.push(`control failed: a planted leak (${what}) was not flagged`);

  const ok = problems.length === 0;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${problems.length ? `: ${problems.slice(0, 5).join("; ")}` : ""}`);
  const note = ok
    ? `data messages checked (pushes and read replies, websocket and long polling): ${counts.join(", ")}; every phone received its own character; all ${Object.keys(controls).length} planted leaks were flagged${Object.keys(longPolls).length ? `; long-polling requests read: ${Object.entries(longPolls).map(([l, n]) => `${l} ${n}`).join(", ")}` : ""}`
    : problems.slice(0, 10).join("; ");
  return { name, why, ok, note, ms: 0, files: [] };
}

function writeReport(code) {
  const lines = [
    "# Internal multiplayer game (local emulators, production Rules)",
    "",
    `Lobby ${code || "(none)"}; ${new Date().toISOString()}; app ${BASE}`,
    "",
    "| # | Step | Result | Why it matters | Detail | Screenshots |",
    "| --- | --- | --- | --- | --- | --- |",
    ...results.map((r, i) => `| ${i + 1} | ${r.name} | ${r.ok ? "PASS" : "**FAIL**"} | ${r.why} | ${r.note.replace(/\|/g, "/")} | ${r.files.join(", ")} |`),
    "",
    "Not covered here: real phone hardware and browsers (iOS Safari, installed app), real mobile networks,",
    "QR scanning, the on-screen keyboard, and the hosted test project.",
  ];
  writeFileSync(join(OUT, "REPORT.md"), lines.join("\n") + "\n");
  writeFileSync(join(OUT, "report.json"), JSON.stringify({ code, base: BASE, results }, null, 2));
}

if (args.recheck) {
  // Re-run only the privacy check over a finished run's saved traffic (frames-*.jsonl, ids.json).
  const { readFileSync, readdirSync } = await import("node:fs");
  const dir = args.recheck;
  const { code, ids } = JSON.parse(readFileSync(join(dir, "ids.json"), "utf8"));
  for (const file of readdirSync(dir).filter((f) => /^frames-.*\.jsonl$/.test(f))) {
    frames[file.slice(7, -6)] = readFileSync(join(dir, file), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  }
  const r = privacyCheck(code, ids);
  console.log(r.note);
  process.exitCode = r.ok ? 0 : 1;
} else {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}
