// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_SCRIPTS } from "@/data/scripts";
import { draftBaseScript } from "./draft";
import type { Script } from "@/stores/types";

afterEach(() => vi.restoreAllMocks());
const custom: Script = { id: "mine", name: "Mine", characters: BUILTIN_SCRIPTS["tb"]!.characters };

describe("draftBaseScript", () => {
  it("uses a found built-in or custom script without reporting anything", () => {
    expect(draftBaseScript({ script: "tb", customName: null }, "tb", {})).toEqual({ script: BUILTIN_SCRIPTS["tb"], missing: false });
    expect(draftBaseScript({ script: "custom", customName: "mine" }, "mine", { mine: custom })).toEqual({ script: custom, missing: false });
  });

  it("previews Trouble Brewing quietly while no script has been chosen", () => {
    expect(draftBaseScript({ script: null, customName: null }, null, {})).toEqual({ script: BUILTIN_SCRIPTS["tb"], missing: false });
    expect(draftBaseScript({ script: "custom", customName: null }, null, {})).toMatchObject({ missing: false });
    expect(draftBaseScript(null, null, {})).toMatchObject({ missing: false });
  });

  it("reports a chosen script that cannot be found instead of silently passing as Trouble Brewing", () => {
    expect(draftBaseScript({ script: "custom", customName: "gone" }, null, {})).toEqual({ script: BUILTIN_SCRIPTS["tb"], missing: true });
  });
});
