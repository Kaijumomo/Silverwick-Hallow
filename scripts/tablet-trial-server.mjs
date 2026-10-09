import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
};
const root = realpathSync(arg("--root", existsSync(resolve(here, "tablet-trial.json")) ? here : resolve(here, "../dist-tablet-trial")));
const manifest = JSON.parse(readFileSync(resolve(root, "tablet-trial.json"), "utf8"));
if (manifest.kind !== "silverwick-offline-tablet-trial" || manifest.firebaseEnabled !== false) throw new Error("Refusing to serve a build without the tablet-trial safety manifest.");
const port = Number(arg("--port", "4175"));
const host = arg("--host", "0.0.0.0");
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Choose a port between 1 and 65535.");
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8" };
export const TRIAL_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://release.botc.app; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const server = createServer((request, response) => {
  response.setHeader("Content-Security-Policy", TRIAL_CSP);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405); response.end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    let file = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    const inside = path => { const rel = relative(root, path); return rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(rel); };
    if (!inside(file)) { response.writeHead(403); response.end(); return; }
    if (!existsSync(file) || !statSync(file).isFile()) { response.writeHead(404); response.end("Not found"); return; }
    file = realpathSync(file);
    if (!inside(file)) { response.writeHead(403); response.end(); return; }
    response.setHeader("Content-Type", mime[extname(file)] ?? "application/octet-stream");
    response.writeHead(200);
    if (request.method === "HEAD") response.end();
    else createReadStream(file).pipe(response);
  } catch { response.writeHead(400); response.end("Invalid request"); }
});
server.on("error", error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, host, () => {
  console.log(`Silverwick tablet trial: http://localhost:${port}/`);
  if (host === "0.0.0.0") {
    for (const interfaces of Object.values(networkInterfaces())) for (const address of interfaces ?? []) {
      if (address.family === "IPv4" && !address.internal) console.log(`Same-network tablet: http://${address.address}:${port}/`);
    }
  }
  console.log("Local practice only. No online lobby connections. Ctrl+C stops this server.");
});
