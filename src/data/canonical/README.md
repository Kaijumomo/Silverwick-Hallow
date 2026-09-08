# Canonical reference snapshot

Publisher: The Pandemonium Institute, Blood on the Clocktower.

Source: https://github.com/ThePandemoniumInstitute/botc-release/tree/f10cd02e3401af227ce406287eaae7bb99a06a42/resources/data

Revision: `f10cd02e3401af227ce406287eaae7bb99a06a42`. Verified September 7, 2026 (America/New_York).

The publisher makes these resources available for toolmakers under its Community Created Content Policy. These are attributed publisher assets, not Silverwick-authored rules. See https://github.com/ThePandemoniumInstitute/botc-release for the publisher's policy link, terms and attribution requirements.

`roles.json`, `nightsheet.json`, and `jinxes.json` preserve the downloaded structured data, reformatted as JSON. Do not hand-edit canonical meaning in wrappers or UI. `index.ts` adapts spelling/category fields, derives numeric compatibility positions from the one ordered sheet, and translates reminder markup for display.

To update: verify a new publisher revision, replace all three assets together, update revision/date metadata, review the field audit and six literal golden procedures against official references, then run the complete tests/build/security suites. Never regenerate golden expectations from the function under test. A pinned source is verified at a date, not an automatic promise of future currency.

For deliberately customized definitions, import character objects (classified homebrew), not edited records claiming canonical provenance. Unverified legacy definitions remain playable with manual-reference warnings; no game migration is performed.
