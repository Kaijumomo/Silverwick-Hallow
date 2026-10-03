# Phase 10F — Authoritative Proof-Character Rules Matrix

**Status:** SOL RULES FREEZE — IMPLEMENTATION AUTHORIZED AFTER THIS CHECKPOINT  
**Date:** 2026-10-02  
**Rules-neutral implementation verified at:** `aeda04351895175eb78a147fe9c133519fd4f3ba`  
**Canonical repository data revision:** `f10cd02e3401af227ce406287eaae7bb99a06a42`  
**Scope:** Phase 10F proof set only. Full canonical coverage remains Phase 11.

## 1. Source policy

This matrix is the authoritative character-semantics contract for Phase 10F.

Source precedence:

1. the publisher Blood on the Clocktower Wiki character **How to Run** / rules pages;
2. the publisher general rules pages (Abilities, States, Glossary);
3. the pinned canonical ability/night text already stored in Silverwick;
4. explicit Sol adjudication of how an authoritative BOTC rule maps onto Silverwick's frozen 10A–10F architecture.

If a future source contradicts this matrix, stop for Sol adjudication. Do not silently update mechanics from prose.

No Reminder label/note is mechanical authority.

### General rules relied on by several characters

- Drunk/poisoned players have no ability, but the Storyteller pretends they do; false information is allowed. A once-per-game attempt while drunk/poisoned is spent.
- Persistent ability effects end immediately when the source loses the ability (death, drunk/poisoned, character change) and may resume only where the rules actually make them persistent again.
- A player who becomes a new character gains the new ability immediately; their alignment does not change merely because their character changes.
- `Each night*` means every night phase except the **first night phase of the game**, not "this participant's first night."
- Dead players cannot die again.
- "Might" means the Storyteller decides.
- A death-trigger ability such as Ravenkeeper still resolves when the character dies because the ability explicitly triggers on that death.

General sources:

- https://wiki.bloodontheclocktower.com/Abilities
- https://wiki.bloodontheclocktower.com/States
- https://wiki.bloodontheclocktower.com/Glossary

## 2. Implementation classes

**GUIDED** — production AbilityDescriptor + evaluator is authorized.

**GUIDED-PARTIAL** — a clearly bounded branch is guided; another officially known branch deliberately falls to Manual because Silverwick lacks an authoritative state home or because a different product subsystem is out of scope.

**VERIFIED-MANUAL** — official rules are understood, but the correct product representation is Manual/reference-only in 10F.

**SETUP-OWNED** — no live Ability evaluator. Existing/future Setup logic owns it.

**SUPPORT SEMANTIC** — not one of the 14 proof cases, but required to prove one (e.g. Empath for Drunk→Empath).

## 3. Shared death/protection rule for evaluators

Before an evaluator emits a death intent it must query protection for the actual cause:

- Demon ability death/harm → `RulesQuery.protectedFrom(target, "demon")`
- all other deaths → `RulesQuery.protectedFrom(target, "any")`

If protection is known true, do not emit the death.

If known false, emit the death when the character rule says it occurs.

If unknown (including generic manual Protected), ask for Storyteller judgment. Never infer.

This rule applies to Imp, Slayer, Al-Hadikhia, Harlot, Tinker (Manual guidance) and any Storyteller-selected death created by later semantics.

---

# 4. Poisoner — GUIDED

Official source: https://wiki.bloodontheclocktower.com/Poisoner

Pinned ability:

> Each night, choose a player: they are poisoned tonight and tomorrow day.

### Descriptor

- timing: `firstNight`, `otherNight`
- invocation: `wake`
- usage: unlimited
- input: 1 participant, Player choice
- target constraints: none; any current participant is legal, including self/dead
- hooks: targeting
- sourced effect: `poisoned`, persistence `whileSourceFunctions`

### Functioning resolution

Apply one Effect to the selected participant:

- type: `poisoned`
- sourceParticipant: Poisoner actor
- sourceCharacter: `poisoner`
- lifetime: `throughFollowingDay`
- authoritative expiry from Night N: entry to Night N+1

The existing Effect lifecycle removes it at the Day→Night transition.

### Source-function rule

The effect is applicable only while the source still has the Poisoner ability functioning.

The official rules explicitly establish that persistent poison ends if the Poisoner dies, becomes impaired, or changes character; the official Poisoner example says a Mayor ceases to be poisoned when the Poisoner becomes the Imp.

Do not remove/rewrite the stored Effect merely because source applicability becomes false; Rules Query derives applicability.

### Impaired Poisoner

Wake/simulate the choice, but produce no poisoned Effect.

---

# 5. Monk — GUIDED

Official source: https://wiki.bloodontheclocktower.com/Monk

Pinned ability:

> Each night*, choose a player (not yourself): they are safe from the Demon tonight.

### Descriptor

- timing: `otherNight`
- invocation: `wake`
- usage: unlimited
- input: 1 participant, Player choice
- constraints: `notSelf`
- target may otherwise be alive or dead
- sourced effect: `safeFromDemon`, persistence `whileSourceFunctions`
- hooks: targeting, death

### Functioning resolution

Apply:

- type: `safeFromDemon`
- sourceParticipant: Monk actor
- sourceCharacter: `monk`
- lifetime: `untilDawn`
- expiry: entry to Day N

Official scope is broader than "cannot be killed": while applicable the selected player is safe from **all harmful effects of Demon abilities** that night (death, poisoning, alignment change, etc.).

For current 10F proof semantics, `protectedFrom(..., "demon")` must at least prevent Demon-caused death. Future harmful-effect evaluators consult the same semantic family.

### Source-function rule

If the Monk loses the ability before the relevant Demon effect resolves, the protection no longer applies.

### Impaired Monk

The Monk is still simulated/woken to choose, but no authoritative safe-from-Demon Effect is produced.

---

# 6. Imp — GUIDED

Official sources:

- https://wiki.bloodontheclocktower.com/Imp
- https://wiki.bloodontheclocktower.com/Scarlet_Woman
- https://wiki.bloodontheclocktower.com/Monk
- https://wiki.bloodontheclocktower.com/Abilities

Pinned ability:

> Each night*, choose a player: they die. If you kill yourself this way, a Minion becomes the Imp.

### Descriptor

- timing: `otherNight`
- invocation: `wake`
- usage: unlimited
- input: 1 participant, Player choice
- target constraints: none; any player may be chosen, alive/dead/self
- hooks: targeting, death, role

### Non-self target

If target is dead: no Life mutation; complete the step.

If alive:

1. query `protectedFrom(target, "demon")`;
2. protected → no death;
3. unknown → Storyteller judgment;
4. unprotected → one Demon-caused death.

### Self-target / star-pass

A star-pass occurs only if the Imp **actually dies from this Imp ability**.

If Demon protection/death immunity prevents the Imp's death, no star-pass occurs.

If functioning Imp dies:

1. death of old Imp occurs first;
2. choose successor according to the rules below;
3. successor Role change to Imp occurs after that death;
4. new Imp does **not** act again that same Night; mark the new participant's current Imp Night step skipped/completed so re-derived Night Order cannot grant a second Imp action.

### Successor selection

Official Imp rule: the Storyteller chooses an alive Minion.

If exactly one eligible alive Minion exists, selection is deterministic.

If several exist, ask for Storyteller choice.

Dead Minions are not eligible.

### Scarlet Woman dependency

This is a verified dependency of Imp semantics, not full Scarlet Woman coverage.

If immediately before the Demon death:

- a canonical Scarlet Woman is alive;
- her ability functions;
- there are at least 5 alive non-Traveller players;

then the Scarlet Woman **must** become the new Imp before any other Minion.

If that priority does not function, the Scarlet Woman remains an ordinary alive-Minion candidate for the Imp's own Storyteller choice.

### Impaired Imp

The simulated target choice produces no death and therefore no star-pass.

### Game end

10F records the authoritative death/Role transition only. Existing/future game-end handling decides victory; do not invent a second win-state engine here.

---

# 7. Fortune Teller — GUIDED with approved Red Herring state

Official sources:

- https://wiki.bloodontheclocktower.com/Fortune_Teller
- https://wiki.bloodontheclocktower.com/Recluse
- https://wiki.bloodontheclocktower.com/States

Pinned ability:

> Each night, choose 2 players: you learn if either is a Demon. There is a good player that registers as a Demon to you.

### Descriptor

- timing: `firstNight`, `otherNight`
- invocation: `wake`
- usage: unlimited
- input: 2 participant selections, Player choice
- alive/dead/self all allowed
- no additional "must be alive" constraint
- hooks: information, registration, targeting

### Red Herring — authoritative state home

Approved Effect type:

`fortuneTellerRedHerring`

This is Storyteller-private authoritative setup/current state, **not a Reminder**.

Contract:

- target: one participant who is actually good when selected;
- same participant remains the Red Herring throughout the game;
- Effect state active;
- lifetime `manual` / expiry `none`;
- no mechanical dependence on source functioning; the Fortune Teller evaluator itself decides when the fact matters;
- no public/self projection.

For an initial Fortune Teller, if the Red Herring fact is missing during the first Fortune Teller guided resolution, the workflow first asks the Storyteller to choose one currently good participant and includes creation of this Effect in the same resolution before Information Delivery.

Do not create/reselect the Red Herring every night.

If a later-night snapshot has zero or multiple Red Herring facts, refuse automatic computation and require Storyteller correction/manual resolution.

If a Fortune Teller is first created mid-game with no existing Red Herring, 10F does **not** invent one; route to Manual until the dynamic-creation rule receives separate authoritative coverage.

### Information result

For each of the two chosen players:

- actual Demon → counts Yes;
- Red Herring → counts Yes;
- dead Demon still counts Yes;
- registration ambiguity (e.g. Recluse) → Storyteller judgment through Rules Query;
- otherwise not Demon.

Result is one Boolean: Yes if either chosen participant registers/qualifies as Demon.

Store the actual communicated answer through Information Delivery.

### Impairment

A drunk/poisoned Fortune Teller still wakes and chooses two players, but the Storyteller may communicate either structurally valid Boolean answer. Do not compute it as functioning information.

---

# 8. Drunk shown as Empath — GUIDED simulated Information proof

Official sources:

- https://wiki.bloodontheclocktower.com/Drunk
- https://wiki.bloodontheclocktower.com/Empath
- https://wiki.bloodontheclocktower.com/States

### Required support semantic: Empath

Empath is authorized as a **SUPPORT SEMANTIC** because the proof requires a Drunk simulated as Empath.

Empath descriptor:

- timing: `firstNight`, `otherNight`
- invocation: `wake`
- usage: unlimited
- inputs: none
- hooks: information, registration

For a functioning actual Empath:

- derive the two closest alive neighbours;
- determine how many register as evil;
- if registration is unambiguous, compute 0/1/2;
- if any required registration is ambiguous, ask Storyteller for the final 0/1/2 result.

### Drunk→Empath simulation

When Actual Role is Drunk and Shown/wake Role is Empath:

- no Empath mechanical ability exists;
- wake the player as Empath;
- ask Storyteller for the communicated integer 0, 1 or 2;
- record Information Delivery with:
  - Actual Role = Drunk;
  - performedRole = Empath;
  - Empath Information Action;
- produce no authoritative Empath mechanic.

The Storyteller may give correct or false information; no rule says it must be false.

---

# 9. Ravenkeeper — GUIDED triggered ability

Official sources:

- https://wiki.bloodontheclocktower.com/Ravenkeeper
- https://wiki.bloodontheclocktower.com/Abilities
- https://wiki.bloodontheclocktower.com/Drunk

Pinned ability:

> If you die at night, you are woken to choose a player: you learn their character.

### Descriptor

- timing: `triggered`
- invocation: `wake`
- usage: unlimited
- input after trigger: 1 participant, Player choice
- chosen player may be alive or dead
- hooks: information, registration, wake

### Approved trigger path extension

10F implementation may add one explicit rules-neutral invocation path for verified Night triggers, conceptually:

`nightTrigger`

It is not a generic "triggered means runnable" path.

Eligibility requires the character's verified trigger predicate to be established from authoritative Current State/Life Event Window.

For Ravenkeeper the predicate is:

- this exact ParticipantId died during the current Night;
- Life Event Window coverage for the relevant moment is known.

The step should be inserted/available immediately after that death rather than waiting for ordinary night-sheet position.

If coverage is unknown, route to Storyteller judgment/manual rather than assuming no trigger.

### Functioning Ravenkeeper

After the trigger:

- choose any participant;
- learn that participant's character;
- registration ambiguity is Storyteller judgment (official Ravenkeeper example allows a dead Recluse to register as Scarlet Woman);
- record the communicated Role via Information Delivery.

### Impaired Ravenkeeper

The death trigger is still simulated: the Storyteller wakes the Ravenkeeper as though the ability works, accepts the target choice, and may show arbitrary structurally valid character information.

No functioning mechanical information is computed.

---

# 10. Slayer — GUIDED Day public claim

Official sources:

- https://wiki.bloodontheclocktower.com/Slayer
- https://wiki.bloodontheclocktower.com/Recluse
- https://wiki.bloodontheclocktower.com/States

Pinned ability:

> Once per game, during the day, publicly choose a player: if they are the Demon, they die.

### Descriptor

- timing: `day`
- invocation: `publicClaim`
- usage: `oncePerGame`
- input: 1 participant, Player choice
- target may be alive/dead/self
- hooks: targeting, registration, death

### Actor eligibility

A dead Slayer has no ability and cannot perform a real guided Slayer use.

A living drunk/poisoned Slayer may attempt it; the once-per-game use is spent, but no target dies from the Slayer ability.

### Functioning resolution

Always include `useAbility` for the Slayer in the same resolution.

For the target:

- dead target → no death;
- actual Demon → Demon registration true;
- non-Demon with no registration ambiguity → false;
- Recluse/other false-registration case → Storyteller judgment.

If the target registers as Demon and is alive:

1. query `protectedFrom(target, "any")`;
2. known protected → no death;
3. unknown → Storyteller judgment;
4. unprotected → death.

A Recluse may therefore be killed by Slayer if the Storyteller has them register as a Demon.

---

# 11. Cult Leader — GUIDED-PARTIAL

Official source: https://wiki.bloodontheclocktower.com/Cult_Leader

Pinned ability:

> Each night, you become the alignment of an alive neighbor. If all good players choose to join your cult, your team wins.

### Night alignment portion — GUIDED

- timing: `firstNight`, `otherNight`
- invocation: `procedure`
- usage: unlimited
- inputs: none unless judgment needed
- hooks: alignment, registration, information

Use the two alive neighbours.

If both unambiguously have the same relevant alignment, the resulting alignment is deterministic.

If one is good and one evil, Storyteller chooses either result.

If registration/modifier state makes the relevant alignment ambiguous, ask Storyteller for the resulting alignment.

If the Cult Leader is impaired, no nightly alignment change occurs.

If Actual Alignment changes:

1. change Actual Alignment through the Alignment seam;
2. update player-facing alignment perception through the existing perception/Role seam so the player is told the new alignment;
3. preserve explicit mechanical order: Actual Alignment, then perception.

If Actual Alignment does not change, do not wake/tell the player merely for this ability.

### Day cult formation — VERIFIED-MANUAL

The official Day ability is understood, but nominations/voting/cult-vote resolution remains outside Silverwick's Phase 10 authoritative scope.

Do not implement a parallel vote engine.

Player Drawer Manual/reference remains the path for this portion.

---

# 12. Pit-Hag — GUIDED-PARTIAL

Official sources:

- https://wiki.bloodontheclocktower.com/Pit-Hag
- https://wiki.bloodontheclocktower.com/Abilities
- https://wiki.bloodontheclocktower.com/Glossary

Pinned ability:

> Each night*, choose a player & a character they become (if not in play). If a Demon is made, deaths tonight are arbitrary.

### Descriptor

- timing: `otherNight`
- invocation: `wake`
- usage: unlimited
- inputs:
  - 1 participant, Player choice;
  - 1 character, Player choice
- hooks: role, death, targeting

### Ordinary non-Demon transformation — GUIDED

If selected character is already in play: nothing happens mechanically; complete the Pit-Hag step.

If selected character is not in play and is not a Demon:

- change target Actual Role through Role seam;
- preserve target Actual Alignment;
- notify the target of their new character through the existing Role/perception semantics where required;
- Role change resets/establishes ability-use state according to the frozen Role seam.

Square-bracket setup text of the newly created character never fires mid-game.

A newly created character gains its ability immediately. 10F does not invent additional automatic wake timing beyond verified semantics; if the new character needs an immediate/first-night-style procedure not yet represented, surface a Storyteller follow-up/manual action.

### Demon creation branch — VERIFIED-MANUAL in 10F

The official rule gives the Storyteller authority to make deaths/protections arbitrary throughout the rest of that Night.

10F currently has no authoritative game-level state home for "Pit-Hag deaths tonight are arbitrary."

Therefore selecting a Demon must not partially auto-resolve and then forget that rule.

Route the entire Demon-creation resolution to Manual/unmodeled interaction in 10F, with an explanation that the Role change plus arbitrary-death Night state requires 10G's game-level bookkeeping.

Do not fake this with a Reminder.

### Optional Traveller transformation

Official material calls transforming Travellers an optional rule. Do not automate that option in 10F. Manual only.

---

# 13. Al-Hadikhia — GUIDED

Official source: https://wiki.bloodontheclocktower.com/Al-Hadikhia

Pinned ability:

> Each night*, you may choose 3 players (all players learn who): each silently chooses to live or die, but if all live, all die.

### Descriptor

- timing: `otherNight`
- invocation: `procedure` / Night wake sequence
- usage: unlimited
- initial Player choice: either choose nobody OR choose exactly 3 distinct participants
- then each selected participant supplies their own live/die choice, in order
- hooks: death

### No-selection branch

If the Al-Hadikhia chooses nobody:

- no public chosen-player announcement;
- no Life mutation;
- complete step.

### Ordered three-player branch

Record target order 1 → 2 → 3.

For each target, resolve their choice before asking/resolving the next:

**Choose live**
- if dead, resurrect;
- if already alive, no Life change.

**Choose die**
- if already dead, remains dead;
- if alive, evaluate `protectedFrom(target, "any")`;
- if protected, remains alive;
- if unknown, Storyteller judgment;
- otherwise dies.

After all three choices, inspect the evolving final alive state.

If all three are alive, attempt to kill all three, in 1→2→3 order, again respecting individual death protection.

The official rule explicitly says a player who chose death but did not die counts as alive for the all-live calculation.

### Presentation

The selected players are public information and the choices occur sequentially while other players remain silent.

Silverwick's workspace should preserve the 1/2/3 order and should not collapse the choices into an unordered batch.

---

# 14. Tinker — VERIFIED-MANUAL

Official source: https://wiki.bloodontheclocktower.com/Tinker

Pinned ability:

> You might die at any time.

### Semantics classification

- timing: `passive`
- invocation: `none`
- Storyteller discretion is the mechanic
- not a generic guided Day/Night action

The Storyteller may choose to kill the Tinker at any time.

Before recording such a death, protection must be respected; the official page explicitly says a protected Tinker cannot die from this ability.

In 10F this is best represented by the Player Drawer Manual path plus clear Tinker reference text, not a fake deterministic evaluator.

No automatic random death.

No automatic endgame death; the official page advises against Storyteller-fiat game-ending Tinker deaths, but this is guidance rather than a new hard legality rule.

---

# 15. Harlot — GUIDED

Official sources:

- https://wiki.bloodontheclocktower.com/Harlot
- https://wiki.bloodontheclocktower.com/Glossary
- https://wiki.bloodontheclocktower.com/Travellers

Pinned ability:

> Each night*, choose a living player: if they agree, you learn their character, but you both might die.

### Descriptor

- timing: `otherNight`
- invocation: `wake`
- usage: unlimited
- first input: one **living** participant, Player choice
- second input: chosen participant consent, Player choice Boolean
- hooks: information, registration, death

`Each night*` uses the game-wide first-night definition. A Harlot who joins after Night 1 is not automatically treated as "first night" merely because they are new.

### Decline

If chosen participant says No:

- no Information Delivery;
- no death;
- complete the Harlot step.

### Consent

If Yes:

1. determine the character shown to Harlot;
2. registration ambiguity is Storyteller judgment;
3. record Information Delivery to Harlot;
4. ask Storyteller whether to invoke the optional/might-death consequence.

If Storyteller chooses death consequence, attempt to kill both Harlot and selected participant in one ability resolution, each respecting `protectedFrom(..., "any")`.

Death order is only mechanically significant if another rule makes it significant; if so, ask Storyteller/order explicitly rather than inventing one.

The official advice that a Storyteller should not end the game by killing a Demon through Harlot is guidance, not encoded as a universal hard refusal.

---

# 16. Toymaker — VERIFIED-MANUAL / 10G dependency

Official source: https://wiki.bloodontheclocktower.com/Toymaker

Pinned ability:

> The Demon may choose not to attack & must do this at least once per game. Evil players get normal starting info.

### Verified rules

- first-night normal Minion/Demon information happens even below 7 players;
- the Demon may voluntarily choose to attack nobody;
- this must happen at least once per game;
- if an attack could end the game and the required skip has not happened, the Demon does not wake/act to attack.

### 10F state decision

The "Demon has already skipped an attack" fact is mechanically authoritative game-level state.

A Reminder cannot own it.

No current 10F participant Effect is a truthful universal home for it.

Therefore full Toymaker automation remains a **10G authoritative-state dependency**.

For 10F:

- retain Fabled modifier gating;
- when Toymaker could affect a Demon attack, require explicit Storyteller judgment/manual handling;
- do not claim to know whether the mandatory skip has already been satisfied;
- do not create a fake Reminder-based mechanic.

Existing first-night evil-information policy may continue where already implemented and verified, but the skip-history mechanic remains Manual until 10G.

---

# 17. Baron — SETUP-OWNED negative proof

Official source: https://wiki.bloodontheclocktower.com/Baron

Pinned ability:

> There are extra Outsiders in play. [+2 Outsiders]

### Contract

The Baron has no live ability evaluator.

Its +2 Outsider effect is Setup-only:

- two Townsfolk slots are replaced by two Outsiders during setup;
- the setup change does not revert if the Baron dies;
- square-bracket setup text does not run when Baron is created mid-game.

Phase 10F proves the negative boundary: canonical Baron semantics must not create a live Night/Day guided ability.

Existing Setup composition logic remains authoritative.

---

# 18. Proof-set support / dependency rules

## 18.1 Scarlet Woman dependency for Imp

Only the narrow verified Demon-death/Imp-starpass priority described in §6 is authorized in 10F.

This does not add general Scarlet Woman guided UI or full Phase 11 coverage.

## 18.2 Empath support semantic

Empath is authorized because Drunk→Empath cannot be proven without the performed-role Information Action.

Implementing actual Empath information at the same time is permitted and preferred because the same evaluator can branch on `simulated`.

## 18.3 Recluse / registration

Do not implement a full Recluse ability workflow merely to support these characters.

Continue using the Rules Query registration judgment boundary.

Where official rules explicitly permit Recluse misregistration (Fortune Teller, Ravenkeeper, Slayer examples), Storyteller judgment is authoritative.

---

# 19. Deliberately deferred interactions

These are known, not forgotten:

- Fortune Teller created mid-game without an existing Red Herring → Manual / Phase 11 or 10G adjudication.
- Pit-Hag Demon-created arbitrary deaths Night state → 10G.
- Pit-Hag optional Traveller transformation → Manual.
- Cult Leader cult-vote/win resolution → outside nominations/voting scope.
- Toymaker attack-skip history → 10G.
- global game-end/winner automation → not introduced by these semantics.
- full Jinx behavior beyond already verified scoped gates → Phase 11F.
- broad gained-ability systems (Philosopher/Bone Collector/etc.) → later coverage.
- every non-proof canonical character → Phase 11.

# 20. Implementation order

Claude Code should implement in this order so the safest semantics land first:

1. Poisoner
2. Monk
3. Empath support + Drunk→Empath
4. Fortune Teller + Red Herring state
5. Slayer
6. Cult Leader nightly alignment
7. Harlot
8. Al-Hadikhia
9. Imp + narrow Scarlet Woman dependency
10. Ravenkeeper + explicit Night-trigger invocation path
11. Pit-Hag non-Demon branch + Demon Manual gate
12. Tinker verified-manual descriptor/reference
13. Toymaker verified Manual/10G gate
14. Baron negative Setup-owned proof

Each character gets:

- descriptor/evaluator or explicit verified-manual/setup classification;
- source-traceability comment to this matrix;
- focused unit tests;
- UI scenario test where guided;
- impairment tests where applicable;
- ParticipantId/stale test when targeting players;
- protection/registration/judgment tests where applicable;
- homebrew RoleId collision test;
- no parsing of ability text.

# 21. Closure boundary

Completing this matrix does **not** close Phase 10F.

After implementation:

1. Luna verifies the proof semantics mechanically.
2. Astra adversarially challenges rule fidelity, composition, UI and edge interactions.
3. Sol adjudicates/remediates.
4. targeted closure review runs.
5. only then may 10F integrate into `main`.
