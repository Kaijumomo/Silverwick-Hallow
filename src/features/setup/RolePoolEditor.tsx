import { iconUrlFor } from "@/data/iconUrl";
import type { Script } from "@/stores/types";
import { BAG_TYPES } from "./setupPolicies";
import { TYPE_LABEL } from "./SetupFindings";

export function RolePoolEditor({ script, pool, onChange }: { script: Script; pool: string[]; onChange: (pool: string[]) => void }) {
  const roles = [...new Map(script.characters.map(r => [r.id, r])).values()];
  return <div className="setup-role-editor">
    {BAG_TYPES.map(type => <section key={type} className="setup-role-group" aria-label={TYPE_LABEL[type]}>
      <h3 className={`setup-eyebrow type-${type}`}>{TYPE_LABEL[type]} <span>{pool.filter(id => roles.find(r => r.id === id)?.type === type).length} selected</span></h3>
      <div className="setup-role-grid">{roles.filter(r => r.type === type).map(r => {
        const count = pool.filter(id => id === r.id).length;
        return <button key={r.id} className={`setup-role-choice${count ? " selected" : ""}`} aria-pressed={count > 0}
          onClick={() => onChange(count ? pool.filter(id => id !== r.id) : [...pool, r.id])}>
          <img src={iconUrlFor(r)} alt="" loading="lazy" /><span>{r.name}{count > 1 && ` ×${count}`}</span>
          {count > 0 && <span className="setup-role-check" aria-hidden="true">✓</span>}
        </button>;
      })}</div>
    </section>)}
    <details><summary>Additional copies</summary>
      {roles.filter(r => pool.filter(id => id === r.id).length > 1).map(r => <div key={r.id} className="setup-copy-row">
        <span>{r.name} ×{pool.filter(id => id === r.id).length}</span>
        <button className="btn btn-sm" aria-label={`Remove one ${r.name}`} onClick={() => {
          const index = pool.lastIndexOf(r.id);
          onChange(pool.filter((_, i) => i !== index));
        }}>Remove one</button>
      </div>)}
      <label>Add another copy<select className="select" aria-label="Add another copy" value="" onChange={e => { if (e.target.value) onChange([...pool, e.target.value]); }}>
        <option value="">Choose a selected character</option>
        {roles.filter(r => pool.includes(r.id)).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select></label>
    </details>
    {pool.filter(id => !roles.some(r => r.id === id && BAG_TYPES.some(t => t === r.type))).map((id, i) =>
      <button className="btn btn-sm" key={`${id}:${i}`} onClick={() => onChange(pool.filter(value => value !== id))}>Remove unavailable role: {id}</button>)}
  </div>;
}
