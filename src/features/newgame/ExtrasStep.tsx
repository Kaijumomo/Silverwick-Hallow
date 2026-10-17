import type { CSSProperties } from "react";
import type { RoleDef } from "@/stores/types";
import { iconUrlFor } from "@/data/iconUrl";
import { localCharacterArt } from "@/features/home/art";
import { FABLED_CHOICES, LORIC_CHOICES, LORIC_NOTE, TEAM_COLOR, fabledNote } from "./setupFlowModel";

type Props = {
  total: number;
  extras: string[];
  onToggle: (id: string) => void;
  onNext: () => void;
};

const iconOf = (role: RoleDef) => localCharacterArt(role.id) ?? iconUrlFor(role);

function Group({ label, note, color, roles, extras, onToggle }: {
  label: string; note: string; color: string; roles: RoleDef[]; extras: string[]; onToggle: (id: string) => void;
}) {
  return (
    <div className="sf-group" role="group" aria-label={label}>
      <div className="sf-group-head">
        <span className="sf-group-label" style={{ color }}>{label}</span>
        <span className="sf-group-note">{note}</span>
      </div>
      <div className="sf-tokens">
        {roles.map((role) => (
          <button
            key={role.id}
            type="button"
            className="sf-token"
            aria-pressed={extras.includes(role.id)}
            style={{ "--tc": color, "--tc-glow": `${color}66` } as CSSProperties}
            onClick={() => onToggle(role.id)}
          >
            <span className="sf-token-disc">
              <span className="sf-token-icon" aria-hidden="true" style={{ backgroundImage: `url(${iconOf(role)})` }} />
            </span>
            <span className="sf-token-name">{role.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ExtrasStep({ total, extras, onToggle, onNext }: Props) {
  return (
    <section className="sf-main" aria-labelledby="sf-step-title">
      <div className="sf-heading">
        <h1 className="sf-title" id="sf-step-title">Fabled &amp; Loric</h1>
        <span className="sf-sub">Choose any, or none.</span>
      </div>
      <Group label="Fabled" note={fabledNote(total)} color={TEAM_COLOR.fabled} roles={FABLED_CHOICES} extras={extras} onToggle={onToggle} />
      <Group label="Loric" note={LORIC_NOTE} color={TEAM_COLOR.loric} roles={LORIC_CHOICES} extras={extras} onToggle={onToggle} />
      <div className="sf-foot">
        <div className="sf-foot-status" />
        <button type="button" className="sf-cta" onClick={onNext}>
          {extras.length ? "Continue to players ›" : "Skip to players ›"}
        </button>
      </div>
    </section>
  );
}
