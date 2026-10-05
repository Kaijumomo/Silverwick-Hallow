// Phase 10H pre-checkpoint (10H-AC-069): the Public Display seats on the
// Table's oval geometry with collision-free, fixed-row footprints.
import { describe, expect, it } from "vitest";
import { seatShapes, seatShapesFit } from "@/features/grimoire/densityTiers";
import { PUBLIC_DISC_COMFORT, PUBLIC_LABEL_TIERS, publicSeatLayout, publicSeatSpec, publicTextStack, type PublicSeatContent } from "./publicLayout";

/** The measured stage inside a display of `w` x `h` (header, footer, padding). */
const stageOf = (w: number, h: number) => {
  const pad = Math.min(48, Math.max(16, 0.03 * Math.min(w, h)));
  return { width: Math.round(w - 2 * pad), height: Math.round(h - 60 - 34 - 2 * pad) };
};
const plain = (n: number): PublicSeatContent[] => Array.from({ length: n }, () => ({ role: false, traveler: false }));
/** RS-20: fifteen residents and five public Travelers (seats 16-20). */
const rs20 = (): PublicSeatContent[] => Array.from({ length: 20 }, (_, i) => ({ role: i >= 15, traveler: i >= 15 }));

function assertCollisionFree(stage: { width: number; height: number }, seats: PublicSeatContent[]) {
  const layout = publicSeatLayout(stage, seats);
  expect(layout.fits).toBe(true);
  const shapes = seats.map((content, i) => seatShapes(i, seats.length, publicSeatSpec(layout.spec.disc, layout.label, content), layout.table));
  expect(seatShapesFit(stage, shapes)).toBe(true);
  return layout;
}

describe("10H-AC-069: Public Display seats never overprint a neighbour", () => {
  it.each([[1920, 1080], [1440, 900], [1366, 768], [1280, 720], [1024, 768], [768, 1024]])(
    "RS-15 at %ix%i: every disc and text stack is clear, inside the display", (w, h) => {
      const layout = assertCollisionFree(stageOf(w, h), plain(15));
      expect(layout.spec.disc).toBeGreaterThanOrEqual(PUBLIC_DISC_COMFORT - 2);
    });

  it("RS-20 (with five Travelers) at 1920x1080 is clear at full detail", () => {
    expect(assertCollisionFree(stageOf(1920, 1080), rs20()).label.tier).toBe("full");
  });

  it("names get two lines where there is room, one line on smaller displays", () => {
    expect(publicSeatLayout(stageOf(1440, 900), plain(15)).label.nameLines).toBe(2);
    expect(publicSeatLayout(stageOf(1024, 768), plain(15)).label.nameLines).toBe(1);
  });

  it("the oval uses the display's width (wider than the Table's aspect cap) and the disc grows with the display", () => {
    const big = publicSeatLayout(stageOf(1920, 1080), plain(15));
    const small = publicSeatLayout(stageOf(1280, 720), plain(15));
    expect(big.table.rx / big.table.ry).toBeGreaterThan(1.75);
    expect(big.spec.disc).toBeGreaterThan(small.spec.disc);
  });

  it("the Life row is always reserved: a seat's footprint never depends on Life (no reflow on a death or at Night)", () => {
    const label = PUBLIC_LABEL_TIERS[0]!;
    expect(publicTextStack(label, { role: false, traveler: false })).toBe(4 + 40 + 4 + 14);
    expect(publicTextStack(label, { role: true, traveler: true })).toBe(4 + 40 + 4 + 14 + 4 + 14 + 4 + 20);
  });

  it("a table too dense for the display says so instead of claiming a fit", () => {
    expect(publicSeatLayout(stageOf(390, 844), rs20()).fits).toBe(false);
  });
});

describe("10H-AC-069: the compact Public Display density tiers", () => {
  it("tiers shed secondary presentation in order, never the name: pill first, then the Life text line", () => {
    expect(PUBLIC_LABEL_TIERS.map((t) => [t.tier, t.nameLines, t.travelerPill, t.lifeText])).toEqual([
      ["full", 2, true, true], ["full", 1, true, true], ["compact", 1, false, true], ["minimal", 1, false, false],
    ]);
    const [, full1, compact, minimal] = PUBLIC_LABEL_TIERS;
    const traveler = { role: true, traveler: true };
    // Compact: the Traveler's public character stays, as ONE row (no pill).
    expect(publicTextStack(compact!, traveler)).toBe(publicTextStack(full1!, traveler) - (4 + 20));
    // Minimal: the Life text line goes too; the name row remains.
    expect(publicTextStack(minimal!, { role: false, traveler: false })).toBe(4 + 20);
  });

  it.each([[1280, 720], [1024, 768], [768, 1024]])(
    "RS-20 at %ix%i: collision-free in an explicitly compact tier rather than overlapping at full detail", (w, h) => {
      const layout = assertCollisionFree(stageOf(w, h), rs20());
      expect(layout.label.tier).toBe("minimal");
      expect(layout.label.nameLines).toBe(1);
    });

  it("RS-20 at 1440x900 and 1366x768: the compact tier sheds only the Traveler pill and keeps the Life text line", () => {
    for (const [w, h] of [[1440, 900], [1366, 768]] as const) {
      const layout = assertCollisionFree(stageOf(w, h), rs20());
      expect(layout.label.tier).toBe("compact");
      expect(layout.label.lifeText).toBe(true);
    }
  });

  it("every tier's label is wide enough for the longest Life line and Traveler character it may show", () => {
    // Measured in the browser at 11px Source Sans 3, no tracking: "Exiled · vote available" 116px;
    // the longest public Traveler character ("Bone Collector") 75px.
    for (const tier of PUBLIC_LABEL_TIERS) {
      if (tier.lifeText) expect(tier.width).toBeGreaterThanOrEqual(116);
      expect(tier.width).toBeGreaterThanOrEqual(75);
    }
  });

  it("a roomier display never steps down: RS-15 stays full detail wherever full detail fits", () => {
    for (const [w, h] of [[1920, 1080], [1440, 900], [1280, 720], [1024, 768]] as const) {
      expect(publicSeatLayout(stageOf(w, h), plain(15)).label.tier).toBe("full");
    }
  });
});
