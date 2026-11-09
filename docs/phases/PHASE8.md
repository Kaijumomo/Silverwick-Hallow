# Phase 8 — UI, Mobile, Accessibility, and Storyteller UX

Phase 8 keeps the Phase 1–7 game, security, and synchronization model intact and
improves the presentation layer around it.

## Architecture

The implementation uses **Option B**: shared accessible interaction behavior plus
responsive treatment of the existing Storyteller shell. The broad page structure
is retained, while dialogs use `src/components/Modal.tsx`, important controls
have consistent focus/touch affordances, and setup/night panels and the Player
Drawer become bottom sheets at narrow widths.

Privacy Mode remains local Storyteller UI state. No layout or interaction change
writes game state, Firebase projections, or revisions.

## Responsive behavior

- The grimoire sizes from its available container rather than `80vmin` alone.
- At phone widths the grimoire is the primary surface; setup and Night Assistant
  panels overlay it as bottom sheets.
- The Player Drawer also becomes a bottom sheet on narrow screens.
- Header actions collapse behind an accessible “More actions” control.
- Empty planned seats are real buttons with explicit labels and a visible
  `Empty seat` treatment.
- “Add player” fills the first planned empty seat; “+ New seat” deliberately
  adds another empty planned seat. Unused seats can be removed from the seat
  assignment dialog.

## Accessibility

`Modal` provides labelled dialog semantics, `aria-modal`, initial focus, Escape
close, Tab/Shift+Tab containment, and focus restoration. Player Drawer follows
the same keyboard and focus behavior. Important icon/status controls have
visible or semantic labels, and shared focus-visible outlines remain present.

The browser-rendered phone pass was checked at the local in-app viewport with a
15-seat setup, the planned-seat dialog, and the full grimoire. The ring remains
usable without horizontal overflow; a final visual pass should still include
the project’s standard 390px, tablet, and desktop captures when those viewport
surfaces are available.

## Deferred

Phase 6.5B Night Ping, new game mechanics, backend changes, and the broader
visual/mobile redesign remain out of scope.
