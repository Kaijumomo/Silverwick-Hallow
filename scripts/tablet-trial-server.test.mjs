// Exercises the actual portable HTTP server, including its production block.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "silverwick-tablet-server-"));
let child;
let base;
beforeAll(async () => {
  writeFileSync(resolve(root, "index.html"), "<h1>Local trial fixture</h1>");
  writeFileSync(resolve(root, "tablet-trial.json"), JSON.stringify({ kind: "silverwick-offline-tablet-trial", firebaseEnabled: false }));
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["scripts/tablet-trial-server.mjs", "--root", root, "--host", "127.0.0.1", "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Trial server startup timed out")), 8000);
    child.once("error", reject);
    child.stdout.on("data", text => { if (String(text).includes("Silverwick tablet trial:")) { clearTimeout(timeout); resolve(); } });
    child.once("exit", code => { clearTimeout(timeout); reject(new Error(`Trial server exited (${code})`)); });
  });
}, 10000);
afterAll(async () => {
  if (child && child.exitCode === null) {
    await new Promise(resolve => { child.once("exit", resolve); child.kill(); });
  }
  // A freshly generated single-purpose temp directory; never a project path.
  if (dirname(root) !== resolve(tmpdir()) || !basename(root).startsWith("silverwick-tablet-server-")) throw new Error("Unsafe temporary cleanup path");
  rmSync(root, { recursive: true, force: true });
});
describe("portable tablet server", () => {
  it("serves local content under a CSP that excludes all remote backend connections", async () => {
    const response = await fetch(base);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Local trial fixture");
    expect(response.headers.get("content-security-policy")).toMatch(/(?:^|;) connect-src 'self';/);
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("rejects writes and cannot serve a path outside the package", async () => {
    expect((await fetch(base, { method: "POST", body: "no writes" })).status).toBe(405);
    expect((await fetch(`${base}/..%5c..%5cpackage.json`)).status).toBeGreaterThanOrEqual(400);
    expect((await fetch(`${base}/missing.js`)).status).toBe(404);
  });
});
