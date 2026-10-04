import { useState } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import {
  PIT_HAG_ARBITRARY_DEATHS,
  TOYMAKER_DEMON_SKIP_OCCURRED,
  gameRuleFactActive,
  gameRuleFactDefinition,
  toymakerSkipStatus,
  type GameRuleFactIntent,
} from "@/stores/gameRuleFacts";
import { momentLabel } from "@/stores/lifeEvents";
import type { StorytellerLobbyRecord } from "@/stores/types";

/**
 * Phase 10G: the global, Storyteller-private Game Rule Fact surface (PHASE10G
 * Section 15.3) -- game-level bookkeeping lives here, never on a participant
 * token. It states, when relevant:
 *  - "Arbitrary deaths tonight" (the Pit-Hag fact) with its exact expiry;
 *  - the DERIVED Toymaker requirement: skip still required / satisfied;
 *  - any unregistered stored fact (shown as carrying no effect);
 * and offers the deliberate controls: record the Demon's skip, record
 * arbitrary deaths for a manually resolved Pit-Hag (Night only), and remove a
 * fact as a correction. Every control goes through resolveGameRuleFacts (the
 * Rule Fact seam) -- never a Reminder, Night progress or a Demon row.
 *
 * The caller never renders it under Privacy Mode (DOM absence). `readOnly`
 * (an ended game) shows the final state with no control.
 */
export function RuleFactStrip({ game, readOnly = false }: { game: StorytellerLobbyRecord; readOnly?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const toymaker = toymakerSkipStatus(game);
  const arbitrary = gameRuleFactActive(game, PIT_HAG_ARBITRARY_DEATHS)
    ? game.gameRuleFacts.find((fact) => fact.type === PIT_HAG_ARBITRARY_DEATHS) : undefined;
  const toymakerFact = game.gameRuleFacts.find((fact) => fact.type === TOYMAKER_DEMON_SKIP_OCCURRED);
  const unregistered = game.gameRuleFacts.filter((fact) => !gameRuleFactDefinition(fact.type));
  const canRecordArbitrary = !readOnly && game.phase === "night" && !arbitrary;
  if (!arbitrary && toymaker === "inactive" && !toymakerFact && !unregistered.length && !canRecordArbitrary) return null;

  const run = (intents: GameRuleFactIntent[], correction = false) => {
    const result = useStorytellerStore.getState().resolveGameRuleFacts({ intents, ...(correction ? { correction: true } : {}) });
    setError(result.ok ? null : result.message);
  };
  const remove = (type: string, label: string) => !readOnly && (
    <button className="btn btn-sm" onClick={() => run([{ kind: "remove", type }], true)} aria-label={`Remove ${label} (correction)`}>Remove…</button>
  );

  return (
    <div className="fabled-strip rule-fact-strip" role="region" aria-label="Game rule facts">
      <span className="fabled-strip-label">Game rule facts</span>
      {arbitrary && (
        <span className="rule-fact-item" data-rule-fact={PIT_HAG_ARBITRARY_DEATHS}>
          Arbitrary deaths are active tonight{arbitrary.expiresAt ? ` (until ${momentLabel(arbitrary.expiresAt)})` : ""}
          {remove(PIT_HAG_ARBITRARY_DEATHS, "arbitrary deaths")}
        </span>
      )}
      {toymaker === "required" && (
        <span className="rule-fact-item" data-rule-fact="toymakerRequired">
          Toymaker skip is still required
          {!readOnly && <button className="btn btn-sm" onClick={() => run([{ kind: "apply", type: TOYMAKER_DEMON_SKIP_OCCURRED }])}>Record Demon skip</button>}
        </span>
      )}
      {toymaker === "satisfied" && (
        <span className="rule-fact-item" data-rule-fact="toymakerSatisfied">
          Toymaker skip has been satisfied
          {remove(TOYMAKER_DEMON_SKIP_OCCURRED, "the recorded Toymaker skip")}
        </span>
      )}
      {toymaker === "inactive" && toymakerFact && (
        <span className="rule-fact-item" data-rule-fact={TOYMAKER_DEMON_SKIP_OCCURRED}>
          Demon skip recorded (no Toymaker in play)
          {remove(TOYMAKER_DEMON_SKIP_OCCURRED, "the recorded Demon skip")}
        </span>
      )}
      {unregistered.map((fact) => (
        <span key={fact.type} className="rule-fact-item" data-rule-fact={fact.type}>
          Unrecognized rule fact "{fact.type}" (no effect)
          {remove(fact.type, `rule fact ${fact.type}`)}
        </span>
      ))}
      {canRecordArbitrary && (
        <details className="rule-fact-more">
          <summary>More…</summary>
          <button className="btn btn-sm" onClick={() => run([{ kind: "apply", type: PIT_HAG_ARBITRARY_DEATHS }])}>
            Record arbitrary deaths tonight
          </button>
          <span className="behavior-help"> For a Pit-Hag Demon resolved manually. Expires when Day begins.</span>
        </details>
      )}
      {error && <span className="behavior-help" role="alert">{error}</span>}
    </div>
  );
}
