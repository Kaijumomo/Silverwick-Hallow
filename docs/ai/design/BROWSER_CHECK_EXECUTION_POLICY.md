# Silverwick — Browser-Check Execution Policy

**Status:** PROJECT POLICY — applies to Phase 10H and later browser checks\
**Date:** 2026-10-04\
**Applies to:** the Anthropic `webapp-testing` skill vendored at `.claude/skills/webapp-testing/` (source `anthropics/skills`, hash in `skills-lock.json`)

## 1. Policy

1. `webapp-testing` stays vendored **unmodified**, as **guidance and reference only**. Do not edit its files. Upstream updates replace the whole folder through `npx skills add`.
2. Do **not** execute its Python tooling: `scripts/with_server.py` and `examples/*.py`. Do **not** install Python Playwright (`pip install playwright`), and do **not** add a startup hook for it.
3. Silverwick browser checks run through either:
   - the **project Playwright MCP** server defined in `.mcp.json` (§2); or
   - **explicitly approved Node-based Playwright tooling** (`playwright` / `@playwright/test`).
4. When the skill's text says to write or run a Python script, apply the same technique with the Node API or the MCP tools instead (§3).

This policy narrows how `webapp-testing` is used. It does not remove it from the 10H toolchain listed in `PHASE10H.md` §5.

## 2. Current availability

- **Playwright MCP:** configured at project scope in the repository-root `.mcp.json` as server `playwright`, pinned to `@playwright/mcp@0.0.83`. Do not register it with `claude mcp add`, and do not use `@latest`. A local-scope entry with the same name would silently take precedence over the project definition.

  | Setting | Value | Override |
  |---|---|---|
  | `--headless` | always on | none (cloud containers have no display) |
  | `--executable-path` | `/opt/pw-browsers/chromium` | set `PLAYWRIGHT_MCP_EXECUTABLE_PATH` to a local Chrome/Chromium |
  | `PLAYWRIGHT_MCP_SANDBOX` | `false` | set `PLAYWRIGHT_MCP_SANDBOX=true` where Chromium does not run as root |

  Why the defaults are needed in cloud containers:
  - **Executable path:** the bundled Playwright expects Chromium build 1247, but the container preinstalls build 1194. Without the path, launch fails on a missing browser.
  - **Sandbox:** Chromium runs as root in the container and refuses its sandbox there. Because the sandbox is off, navigate only to the local dev server or other trusted pages.

  Cloud and `claude -p` sessions load project servers without prompting. Interactive local sessions ask once for approval. Verified 2026-10-04: launches HeadlessChrome 141 with defaults, and both overrides take effect.
- **Node Playwright:** not in `package.json`. Adding it as a devDependency, or adding a Playwright config or test suite, is a separate, explicit tooling change. Until then, ad-hoc use (`npx playwright@<version>` or a scratch install outside the repo) needs explicit approval and commits nothing.
- **Cloud sessions:** Chromium is preinstalled at `/opt/pw-browsers` (`PLAYWRIGHT_BROWSERS_PATH`). Do not run `playwright install`. If the Playwright version in use cannot find a matching browser, launch with `executablePath: '/opt/pw-browsers/chromium'`.

## 3. Translating the skill's guidance

| `webapp-testing` says | Silverwick equivalent |
|---|---|
| `with_server.py --server "npm run dev" --port 5173 -- …` | Start `npm run dev` (port 5173, overridable with `PORT`; see `vite.config.ts` and `.claude/launch.json`), wait for the port, run the check, then stop the server. With `@playwright/test`, use the `webServer` config option. |
| `sync_playwright()` Python script | Node `chromium.launch({ headless: true })` script, `@playwright/test` spec, or Playwright MCP browser tools. |
| Reconnaissance, then action | Unchanged. Screenshot or snapshot the rendered DOM (the MCP accessibility snapshot works well), derive selectors, then act. |
| Wait for `networkidle` before inspecting | Prefer web-first waits on the specific state (`expect(locator).toBeVisible()`, role or text locators). The app holds a live Firebase Realtime Database connection, so network-idle is not a reliable readiness signal. |
| Prefer `text=`, `role=`, CSS, ID selectors | Prefer role and accessible-name locators. They double as an accessibility check against the 10H baseline. |
| Capture console logs | `page.on('console', …)` in Node, or the MCP console-message tool. |

## 4. Guardrails

- **Data target.** The dev server connects to whatever Firebase project `VITE_FIREBASE_*` in `.env.local` (or the in-app config fallback) points to; the dev app has no emulator wiring. Do not drive flows that write game state against the production project unless the owner explicitly authorizes that run.
- **Artifacts.** Write screenshots, traces and logs to a scratch location or the git-ignored `.playwright-cli/` / `.playwright-mcp/` (Playwright MCP's default output folder). Commit one only when it is deliberately kept as review evidence.
- **Standing.** Browser checks are evidence, not approval. Binding 10H UI findings cite `docs/ai/design/WEB_INTERFACE_GUIDELINES_PINNED.md`, and independent verification remains Luna's per `PHASE10H.md`.
