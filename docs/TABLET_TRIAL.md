# Silverwick Hollow — Local tablet trial

This is a playable practice build, separate from your real game. It never connects to an online lobby or Firebase. Your practice game is saved in this browser; another device has its own copy.

## Open it

1. Extract the zip on a computer with Node.js installed.
2. On Windows, double-click `Start-Tablet-Trial.cmd` in the extracted `dist-tablet-trial` folder. Keep its window open. Alternatively, open a terminal in that folder and run `node server.mjs`. Node.js must be installed; no PowerShell policy changes are needed.
3. Open the printed `http://localhost:4175/` address on the computer. On a tablet connected to the same local network, open the printed same-network address instead.
4. Keep the computer and server running. Use landscape orientation. Stop the server with Ctrl+C when finished.

The server makes no firewall changes. If the tablet cannot connect, first check that both devices use the same network; guest-network isolation or the computer's firewall may prevent local access. No public hosting, Cloudflare publication, account, or production credentials are needed. Do not open `index.html` directly: use the server so the safety headers and browser storage work correctly.

Character artwork loads from the official BOTC image service. Internet access is needed for that artwork; game state stays local and gameplay does not use an online backend. Browser data clearing removes the trial save. This is a local-network review tool, not a publicly hosted service.

## Practice tables

The first visit opens Day 2 with 15 players. Reset 15 or Reset 20 creates a fresh practice table after confirmation. Resetting clears trial votes and corrections. Reloading resumes the current trial instead.

- Alice is the Virgin and Bartholomew is the Pacifist.
- Cass has the Bureaucrat's three votes for Day 2.
- Hana is dead with one vote remaining; Ignatius is dead with the vote already spent.
- The 15-person table includes one Traveler. The 20-person table includes five Travelers, including the Bureaucrat.
- Start with ordinary nominations, then try equal leading totals, a higher replacement, a dead Yes, an immediate correction, reload/resume, Traveler exile, and Finish day.

The practice script combines canonical characters to expose review cases; it is a testing fixture, not a recommended balanced script. The Storyteller still decides ability outcomes and actual execution/death.

## Rebuild from the repository

Run `node scripts/tablet-trial-build.mjs`, then `node scripts/tablet-trial-package.mjs --skip-build` on Windows. The dedicated build ignores environment files, embeds the local-only guard, and writes only `dist-tablet-trial` plus the optional zip. Start the repository copy with `node scripts/tablet-trial-server.mjs`.

This local trial does not establish Cloudflare branch exclusion or production routing. Those still require separate verification before any future publication.
