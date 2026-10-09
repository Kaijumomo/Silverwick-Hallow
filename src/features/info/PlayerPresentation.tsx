import { useId, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useModalBehavior } from "../../components/Modal";
import { GrimoireIcon } from "@/components/GrimoireIcon";
import "./presentation.css";

export type PresentationCharacter = {
  id: string;
  name: string;
  type: string;
  ability?: string;
  icon: string;
};

/** Deliberately excludes game state, ownership badges and delivery operations. */
export type PresentationPayload =
  | { kind: "character"; heading: string; character: PresentationCharacter }
  | { kind: "message"; heading: string; tone?: "good" | "evil"; symbol: "vote" | "nominate" | "good" | "evil" }
  | { kind: "setup"; groups: Array<{ heading: string; names?: string[]; characters?: PresentationCharacter[] }> };

function Ornament() {
  return <div className="player-presentation-ornament" aria-hidden="true"><i /><span>◇ ◆ ◇</span><i /></div>;
}

function CharacterArt({ character }: { character: PresentationCharacter }) {
  return <div className="player-presentation-disc"><img src={character.icon} alt="" draggable={false} /></div>;
}

export function PlayerPresentation({ payload, onClose, returnFocusRef }: { payload: PresentationPayload; onClose: () => void; returnFocusRef?: RefObject<HTMLElement> }) {
  const titleId = useId();
  const layerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnRef = useRef<HTMLButtonElement>(null);
  useModalBehavior(dialogRef, layerRef, onClose, returnRef, returnFocusRef);
  const title = payload.kind === "setup" ? payload.groups.map(group => group.heading).join(". ") : payload.heading;
  const tone = payload.kind === "message" ? payload.tone ?? "neutral" : "neutral";

  return createPortal(<div ref={layerRef} className={`player-presentation-layer player-presentation-tone-${tone} player-presentation-kind-${payload.kind}`}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="player-presentation">
      <h1 id={titleId} className="player-presentation-accessible-title">{title}</h1>
      <div className="player-presentation-corners" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className={`player-presentation-content player-presentation-content-${payload.kind}`}>
        {payload.kind === "character" && <section className="player-presentation-character">
          <div className="player-presentation-character-heading"><h2>{payload.heading}</h2><Ornament /></div>
          <CharacterArt character={payload.character} />
          <div className="player-presentation-character-name"><h3>{payload.character.name}</h3>
          <p className={`player-presentation-type player-presentation-type-${payload.character.type.toLowerCase().replace(/[^a-z]/g, "")}`}><span aria-hidden="true">◆ </span>{payload.character.type}<span aria-hidden="true"> ◆</span></p></div>
          <Ornament />
          {payload.character.ability && <p className="player-presentation-ability">{payload.character.ability}</p>}
        </section>}
        {payload.kind === "message" && <section className="player-presentation-message">
          <div className="player-presentation-disc"><GrimoireIcon name={payload.symbol} size={104} strokeWidth={1.5} /></div>
          <h2>{payload.heading}</h2><Ornament />
        </section>}
        {payload.kind === "setup" && <div className={`player-presentation-groups${payload.groups.length > 1 ? " player-presentation-groups-multiple" : ""}`}>
          {payload.groups.map((group, index) => <section className="player-presentation-group" key={`${group.heading}-${index}`}>
            <h2>{group.heading}</h2><Ornament />
            {!!group.names?.length && <ul className="player-presentation-names">{group.names.map((name, nameIndex) => <li key={nameIndex}>{name}</li>)}</ul>}
            {!!group.characters?.length && <ul className="player-presentation-bluffs">{group.characters.map((character, characterIndex) => <li key={`${character.id}-${characterIndex}`}>
              <CharacterArt character={character} /><h3>{character.name}</h3>
            </li>)}</ul>}
          </section>)}
        </div>}
      </div>
      <footer className="player-presentation-footer"><button ref={returnRef} type="button" onClick={onClose} className="player-presentation-return"><GrimoireIcon name="return" size={16} strokeWidth={1.8} /> Return to Grimoire</button></footer>
    </div>
  </div>, document.body);
}
