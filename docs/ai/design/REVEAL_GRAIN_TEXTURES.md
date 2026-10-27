# Reveal grain textures

`reveal-grain-overlay.webp` (480 x 480, drawn at 240 CSS px) and `reveal-grain-multiply.webp` (1200 x 1200, drawn at 600 CSS px)
are the film grain of the Reveal (Show) screen, used by `src/features/grimoire-v6/revealGrain.ts`.

They are renders of the two noise definitions in the Claude Design V2 file (`Storyteller Grimoire v6.dc.html`), made once so the
browser does not evaluate SVG filters or composite blend layers at runtime. Lossless WebP.

Recipe: draw each SVG at 2x device scale in Chromium on a transparent page and screenshot the element with a transparent
background, then multiply the alpha channel by the layer's opacity (.22 overlay, .35 multiply) and round.

- overlay: `<svg width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .9 0 0 0 0 .8 0 0 0 0 .65 0 0 0 .9 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`
- multiply: `<svg width='600' height='600'><filter id='l'><feTurbulence type='turbulence' baseFrequency='.012 .02' numOctaves='4' seed='4'/><feColorMatrix values='0 0 0 0 .2 0 0 0 0 .08 0 0 0 0 .08 0 0 0 1.4 -.4'/></filter><rect width='100%' height='100%' filter='url(#l)'/></svg>`

Files: `public/textures/`. Generated art, not part of the official token art in `public/art`.

Known difference from V2 (measured over 16 animation frames): the baked overlay brightens about 76% as much as the live layer, so the Reveal is on average 0.57 of a level darker, at most 7 levels in the glow centre. The cause is not established. Texture opacity is folded into the alpha, so retuning means re-baking.
