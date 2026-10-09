import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/trial", () => ({ isTabletTrial: true, TABLET_TRIAL_OFFLINE_MESSAGE: "Local tablet trial" }));
import { useStorytellerStore } from "@/stores/storytellerStore";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import { seedTabletTrial } from "./seed";

beforeEach(() => { localStorage.clear(); useStorytellerStore.setState({ game: null, lobby: null, sync: null, undoStack: [], customScripts: {} }); });
describe("playable tablet fixtures", () => {
  it.each([15, 20] as const)("builds and resumes a valid %s-player Day 2 through commands", async size => {
    localStorage.setItem("new-blood-st", "preserve-the-real-save");
    seedTabletTrial(size);
    const initial = useStorytellerStore.getState();
    const game = initial.game!;
    expect(StorytellerGamePersistedSchema.safeParse(game).success).toBe(true);
    expect(game).toMatchObject({ phase: "day", day: 2 });
    expect(game.seatOrder).toHaveLength(size);
    expect(Object.values(game.players).filter(player => player.isTraveler)).toHaveLength(size === 15 ? 1 : 5);
    const players = game.seatOrder.map(id => game.players[id]!);
    expect(players[0]).toMatchObject({ name: "Alice", actualRole: "virgin", actualAlignment: "good", abilityUsed: false });
    expect(players[1]).toMatchObject({ actualRole: "pacifist", actualAlignment: "good" });
    expect(players[2]).toMatchObject({ actualRole: "chef", actualAlignment: "good" });
    expect(players[13]).toMatchObject({ actualRole: "imp", actualAlignment: "evil" });
    expect(players[7]).toMatchObject({ alive: false, ghostVote: true });
    expect(players[8]).toMatchObject({ alive: false, ghostVote: false });
    expect(game.voting?.modifiers ?? []).toHaveLength(0);
    expect(players[2]!.reminders).toContainEqual(expect.objectContaining({ label: "3 Votes", sourceCharacter: "bureaucrat" }));
    expect(initial.lobby).toBeNull();
    expect(initial.undoStack).toEqual([]);
    expect(localStorage.getItem("new-blood-st")).toBe("preserve-the-real-save");
    const saved = localStorage.getItem("silverwick-voting-tablet-trial")!;
    expect(saved).toBeTruthy();
    useStorytellerStore.setState({ game: null });
    localStorage.setItem("silverwick-voting-tablet-trial", saved);
    await useStorytellerStore.persist.rehydrate();
    expect(useStorytellerStore.getState().game).toEqual(game);
  });
});
