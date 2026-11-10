// Captures reference screenshots of the Claude Design v7 prototypes so builds can be compared against them.
// Usage: node scripts/design-baseline.mjs <design_files dir> <output dir> [vendor dir]
// The prototype runtime loads React and Babel from unpkg.com. Where that host is unreachable, pass a vendor dir holding
// react/umd, react-dom/umd and babel/babel.min.js (from `npm pack react@18.3.1 react-dom@18.3.1 @babel/standalone@7.29.0`).
// Needs Playwright (Node) and a free port. Prototypes are served statically; nothing is written to Firebase.
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const [root, out, vendor] = process.argv.slice(2);
if (!root || !out) throw new Error("usage: node scripts/design-baseline.mjs <design_files dir> <output dir>");
fs.mkdirSync(out, { recursive: true });
const types = { ".html": "text/html", ".js": "text/javascript", ".jsx": "text/javascript", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split("?")[0]));
  if (!file.startsWith(path.resolve(root)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader("content-type", types[path.extname(file)] ?? "application/octet-stream");
  fs.createReadStream(file).pipe(res);
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
async function shot(name, file, viewport, selector) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  await page.route(/release\.botc\.app/, (r) => r.abort()); // offline: no hotlinked art
  if (vendor) {
    await page.route(/unpkg\.com/, (r) => {
      const u = new URL(r.request().url()).pathname;
      const m = u.match(/^\/(react|react-dom)@[^/]+\/(.+)$/) ?? u.match(/^\/@babel\/standalone@[^/]+\/(.+)$/);
      const local = !m ? null : m.length === 3 ? path.join(vendor, m[1], m[2]) : path.join(vendor, "babel", m[1]);
      if (local && fs.existsSync(local)) return r.fulfill({ path: local, contentType: "text/javascript" });
      return r.abort();
    });
  }
  await page.goto(base + encodeURIComponent(file));
  await page.waitForTimeout(2500);
  await (selector ? page.locator(selector).screenshot({ path: path.join(out, name) }) : page.screenshot({ path: path.join(out, name) }));
  await page.close();
}
await shot("home-v7-tablet-1524x968.png", "Silverwick Home v7.dc.html", { width: 1524, height: 968 });
await shot("player-flow-v2-phone-428x926.png", "Silverwick Player Flow v2.dc.html", { width: 1400, height: 1100 }, "#sw-phone");
await browser.close();
server.close();
console.log("done");
