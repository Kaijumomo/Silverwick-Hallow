import { createElement as E, type CSSProperties, type ReactNode } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { currentVotingState } from "@/stores/voting";
import { useVotingInteraction } from "@/features/voting/VotingWorkspace";
import { useDayUi } from "./dayUi";

/**
 * What the V2 nomination card has no slot for, drawn inside the same card in the same button language:
 * the Virgin / exile / execution follow-ups, the engine's refusal text, its "confirm" step, the
 * vote-correction list and the "···" options. Controls only -- every action is a Voting intent.
 */
export type ExtraAction = { label: string; onClick: () => void; tone?: "secondary" | "quiet" };

const BUTTON: CSSProperties = { minHeight: 44, padding: "0 16px", borderRadius: 12, border: "1px solid rgba(176,186,204,.25)", background: "transparent", color: "#ddd6c8", fontFamily: "inherit", fontSize: 14, cursor: "pointer" };
const QUIET: CSSProperties = { minHeight: 36, padding: "0 10px", border: "none", background: "transparent", color: "rgba(222,216,204,.6)", fontFamily: "inherit", fontSize: 13, cursor: "pointer" };
const ROW: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 };
const NOTE: CSSProperties = { margin: 0, fontSize: 13, color: "#f4a595" };
const WEIGHTS = [-3, -1, 0, 1, 2, 3] as const;

function Row({ children }: { children: ReactNode }) {
  return <div style={ROW}>{children}</div>;
}

export function NominationExtras({ actions, contextNote }: { actions: ExtraAction[]; contextNote: string | null }) {
  const ui = useVotingInteraction();
  const game = useStorytellerStore((s) => s.game);
  const more = useDayUi((s) => s.more);
  const setMore = useDayUi((s) => s.setMore);
  if (!ui?.open || !game) return null;
  const { round, voter } = ui;
  const nominationSurface = ui.surface === "nomination";
  const voting = round?.status === "voting" && !round.virginPending;
  const exile = round?.mode === "exile";
  const state = currentVotingState(game);
  // The "···" options exist once there is something to correct or abandon; they take no layout space until opened.
  const optionsOn = nominationSurface && (state.rounds.length > 0 || !!round);
  const flow = !!contextNote || !!ui.error || !!ui.confirmation || actions.length > 0 || ui.surface === "history" || (optionsOn && more);

  return (
    <>
      {optionsOn && (
        <button aria-label="Voting corrections and options" aria-expanded={more} onClick={() => setMore(!more)}
          style={{ ...QUIET, position: "absolute", top: 12, right: 150, minHeight: 28, padding: "0 8px", letterSpacing: ".1em" }}>···</button>
      )}
      {flow && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {contextNote && <p style={NOTE}>{contextNote}</p>}
          {ui.error && <p role="alert" style={NOTE}>{ui.error}</p>}
          {ui.confirmation && <button style={BUTTON} onClick={ui.confirmation.accept}>{ui.confirmation.message} Confirm</button>}
          {actions.length > 0 && (
            <Row>{actions.map((a) => <button key={a.label} style={a.tone === "quiet" ? QUIET : BUTTON} onClick={a.onClick}>{a.label}</button>)}</Row>
          )}
          {ui.surface === "history" && <Corrections />}
          {optionsOn && more && (
            <Row>
              <button style={QUIET} onClick={() => { setMore(false); ui.show("history"); }}>Correct votes</button>
              {voting && <button style={QUIET} onClick={() => { if (ui.run({ kind: "abandon", roundId: round!.id })) { setMore(false); ui.close(); } }}>Abandon · keep votes spent</button>}
              {voting && !exile && voter && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color: "rgba(222,216,204,.55)" }}>Count this Yes as</span>
                  {WEIGHTS.map((n) => (
                    <button key={n} aria-label={`Record ${n} votes from ${voter.nameAtTime}`} style={{ ...BUTTON, minHeight: 36, padding: "0 12px" }}
                      onClick={() => ui.run({ kind: "respond", roundId: round!.id, voter, choice: "yes", weightOverride: n })}>{n}</button>
                  ))}
                </div>
              )}
            </Row>
          )}
        </div>
      )}
    </>
  );
}

/** The day's rounds, each voter's answer correctable in place. Same intents as the original corrections list. */
function Corrections() {
  const ui = useVotingInteraction()!;
  const game = useStorytellerStore((s) => s.game)!;
  const rounds = currentVotingState(game).rounds;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 260, overflowY: "auto" }}>
      {!rounds.length && <p style={{ margin: 0, fontSize: 13, color: "rgba(222,216,204,.6)" }}>No nominations recorded today.</p>}
      {rounds.map((round, i) => (
        <details key={round.id}>
          <summary style={{ cursor: "pointer", fontSize: 14, color: "#ece6da" }}>{i + 1}. {round.nominator.nameAtTime} → {round.nominee.nameAtTime} · {round.tally}</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 6 }}>
            {round.responses.map((r) => (
              <div key={r.voter.participantId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 13 }}>
                <span>{r.voter.nameAtTime}</span>
                {r.choice === "skipped" ? <small style={{ color: "rgba(222,216,204,.5)" }}>Not eligible / not recorded</small> : (
                  <div style={ROW}>
                    {(["yes", "no"] as const).map((choice) => (
                      <button key={choice} aria-label={`${choice === "yes" ? "Yes" : "No"} from ${r.voter.nameAtTime}`} aria-pressed={r.choice === choice} disabled={r.choice === choice}
                        style={{ ...QUIET, border: `1px solid ${r.choice === choice ? "#c0392e" : "rgba(176,186,204,.2)"}`, borderRadius: 8, minHeight: 32, color: r.choice === choice ? "#ffb4a6" : "rgba(222,216,204,.7)" }}
                        onClick={() => ui.run({ kind: "correctResponse", roundId: round.id, voter: r.voter, choice })}>{choice === "yes" ? "Yes" : "No"}</button>
                    ))}
                    {round.mode === "nomination" && r.choice === "yes" && WEIGHTS.map((weight) => (
                      <button key={weight} aria-label={`Count ${r.voter.nameAtTime} as ${weight} votes`} disabled={r.weight === weight}
                        style={{ ...QUIET, minHeight: 28, padding: "0 6px", opacity: r.weight === weight ? 0.4 : 1 }}
                        onClick={() => ui.run({ kind: "correctResponse", roundId: round.id, voter: r.voter, choice: "yes", weightOverride: weight })}>{weight}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </details>
      ))}
      <button style={{ ...QUIET, alignSelf: "flex-start" }} onClick={() => ui.show()}>Return to nominations</button>
    </div>
  );
}

export const nominationExtras = (actions: ExtraAction[], contextNote: string | null) => E(NominationExtras, { actions, contextNote });
