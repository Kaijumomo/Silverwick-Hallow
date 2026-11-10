# Archived: Claude Design importer

`dc-to-tsx.mjs` once converted the Claude Design handoff templates (`grimoire.dc.html`, `home.dc.html`) into
`src/features/grimoire-v6/GrimoireV6View.tsx`, `home/HomeV6View.tsx` and their `*-pseudo.css` files.

Those views have since been edited by hand many times, and the `.dc.html` inputs are not in this repository, so
the importer can no longer reproduce them. The TSX files are the source of truth and are maintained directly.
The two `*templatePatches*.json` files are patch lists that were written for the importer and never applied by
the app. Everything here is kept for reference only; nothing in the build or tests reads it.
