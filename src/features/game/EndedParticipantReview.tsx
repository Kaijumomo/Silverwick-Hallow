import { Modal } from "@/components/Modal";
import { usePrivateDialog } from "@/features/life/usePrivateDialog";
import { LifeStateText } from "@/features/life/LifeMarks";
import { lifeStatusOf } from "@/stores/lifeState";
import { effectDefinitionOf } from "@/stores/effectRegistry";
import { groupText, reminderTokenGroups } from "@/features/reminders/reminderPresentation";
import type { RoleRegistry } from "@/data/roleRegistry";
import type { StorytellerLobbyRecord, STPlayerRecord } from "@/stores/types";

/**
 * Phase 10G (PHASE10G Section 18): one participant's FINAL state in an ended
 * game, read-only. It replaces the Player Drawer there, so no ordinary
 * game-mutating control is mounted at all. Storyteller-private: closes itself
 * under Privacy Mode and never reappears on its own.
 */
export function EndedParticipantReview({ player, game, registry, onClose }: {
  player: STPlayerRecord; game: Pick<StorytellerLobbyRecord, "phase" | "day">; registry: RoleRegistry; onClose: () => void;
}) {
  const suppressed = usePrivateDialog(onClose);
  if (suppressed) return null;
  const roleName = (id: string | null | undefined) => (id ? registry.get(id)?.name ?? id : "none");
  const life = lifeStatusOf(player);
  const reminders = reminderTokenGroups(player, game);
  const row = (label: string, value: React.ReactNode) => (
    <div className="drawer-row"><span className="label">{label}</span><span>{value}</span></div>
  );
  return (
    <Modal title={`${player.name || `Seat ${player.seat + 1}`} — final state`} onClose={onClose} className="ended-participant-review">
      <div className="dialog-body">
        {row("Seat", player.seat + 1)}
        {row("Character", roleName(player.actualRole))}
        {player.shownRole !== player.actualRole && row("Shown as", roleName(player.shownRole))}
        {row("Alignment", player.actualAlignment ?? "unresolved")}
        {row("Life", <LifeStateText state={life.state} />)}
        {row("Ability", player.abilityUsed ? "used" : "not used")}
        {row("Effects", player.effects.length ? player.effects.map((e) => `${effectDefinitionOf(e.type).label}${e.state === "suppressed" ? " (suppressed)" : ""}`).join(", ") : "none")}
        {row("Reminders", reminders.length ? reminders.map(groupText).join(", ") : "none")}
        {player.stNotes.trim() && row("Notes", <span className="ended-notes">{player.stNotes}</span>)}
      </div>
    </Modal>
  );
}
