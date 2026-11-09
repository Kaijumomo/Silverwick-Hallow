# Rules

Pure game-rules logic with no React and no screen code. The store and the screens both read from here; nothing
here imports from `src/features`.

- `setup/`: setup analysis, policies, readiness, refinement, red herring and Marionette seating checks, random
  setup and role-pool filling.
- `night/`: the night order and the rules that decide who wakes.

The night work list (`features/nightOrder/nightWork.ts`) stays with the screens for now because it uses the
ability-panel helpers in `features/abilities/abilityUi.ts`.
