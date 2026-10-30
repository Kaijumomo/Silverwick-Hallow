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
  Both scenes carry `will-change: transform`: without it Chrome folded the scene back into the page when the board
  under it was hidden and repainted it, which showed as a black frame on a small allowance.
- **Ember crop** (`moonBackdrop` in `boardArt.tsx`). The ember glow was a full-board blend layer whose gradients are
  transparent beyond 70% of their ellipses. Each gradient now sits in a layer cropped to its area, laid out on the full
  board inside the crop, so every pixel is the same.
- **Seat glow** (`seatGlow` in `boardArt.tsx`). The acting-seat and voter glow animated a box shadow (`swGlow`), which
  Chrome repaints on the main thread every frame. Its two end states are now drawn once and cross-faded with opacity
  (`swGlowRest`, `swGlowPeak`), which the compositor animates. The resting and brightest frames match V2; frames in
  between differ slightly and were shown to the PO side by side. The ring is a separate layer (alpha .8 over .75,
  composing to V2's .95) so it brightens steadily.

- **Canvas sky** (`skyCanvas.ts`, `skyWorker.ts`, `SkyCanvas` in `boardArt.tsx`). The tablet still stuttered on
  Night/Day, on Night order cards and on the victory scene after the changes above. The V2 sky was about a hundred
  page layers (sky, swirl, nebula, embers, moon glow, five shooting stars, ninety stars, beam, dawn wash, two mist
  bands, rim), two of them blurred again on every frame and the sky's colour change a 1.6 s filter animation on a
  full-screen layer. The same layers, in the same order, with the same gradients, blend modes, blurs and animation
  curves, are now painted into one canvas the size of the board, 30 times a second, in a worker where the browser
  allows it (otherwise on the page). Blurred pieces are blurred once per board size. The canvas stops drawing while
  the board rests. Where no 2D canvas is available, or the worker fails, the V2 layers are used as before.
  Every number in `skyCanvas.ts` is copied from `layeredBackdrop` and `grimoire-v6.css`; keep them in step (the unit
  test checks the stars). Frames compared with the V2 layers at the same animation times: 99% of pixels within 5 of
  255 levels; the remaining ones are star and shooting-star edges. The mid-change frames of Night/Day use the same
  filter values as V2 at each moment.

## Not changed

The Night sky noise overlay (deferred importer defect), the two vignettes above the sky, the Reveal glow, the keyboard
behaviour, game logic and data.

## Checking it

Node Playwright against a local `vite preview`, Chromium launched with and without `--force-gpu-mem-available-mb`:
screenshot the Reveal (open and after closing), Night to Day and the victory scene at fixed times, and compare each
frame with the same build at the desktop allowance. Freeze infinite animations at time 0 before comparing board frames.
Results at 256 MB: Reveal, board return, Night to Day and victory complete from the first or second capture. At 128 MB
the Reveal and victory are complete from 0.7 s; Night to Day still leaves faint sky patches (about 10% of pixels at
2.6 s, against 24% before). The seat glow differs from V2 only between its end states (at most 1.6% of the glow area by
more than 4 levels). Scripts and results: Library `package4/tablet-rendering/tablet-first/`.
