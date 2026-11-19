import { useEffect } from "react";
import { useTargetPicker } from "@/features/abilities/abilityUi";
import { ChoicePrompt, ChoiceSlot } from "../choice/ChoiceParts";

export type KlutzCardVm = {
  on: boolean; owner: string; cx: number; cy: number; title: string; meta: string; prompt: string;
  filled: boolean; slotLabel: string; slotSub: string; slotImg?: string; eligible: ReadonlySet<string>;
  pick: (playerId: string) => void; confirm: () => void; dismiss: () => void;
};

/**
 * PO design direction 2026-11-19: the Klutz's choice in its own card at the ring's centre, in the Barber card's language. The board
 * stays live: each tap fills (or replaces) the one slot; nothing is recorded until Confirm. Dismiss closes the card. Storyteller-only:
 * the card is built only outside Privacy Mode (buildKlutzCard).
 */
export function KlutzCard({ kl }: { kl: KlutzCardVm }) {
  const { owner, eligible, pick, filled } = kl;
  const eligibleKey = [...eligible].sort().join(",");
  useEffect(() => {
    let active = true;
    useTargetPicker.getState().start("the Klutz's choice", (target) => { if (active) pick(target.playerId); }, { owner, eligible });
    return () => { active = false; if (useTargetPicker.getState().active?.owner === owner) useTargetPicker.getState().cancel(); };
    // A new pick (or a new game) re-arms the board, so the Storyteller can tap again to change the choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, eligibleKey, kl.slotLabel, filled]);
  return <div role="dialog" aria-label={`${kl.title}'s choice`} className="gv-choice-card" style={{ left: kl.cx, top: kl.cy }}>
    <div className="gv-choice-title">
      <span className="gv-choice-title-name">{kl.title}</span>
      <span className="gv-choice-title-meta">{kl.meta}</span>
    </div>
    <div className="gv-choice">
      <hr className="gv-choice-divider" />
      <ChoicePrompt text={kl.prompt} long />
      <div className="gv-choice-pickrow">
        <ChoiceSlot filled={filled} label={kl.slotLabel} sub={kl.slotSub} img={kl.slotImg} empty="blank" />
        <button className="gv-choice-confirm" type="button" disabled={!filled} onClick={kl.confirm}>Confirm</button>
      </div>
      <button className="gv-choice-link" type="button" onClick={kl.dismiss}>Dismiss</button>
    </div>
  </div>;
}
