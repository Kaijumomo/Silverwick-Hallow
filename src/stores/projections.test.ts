import { describe, expect, it } from "vitest";
import { buildRegistry } from "@/data/roleRegistry";
import { makeSTPlayer, tbScript } from "@/test/fixtures";
import { TRAVELERS } from "@/data/travelers";
import {
  projectLobbyToPublic,
  projectLobbyToSelfMap,
  projectToPublic,
  projectToSelf,
} from "./projections";
import type { StorytellerLobbyRecord } from "./types";

const registry = buildRegistry(tbScript);

const PRIVATE_FIELDS = [
  "actualRole",
  "shownRole",
  "shownAlignment",
  "behaviorMode",
  "privateInfo",
  "bluffs",       // must never appear in public/ (lives in self projection only)
  "fakeMinions",  // must never appear in public/ (lives in self projection only)
  "statuses",
  "reminders",
  "stNotes",
  "abilityUsed",
] as const;

describe("projectToSelf — Drunk", () => {
  it("Drunk Chef projects shownRole=chef, shownAlignment=good", () => {
    const drunk = makeSTPlayer({
      id: "p1",
      actualRole: "drunk",
      shownRole: "chef",
      shownAlignment: null,
      behaviorMode: "drunk_fake_role_behavior",
    });
    const self = projectToSelf(drunk, registry);
    expect(self?.shownRole).toBe("chef");
    expect(self?.shownAlignment).toBe("good");
    expect(self?.bluffs).toBeUndefined();
    expect(self?.fakeMinions).toBeUndefined();
    // Critical: actualRole never appears in self projection
    expect(JSON.stringify(self)).not.toContain("drunk");
    expect(JSON.stringify(self)).not.toContain("actualRole");
  });
});

describe("projectToSelf — Lunatic", () => {
  it("Lunatic projects shownRole=imp, shownAlignment=evil, fake bluffs", () => {
    const lunatic = makeSTPlayer({
      id: "p2",
      name: "Bob",
      actualRole: "lunatic",
      shownRole: "imp",
      shownAlignment: null,
      behaviorMode: "fake_demon_behavior",
      privateInfo: {
        bluffs: ["chef", "washerwoman", "saint"],
        fakeMinions: ["p3", "p4"],
      },
    });
    const self = projectToSelf(lunatic, registry);
    expect(self?.shownRole).toBe("imp");
    expect(self?.shownAlignment).toBe("evil");
    expect(self?.bluffs).toEqual(["chef", "washerwoman", "saint"]);
    expect(self?.fakeMinions).toEqual(["p3", "p4"]);
    expect(JSON.stringify(self)).not.toContain("lunatic");
  });
});

describe("projectToSelf — Marionette", () => {
  it("Marionette projects shownRole=townsfolk, shownAlignment=good", () => {
    const marion = makeSTPlayer({
      id: "p3",
      actualRole: "marionette",
      shownRole: "washerwoman",
      shownAlignment: null,
      behaviorMode: "marionette_fake_good_behavior",
    });
    const self = projectToSelf(marion, registry);
    expect(self?.shownRole).toBe("washerwoman");
    expect(self?.shownAlignment).toBe("good");
    expect(JSON.stringify(self)).not.toContain("marionette");
  });
});

describe("projectToSelf — normal", () => {
  it("Normal player projects explicitly configured shownRole", () => {
    const p = makeSTPlayer({ actualRole: "chef", shownRole: "chef" });
    const self = projectToSelf(p, registry);
    expect(self?.shownRole).toBe("chef");
    expect(self?.shownAlignment).toBe("good");
  });

  it("Real Demon's bluffs (real ones) project via privateInfo", () => {
    const imp = makeSTPlayer({
      actualRole: "imp",
      shownRole: "imp",
      privateInfo: { bluffs: ["chef", "washerwoman", "saint"] },
    });
    const self = projectToSelf(imp, registry);
    expect(self?.bluffs).toEqual(["chef", "washerwoman", "saint"]);
    expect(self?.shownRole).toBe("imp");
    expect(self?.shownAlignment).toBe("evil");
  });
});

describe("projectToSelf — explicit shownAlignment override", () => {
  it("respects explicit shownAlignment over derivation", () => {
    const p = makeSTPlayer({
      actualRole: "chef",
      shownRole: "chef",
      shownAlignment: "evil", // weird ST override; trust it
    });
    const self = projectToSelf(p, registry);
    expect(self?.shownAlignment).toBe("evil");
  });
});

describe("projectToSelf — clearing deception", () => {
  it("removing shownRole leaves identity unrevealed", () => {
    const p = makeSTPlayer({
      actualRole: "drunk",
      shownRole: "chef",
      shownAlignment: null,
      behaviorMode: "drunk_fake_role_behavior",
    });
    const cleaned = { ...p, shownRole: null, behaviorMode: "normal" as const };
    const self = projectToSelf(cleaned, registry);
    expect(self).toBeNull();
  });
});

describe("projectToPublic", () => {
  it("strips all role/alignment/private fields", () => {
    const p = makeSTPlayer({
      actualRole: "lunatic",
      shownRole: "imp",
      shownAlignment: null,
      behaviorMode: "fake_demon_behavior",
      privateInfo: { bluffs: ["chef"], fakeMinions: ["p2"] },
      reminders: ["secret"],
      stNotes: "do not leak",
      statuses: { drunk: true },
      abilityUsed: true,
    });
    const pub = projectToPublic(p, true);
    const json = JSON.stringify(pub);
    for (const f of PRIVATE_FIELDS) {
      expect(json).not.toContain(`"${f}"`);
    }
    expect(json).not.toContain("lunatic");
    expect(json).not.toContain("imp");
    expect(json).not.toContain("secret");
    expect(json).not.toContain("do not leak");
    expect(pub.alive).toBe(true);
    expect(pub.online).toBe(true);
    expect(pub.name).toBe("Alice");
  });

  it("includes publicDisplayRole only when set", () => {
    const a = projectToPublic(makeSTPlayer({ publicDisplayRole: null }), false);
    expect(a.publicDisplayRole).toBeUndefined();
    const b = projectToPublic(
      makeSTPlayer({ publicDisplayRole: "saint" }),
      false
    );
    expect(b.publicDisplayRole).toBe("saint");
  });
});

describe("projectToSelf — Demon bluffs privacy", () => {
  it("real Demon's bluffs project into their own self record", () => {
    const demon = makeSTPlayer({
      actualRole: "imp",
      shownRole: "imp",
      privateInfo: { bluffs: ["chef", "saint", "washerwoman"] },
    });
    const self = projectToSelf(demon, registry);
    expect(self?.bluffs).toEqual(["chef", "saint", "washerwoman"]);
  });

  it("Demon's self record never contains a Lunatic's bluffs", () => {
    const demon = makeSTPlayer({
      actualRole: "imp",
      shownRole: "imp",
      privateInfo: { bluffs: ["chef", "saint", "washerwoman"] },
    });
    // Verify that the Lunatic's role ids do not appear in the demon's projection.
    const demonSelf = JSON.stringify(projectToSelf(demon, registry));
    // Lunatic's fake bluffs would be poisoner/baron/scarletwoman.
    expect(demonSelf).not.toContain("poisoner");
    expect(demonSelf).not.toContain("baron");
    expect(demonSelf).not.toContain("scarletwoman");
  });

  it("projectToPublic for a Demon never contains any bluff id", () => {
    const demon = makeSTPlayer({
      actualRole: "imp",
      shownRole: "imp",
      privateInfo: { bluffs: ["chef", "saint", "washerwoman"] },
    });
    const pub = JSON.stringify(projectToPublic(demon, true));
    expect(pub).not.toContain("bluffs");
    expect(pub).not.toContain("chef");
    expect(pub).not.toContain("saint");
    expect(pub).not.toContain("washerwoman");
  });
});

describe("Lobby-level projections", () => {
  function makeLobby(): StorytellerLobbyRecord {
    return {
      code: "ABCD12",
      storytellerUid: "uid-st",
      scriptId: "tb",
      phase: "night",
      day: 1,
      bluffs: ["chef", "washerwoman", "saint"],
      fabled: [],
      lorics: [],
      notes: "ST-only",
      seatOrder: ["p1", "p2", "p3"],
      nightProgress: {},
      rolePool: [],
      plannedPlayerCount: 0,
      pendingPlayers: {},
      players: {
        p1: makeSTPlayer({
          id: "p1",
          actualRole: "imp",
          shownRole: "imp",
          privateInfo: { bluffs: ["chef", "washerwoman", "saint"] },
        }),
        p2: makeSTPlayer({
          id: "p2",
          name: "Bob",
          seat: 1,
          actualRole: "lunatic",
          shownRole: "imp",
          shownAlignment: null,
          behaviorMode: "fake_demon_behavior",
          privateInfo: { bluffs: ["poisoner", "baron", "scarletwoman"] },
        }),
        p3: makeSTPlayer({
          id: "p3",
          name: "Cara",
          seat: 2,
          actualRole: "drunk",
          shownRole: "chef",
          shownAlignment: null,
          behaviorMode: "drunk_fake_role_behavior",
        }),
      },
    };
  }

  it("public lobby never contains role/alignment for any player", () => {
    const lobby = makeLobby();
    const pub = projectLobbyToPublic(lobby, { p1: true, p2: true, p3: false });
    const json = JSON.stringify(pub);
    expect(json).not.toContain("imp");
    expect(json).not.toContain("lunatic");
    expect(json).not.toContain("drunk");
    expect(json).not.toContain("chef");
    expect(json).not.toContain("ST-only");
    expect(json).not.toContain("storytellerUid");
    expect(json).not.toContain("bluffs");
    expect(json).not.toContain("notes");
    for (const f of PRIVATE_FIELDS) {
      expect(json).not.toContain(`"${f}"`);
    }
    expect(pub.players.p1!.online).toBe(true);
    expect(pub.players.p3!.online).toBe(false);
  });

  it("self-map projection: each player only contains their own self record", () => {
    const lobby = makeLobby();
    const selves = projectLobbyToSelfMap(lobby, registry);
    // p1 (Imp) sees real bluffs
    expect(selves.p1!.bluffs).toEqual(["chef", "washerwoman", "saint"]);
    expect(selves.p1!.shownRole).toBe("imp");
    // p2 (Lunatic) sees fake bluffs, never the real demon's bluffs
    expect(selves.p2!.bluffs).toEqual(["poisoner", "baron", "scarletwoman"]);
    expect(selves.p2!.shownRole).toBe("imp");
    expect(selves.p2!.shownAlignment).toBe("evil");
    // p3 (Drunk) sees Chef, no bluffs
    expect(selves.p3!.shownRole).toBe("chef");
    expect(selves.p3!.shownAlignment).toBe("good");
    expect(selves.p3!.bluffs).toBeUndefined();
  });

  it("public lobby fabled array is projected into the public record", () => {
    const lobby = makeLobby();
    lobby.fabled = ["djinn", "doomsayer"];
    const pub = projectLobbyToPublic(lobby, {});
    expect(pub.fabled).toEqual(["djinn", "doomsayer"]);
  });
});

// ---------------------------------------------------------------------------
// E3: Privacy regression matrix — exhaustive behavior-mode sweep
// ---------------------------------------------------------------------------

describe("Privacy regression matrix — all behavior modes", () => {
  // Each entry: [label, behaviorMode, actualRole, shownRole, expectedShown, expectedAlignment]
  type Row = {
    label: string;
    actualRole: string;
    shownRole: string | null;
    shownAlignment: "good" | "evil" | null;
    behaviorMode: "normal" | "drunk_fake_role_behavior" | "fake_demon_behavior" | "marionette_fake_good_behavior" | "poisoned" | "custom";
    expectPublicNoRole: string; // role id that must not appear in public json
    expectSelfRole: string;    // shownRole expected in self
    expectSelfAlign: "good" | "evil";
  };

  const rows: Row[] = [
    {
      label: "normal Townsfolk (Chef)",
      actualRole: "chef",
      shownRole: "chef",
      shownAlignment: null,
      behaviorMode: "normal",
      expectPublicNoRole: "chef",
      expectSelfRole: "chef",
      expectSelfAlign: "good",
    },
    {
      label: "Drunk (shown Chef)",
      actualRole: "drunk",
      shownRole: "chef",
      shownAlignment: null,
      behaviorMode: "drunk_fake_role_behavior",
      expectPublicNoRole: "drunk",
      expectSelfRole: "chef",
      expectSelfAlign: "good",
    },
    {
      label: "Lunatic (shown Imp)",
      actualRole: "lunatic",
      shownRole: "imp",
      shownAlignment: null,
      behaviorMode: "fake_demon_behavior",
      expectPublicNoRole: "lunatic",
      expectSelfRole: "imp",
      expectSelfAlign: "evil",
    },
    {
      label: "Marionette (shown Washerwoman)",
      actualRole: "marionette",
      shownRole: "washerwoman",
      shownAlignment: null,
      behaviorMode: "marionette_fake_good_behavior",
      expectPublicNoRole: "marionette",
      expectSelfRole: "washerwoman",
      expectSelfAlign: "good",
    },
    {
      label: "Poisoned (still shown real role)",
      actualRole: "chef",
      shownRole: "chef",
      shownAlignment: null,
      behaviorMode: "poisoned",
      expectPublicNoRole: "chef",
      expectSelfRole: "chef",
      expectSelfAlign: "good",
    },
    {
      label: "Demon (Imp) — ST normal",
      actualRole: "imp",
      shownRole: "imp",
      shownAlignment: null,
      behaviorMode: "normal",
      expectPublicNoRole: "imp",
      expectSelfRole: "imp",
      expectSelfAlign: "evil",
    },
  ];

  for (const row of rows) {
    it(`self projection: ${row.label}`, () => {
      const p = makeSTPlayer({
        actualRole: row.actualRole,
        shownRole: row.shownRole,
        shownAlignment: row.shownAlignment,
        behaviorMode: row.behaviorMode,
      });
      const self = projectToSelf(p, registry);
      expect(self?.shownRole).toBe(row.expectSelfRole);
      expect(self?.shownAlignment).toBe(row.expectSelfAlign);
      // actualRole must never appear in self projection
      expect(JSON.stringify(self)).not.toContain(`"actualRole"`);
      expect(JSON.stringify(self)).not.toContain(`"behaviorMode"`);
    });

    it(`public projection: ${row.label} — actual role never leaks`, () => {
      const p = makeSTPlayer({
        actualRole: row.actualRole,
        shownRole: row.shownRole,
        shownAlignment: row.shownAlignment,
        behaviorMode: row.behaviorMode,
        stNotes: "secret-st-note",
        reminders: ["a-reminder"],
        statuses: { drunk: true },
        privateInfo: { bluffs: ["saint"] },
      });
      const pub = JSON.stringify(projectToPublic(p, false));
      // Role data must not appear.
      expect(pub).not.toContain(row.expectPublicNoRole);
      // Private ST fields must never appear.
      for (const f of PRIVATE_FIELDS) {
        expect(pub, `public contained "${f}" for ${row.label}`).not.toContain(`"${f}"`);
      }
      expect(pub).not.toContain("secret-st-note");
      expect(pub).not.toContain("a-reminder");
    });
  }

  it("evil traveler (explicit shownAlignment=evil) projects correctly", () => {
    const p = makeSTPlayer({
      actualRole: "thief",
      shownRole: "thief",
      shownAlignment: "evil", // ST has marked this traveler as evil
      behaviorMode: "normal",
      isTraveler: true,
    });
    const self = projectToSelf(p, registry);
    expect(self?.shownRole).toBe("thief");
    expect(self?.shownAlignment).toBe("evil");
    expect(JSON.stringify(self)).not.toContain("actualRole");
    const pub = JSON.stringify(projectToPublic(p, true));
    for (const f of PRIVATE_FIELDS) {
      expect(pub, `public contained "${f}" for evil traveler`).not.toContain(`"${f}"`);
    }
    expect(pub).not.toContain("thief");
  });

  it("Demon with bluffs: public never contains any bluff role id", () => {
    const imp = makeSTPlayer({
      actualRole: "imp",
      shownRole: "imp",
      behaviorMode: "normal",
      privateInfo: { bluffs: ["chef", "saint", "washerwoman"] },
    });
    const pub = JSON.stringify(projectToPublic(imp, true));
    expect(pub).not.toContain("bluffs");
    expect(pub).not.toContain("chef");
    expect(pub).not.toContain("saint");
    expect(pub).not.toContain("washerwoman");
  });
});

describe("buildRegistry — traveler coverage", () => {
  it("all TRAVELERS IDs are resolvable without throwing", () => {
    const reg = buildRegistry(tbScript);
    for (const t of TRAVELERS) {
      expect(() => reg.alignmentOf(t.id), `traveler "${t.id}" threw`).not.toThrow();
    }
  });

  it("alignmentOf returns 'good' for a traveler (type-based derivation)", () => {
    const reg = buildRegistry(tbScript);
    expect(reg.alignmentOf("thief")).toBe("good");
    expect(reg.alignmentOf("bureaucrat")).toBe("good");
  });

  it("projectToSelf does not throw for a traveler-assigned player", () => {
    const reg = buildRegistry(tbScript);
    const p = makeSTPlayer({
      actualRole: "thief",
      shownRole: "thief",
      isTraveler: true,
    });
    expect(() => projectToSelf(p, reg)).not.toThrow();
    const self = projectToSelf(p, reg);
    expect(self?.shownRole).toBe("thief");
    expect(self?.shownAlignment).toBe("good");
  });

  it("projectToPublic for a traveler does not contain actualRole or private data", () => {
    const p = makeSTPlayer({
      actualRole: "thief",
      shownRole: "thief",
      isTraveler: true,
      stNotes: "traveler note",
      statuses: { protected: true },
    });
    const pub = JSON.stringify(projectToPublic(p, true));
    expect(pub).not.toContain("actualRole");
    expect(pub).not.toContain("stNotes");
    expect(pub).not.toContain("statuses");
    expect(pub).not.toContain("traveler note");
  });
});
