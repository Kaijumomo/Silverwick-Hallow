---
name: silverwick-image-brief
description: Write a complete, ready-to-paste ChatGPT Image Generation brief for Silverwick Hollow visual material. Covers icons, Effect or Reminder symbols, logo or branding exploration, visual motifs, textures and backgrounds, ornamental assets, moodboards, UI visual-direction concepts, illustrations, alternate treatments of an approved screen, and edits or variants of an existing image. Claude writes the brief; the user runs it in ChatGPT and brings back the chosen image. Not for implementing React UI, responsive layout, accessibility verification or interaction design. Never claims an image was generated.
---

# Silverwick Image Brief

Silverwick has no image-generation tool or API in Claude Code. This skill is a manual bridge:

1. **Claude** writes the brief (format below), ending in one ready-to-paste prompt.
2. **The user** pastes the prompt into ChatGPT Image Generation, uploads any listed reference files, and picks a result.
3. **The user** brings the chosen image back, by attaching it or saving it at a path Claude can read.
4. **Claude** reviews the returned image against the brief and, if asked, writes an edit brief for the next round.

## Hard rules

- **Never generate or pretend.** Never say an image was generated, and never describe or judge an image Claude has not been given. Do not use or install Codex, `gpt-image-skill`, the OpenAI API or `OPENAI_API_KEY`.
- **Spell out uploads.** ChatGPT cannot see repository paths. List every reference file the user must upload. In the prompt, refer to the uploads by number ("attached image 1"), never by path.
- **Don't invent an approved style.** Check the sources in "Gather context" first. If no visual direction is approved, write exactly: `Visual direction not yet frozen — exploratory concept only.`
- **Don't invent brand values.** Quote exact colors or typefaces only when an approved project source states them, and cite that source. Otherwise describe roles and contrast ("one warm accent against dark neutral surfaces"), not hex values or font names.
- **Silverwick-original imagery only.**
  - Never ask ChatGPT to reproduce or imitate official *Blood on the Clocktower* art, character icons, tokens, logo or trade dress.
  - Never ask for the style of a named living artist.
  - Never present output as official. Publisher data is used under the publisher's community content policy (`src/data/canonical/README.md`); that is not a license to its artwork.
- **Keep product meaning intact** (see `TERMINOLOGY.md`):
  - **Effects and Reminders stay visually distinct.** An Effect is an authoritative condition; a Reminder is non-authoritative notation. A Reminder symbol must never read as an Effect state.
  - **Use fictional sample data.** Concept images of Storyteller or player screens use clearly fictional names and data. They must never suggest private Storyteller information on a public or player surface (Privacy Mode and projection boundaries).
  - **Escalate conflicts.** If the requested visual conflicts with a frozen invariant in the active phase contract, raise it for Sol instead of briefing around it.
- **Images are direction, not specification.** A generated UI concept is input to design direction. Layout, responsive behavior, accessibility and interaction are decided in code, against `PHASE10H.md` and `docs/ai/design/WEB_INTERFACE_GUIDELINES_PINNED.md`.
- **Using an image in the app is a production change.** Placing a returned image in `public/` or `src/` needs explicit authorization. Until then, candidates stay in scratch or review locations.

## Gather context (check, don't assume)

1. **Visual direction**, in order:
   - `.claude/skills/silverwick-ui-design/`, the approved direction once it exists;
   - the visual north star status in `PHASE10H.md` (§8 and 10H-A);
   - `docs/ai/handoffs/CURRENT_HANDOFF.md`.

   A direction is approved only when those sources say the project owner approved it.
2. **Meaning:** `TERMINOLOGY.md` for any game concept the image depicts.
3. **Candidate references.** These show what exists today, not an approved style, unless a source says otherwise:
   - `public/status/*.png`: current Effect presentation art (drunk, poisoned, protected; 1254×1254);
   - `public/tokens/*.png`: public life-state tokens;
   - `public/bg/*.png`: menu backgrounds;
   - repository-root `*.png`: screenshots of the current UI.
4. Ask one short question only when the asset's purpose or subject is genuinely unknown. Otherwise write the brief.

## Brief format

Use these sections, in this order. Keep each section short; omit **Color / typography** when it isn't relevant.

1. **Objective:** what the image is for and where in Silverwick it will be used.
2. **Asset type:** icon, UI concept, decorative asset, texture, illustration, logo exploration, image edit, or variation.
3. **Subject / content:** exactly what must appear, and nothing optional left implied.
4. **Silverwick visual direction:**
   - If approved: summarize it and cite the source.
   - If not: `Visual direction not yet frozen — exploratory concept only.`, followed by the exploratory intent for this brief.
5. **Composition:** framing, hierarchy, placement, negative space, orientation, visual emphasis.
6. **Style:** concrete rendering terms, not vague words like "cool" or "modern". Name these:
   - the medium: flat vector, engraved line, painted, photographic texture, …;
   - line weight;
   - shape language;
   - level of detail;
   - lighting, if any;
   - finish.
7. **Color / typography (only when relevant):** approved values with their source, or relational guidance. Never invented brand values.
8. **Required constraints.** Pick the ones that apply, for example:
   - transparent background;
   - no text or letters;
   - readable at 24–32 px;
   - high contrast;
   - symmetric or asymmetric;
   - suitable for dark UI;
   - no drop shadow;
   - a single centered subject;
   - consistent stroke across a set.
9. **Avoid:** unwanted traits for this asset, plus typical generic-AI tendencies:
   - glossy 3D or bevel effects, gratuitous glow or lens flare;
   - purple–blue gradients;
   - stock fantasy clichés;
   - noisy over-detailing that will not survive downscaling;
   - fake or garbled lettering;
   - checkerboard "transparency";
   - near-identical variants;
   - anything resembling official game art.
10. **Output:**
    - aspect ratio;
    - intended final pixel size, if known;
    - transparent or opaque background;
    - number of concepts.

    ChatGPT renders at its own sizes, so state the ratio and plan to downscale. Small production icons may still need a vector redraw; say so for icon briefs.
11. **Reference material:** each file the user must upload, as `path` → what it is for. For example, "image 1: current Poisoned icon, match its silhouette weight". If there are none, write "None."
12. **Ready-to-paste ChatGPT Image prompt:** one self-contained prompt in a fenced block.
    - It contains every essential instruction from the sections above: subject, composition, style, constraints, avoid list, output spec and the role of each attached image.
    - The user should not need to reconstruct anything.
    - Write plain prose with explicit exclusions; no repository paths, no Markdown headings.

## Edit and revision briefs

When the user wants an existing image changed, write an **edit brief**, not a fresh-generation prompt:

- **Source image:** the file to revise and its path, or "the image you received from ChatGPT". If Claude cannot access it, say the user must upload it with the prompt.
- **Keep unchanged:** what must stay as it is (composition, silhouette, palette, subject, …).
- **Change:** exactly what must change, split into:
  - structural changes: shape, layout, elements added or removed;
  - stylistic changes: line, color, texture, finish.
- **Edit prompt:** a fenced, ready-to-paste prompt starting "Edit the attached image: keep … ; change … ;". It restates the output constraints.

For a follow-up revision, the newest returned image becomes the source. Do not revert to the original by mistake.

## Variations

Offer up to **three** concepts only when exploring is useful. Each concept differs on a real design axis, for example:

- **Metaphor:** a different object or symbol for the same concept.
- **Rendering approach:** single-weight line glyph vs solid silhouette vs layered duotone.
- **Composition or density:** emblematic and centered vs scene-based vs pattern or tile.
- **Mood within an approved direction:** quieter and more utilitarian vs more ornamental. Only within an approved direction, or labeled exploratory.

Give each concept a one-line label and its own complete ready-to-paste prompt. Never produce near-identical prompts that differ only by a number or one adjective.

## After the image comes back

- Review only what Claude can actually see. Check it against the brief: subject, constraints, readability at the target size, consistency with sibling assets, the Effect/Reminder distinction, and transparency. A checkerboard pattern is not transparency.
- Report what passes and what fails. If useful, write an edit brief for the next round.
- Selecting, committing or wiring an image into the app follows the production-change rule above.

See `references/example-effect-icon.md` for a complete worked brief.
