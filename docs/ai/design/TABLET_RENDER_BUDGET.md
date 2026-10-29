# Tablet render budget (Grimoire)

On the Samsung Tab S8 Ultra the Grimoire left parts of the screen unpainted: blank regions in a freshly opened Reveal,
the board showing through the bottom of the victory scene, and a dark band over a half-drawn board during Night to Day.
The same build was smooth on a desktop.

## Cause (reproduced in Chromium, not proven on the device)

Chrome gives each page a graphics-memory allowance for painted tiles. A desktop gets a large one; Chrome on Android a
much smaller one. The Night board alone used about 115 MB of tile memory at 1480 x 924 CSS px and 2x density (108
composited layers, 100 never-ending animations). Launching Chromium with a tablet-sized allowance
(`--force-gpu-mem-available-mb=256` or `128`) reproduces all three symptoms; the desktop allowance shows none.
The tablet's real allowance has not been read from the device.

## What the Grimoire does about it (look unchanged)

- **Board rest** (`src/features/grimoire-v6/boardRest.ts`). The Reveal and the victory scene are opaque and cover the
  whole Grimoire. Once either has finished its fade-in (`swRise`), the board is hidden with `visibility` so Chrome
  stops keeping it in tile memory, and it is shown again in the frame the scene closes. Layout, state and animations
  are untouched. Keyboard focus taken from the board is given back on close. Without the fade-in (no `animationend`)
  the board stays drawn.
- **Ember crop** (`moonBackdrop` in `boardArt.tsx`). The ember glow was a full-board blend layer whose gradients are
  transparent beyond 70% of their ellipses. Each gradient now sits in a layer cropped to its area, laid out on the full
  board inside the crop, so every pixel is the same.
- **Seat glow** (`seatGlow` in `boardArt.tsx`). The acting-seat and voter glow animated a box shadow (`swGlow`), which
  Chrome repaints on the main thread every frame. Its two end states are now drawn once and cross-faded with opacity
  (`swGlowRest`, `swGlowPeak`), which the compositor animates. The resting and brightest frames match V2; frames in
  between differ slightly and were shown to the PO side by side. The ring is a separate layer (alpha .8 over .75,
  composing to V2's .95) so it brightens steadily.

## Not changed

The Night sky noise overlay (deferred importer defect), the mist, nebula, beam and vignettes, the stars, the Reveal
glow, the keyboard behaviour, game logic and data. Lightening those changes the look and needs PO approval.

## Checking it

Node Playwright against a local `vite preview`, Chromium launched with and without `--force-gpu-mem-available-mb`:
screenshot the Reveal (open and after closing), Night to Day and the victory scene at fixed times, and compare each
frame with the same build at the desktop allowance. Freeze infinite animations at time 0 before comparing board frames.
Scripts and results: Library `package4/tablet-rendering/tablet-first/`.
