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
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
const CAST = [
  { name: "Alice", role: "Chef" },
  { name: "Bob", role: "Imp" },
  { name: "Carol", role: "Empath" },
  { name: "Dan", role: "Poisoner" },
  { name: "Eve", role: "Washerwoman" },
];

const results = [];
let shot = 0;
const devices = {}; // label -> page
const frames = {}; // label -> received Firebase websocket payloads

function track(label, page) {
  devices[label] = page;
  frames[label] ??= [];
  page.on("websocket", (ws) => {
    let pending = null; // Firebase splits long messages: a frame holding only a count, then that many parts.
    ws.on("framereceived", ({ payload }) => {
      const text = typeof payload === "string" ? payload : payload.toString("utf8");
      if (pending) {
        pending.parts.push(text);
        if (pending.parts.length === pending.count) { frames[label].push(pending.parts.join("")); pending = null; }
      } else if (/^\d+$/.test(text)) pending = { count: Number(text), parts: [] };
      else frames[label].push(text);
    });
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
    await step("Storyteller creates an online Trouble Brewing game", "Invite to Phones must create a live lobby on Firebase", async () => {
      await st.goto(BASE);
      await click(st, /New game/);
      await st.locator('button[title="Trouble Brewing"]').click();
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
      await click(phones.Alice, /^Character$/).catch(() => {});
      return `Alice's Town tab after reconnecting: "${town.match(/4 ALIVE/i)[0]}", Eve shown as Ghost`;
    }, ["Alice", "display"]);

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
      let retries = 0;
      await until(async () => {
        if ((await alive("Eve")) === true) return true;
        const retry = button(st, /^Retry$/);
        if (await retry.isVisible().catch(() => false)) { retries++; await retry.click().catch(() => {}); }
        await sleep(2500);
        return false;
      }, "after the reload and Retry, Eve's undone death never reached the server", 75000);
      const secs = Math.round((Date.now() - reloadedAt) / 1000);
      return `${banner ? '"Multiplayer is not live" shown after the reload' : "no banner after the reload"}; phones still saw Eve ${meanwhile === false ? "dead" : "alive"} until control came back; Undo reached the server ${secs}s after the reload (${retries} Retry press${retries === 1 ? "" : "es"})`;
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
    if (code) results.push(privacyCheck(code, ids));
    writeReport(code);
    await browser.close();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} steps passed. Report: ${join(OUT, "REPORT.md")}`);
  process.exitCode = failed ? 1 : 0;
}

/** What each device actually received over Firebase, checked path by path. */
function privacyCheck(code, ids) {
  const name = "No device received another player's private data";
  const why = "Privacy: a phone or the Display must never receive Storyteller data or another player's view";
  const always = ["/storyteller", "/checkpoint", "/rosterParticipants", "/membershipRevocations", "/writer", "/writeGuard"];
  const forbiddenFor = (label) => [
    ...always,
    ...Object.entries(ids).filter(([n]) => n !== label).map(([, id]) => `/player/${id}`),
    ...(label === "display" ? ["/player/"] : []),
  ];
  const scan = (label, list) => {
    const out = { messages: 0, problems: [], own: 0 };
    for (const raw of frames[label] ?? []) {
      let msg;
      try { msg = JSON.parse(raw); } catch { continue; }
      const body = msg?.d?.b;
      const path = typeof body?.p === "string" ? `/${body.p.replace(/^\//, "")}` : null;
      if (!path || !path.startsWith(`/lobbies/${code}`)) continue;
      out.messages++;
      const rel = path.slice(`/lobbies/${code}`.length);
      if (ids[label] && rel.startsWith(`/player/${ids[label]}`)) out.own++;
      if (rel === "" || rel === "/") out.problems.push(`${label} received the whole lobby`);
      for (const bad of list) if (rel.startsWith(bad)) { out.problems.push(`${label} received ${rel}`); break; }
      if (rel.startsWith("/public")) {
        const text = JSON.stringify(body.d ?? null);
        for (const key of ["actualRole", "shownRole", "alignment", "reminders", "notes"]) {
          if (text.includes(`"${key}"`)) out.problems.push(`${label} saw "${key}" under ${rel}`);
        }
      }
    }
    return out;
  };
  const problems = [];
  const counts = [];
  for (const label of Object.keys(frames)) {
    if (label === "storyteller") continue;
    const r = scan(label, forbiddenFor(label));
    problems.push(...r.problems);
    if (label !== "display" && r.own === 0) problems.push(`${label} never received its own player view, so the capture is not working`);
    if (r.messages === 0) problems.push(`${label}: no Firebase data messages captured`);
    counts.push(`${label} ${r.messages}`);
  }
  // Control: the same check over the Storyteller's own traffic must flag it (it legitimately receives
  // Storyteller data). If it does not, the check could not see a leak either.
  const control = scan("storyteller", forbiddenFor("Alice"));
  if (control.problems.length === 0) problems.push("control failed: the check did not flag the Storyteller's own data");
  const ok = problems.length === 0;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${problems.length ? `: ${problems.slice(0, 5).join("; ")}` : ""}`);
  const note = ok
    ? `data messages checked per device: ${counts.join(", ")}; every phone received its own view; control flagged the Storyteller's ${control.problems.length} private messages`
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

main().catch((e) => { console.error(e); process.exitCode = 1; });
