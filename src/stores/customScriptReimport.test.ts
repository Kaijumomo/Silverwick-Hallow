// @vitest-environment node
import { describe, expect, it } from "vitest";
import { useStorytellerStore } from "./storytellerStore";

describe("re-importing a custom script", () => {
  it("replaces the saved copy only when asked, and refuses a silent duplicate", () => {
    const script = { id: "reimport-demo", name: "Demo", characters: [] };
    const state = () => useStorytellerStore.getState();
    expect(state().addCustomScript(script).ok).toBe(true);
    expect(state().addCustomScript(script).ok).toBe(false);
    expect(state().addCustomScript({ ...script, name: "Demo 2" }, { replace: true }).ok).toBe(true);
    expect(state().customScripts["reimport-demo"]?.name).toBe("Demo 2");
  });
});
