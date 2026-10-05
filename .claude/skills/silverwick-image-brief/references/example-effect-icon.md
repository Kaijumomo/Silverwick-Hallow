# Worked example: exploratory "Poisoned" Effect icon

Illustrative only. The direction statement below reflects the state where no Phase 10H visual direction is approved. Re-check the sources each time; do not copy this wording once a direction is frozen.

---

**Objective**

Explore a small-size "Poisoned" Effect icon for the Grimoire participant view. Storytellers must recognize it instantly at seat scale beside other Effect icons.

**Asset type**

Icon, with two concepts.

**Subject / content**

One symbol meaning *poisoned*, an authoritative Effect condition. It must not resemble a Reminder (non-authoritative notation) or a life-state token.

**Silverwick visual direction**

`Visual direction not yet frozen — exploratory concept only.`

Intent: test whether a simpler, more legible glyph reads better at small sizes than the current illustrated icon.

**Composition**

- A single centered emblem filling about 80% of a square canvas, with even padding.
- Readable as one silhouette; no secondary scene.
- Upright orientation; the emphasis is on the silhouette's outer shape.

**Style**

- **Concept A, "line glyph":** single-weight line glyph with rounded terminals and few interior lines. Flat, with no lighting.
- **Concept B, "solid silhouette":** solid filled silhouette with one cut-out detail that keeps it identifiable. Flat, with no lighting.

**Color / typography**

No approved palette exists yet, so no hex values. Render each concept as one solid light color on transparency, so color can be applied later in code.

**Required constraints**

- Transparent background.
- No text or letters.
- Readable at 24–32 px.
- High contrast.
- Suitable for dark UI.
- No drop shadow or glow.
- Symmetric or near-symmetric.
- Consistent stroke weight (concept A).

**Avoid**

- Skull-and-crossbones clichés.
- Dripping slime.
- Glossy 3D, bevels or gradients.
- Fine detail lost below 32 px.
- Checkerboard fake transparency.
- Any resemblance to official *Blood on the Clocktower* icons or tokens.

**Output**

- 1:1, two concepts.
- Final use around 24–48 px; a vector redraw is likely before production use.
- Transparent background.

**Reference material**

Upload with the prompt:

- image 1: `public/status/poisoned.png`, the current Poisoned icon. Use it for the subject only; do not copy its style.
- image 2: `public/status/protected.png`, a sibling Effect icon, to show the set the new icon must sit beside.

**Ready-to-paste ChatGPT Image prompt (concept A)**

```text
Create a single icon meaning "poisoned" for a dark-themed game-master app. Attached image 1 is the current poisoned icon: use it only to understand the subject, do not copy its style. Attached image 2 is a sibling status icon from the same set, shown for context. Design a flat, single-weight line glyph with rounded line ends and minimal interior detail, centered on a square canvas and filling about 80% of it with even padding. One light, solid color on a truly transparent background. It must stay instantly readable when shrunk to 24–32 pixels, so use bold, simple shapes and high contrast. No text or letters, no drop shadow, no glow, no 3D, no bevel, no gradient, no skull-and-crossbones, no dripping slime, no checkerboard pattern, and nothing resembling official Blood on the Clocktower artwork. Square 1:1 output.
```

**Ready-to-paste ChatGPT Image prompt (concept B)**

```text
Create a single icon meaning "poisoned" for a dark-themed game-master app. Attached image 1 is the current poisoned icon: use it only to understand the subject, do not copy its style. Attached image 2 is a sibling status icon from the same set, shown for context. Design a flat, solid filled silhouette with exactly one cut-out detail that makes the meaning clear, centered on a square canvas and filling about 80% of it with even padding. One light, solid color on a truly transparent background. It must stay instantly readable when shrunk to 24–32 pixels: one strong outer shape, no fine detail. No text or letters, no drop shadow, no glow, no 3D, no bevel, no gradient, no skull-and-crossbones, no dripping slime, no checkerboard pattern, and nothing resembling official Blood on the Clocktower artwork. Square 1:1 output.
```

Next step: run one or both prompts in ChatGPT with images 1 and 2 attached, then bring the preferred result back for review.
