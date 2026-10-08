import { iconUrlFor } from "@/data/iconUrl";
import type { RoleDef } from "@/stores/types";
import "@/styles/official-reminder-token.css";

/** A decorative publisher-character disc, never a mutation control. The
 * parent supplies the accessible summary when this is inside a seat button. */
export function OfficialReminderToken({ role, label, count = 1, notation = false, decorative = false, title }: {
  role: RoleDef;
  label: string;
  count?: number;
  notation?: boolean;
  decorative?: boolean;
  title?: string;
}) {
  const text = `${label}${count > 1 ? ` ×${count}` : ""}`;
  return <span className={`official-reminder-token${notation ? " official-reminder-notation" : ""}`}
    data-official-reminder={role.id} data-reminder-kind={notation ? "notation" : "effect"}
    title={title ?? `${role.name}: ${text}${notation ? " (notation only)" : " (effect)"}`}
    aria-hidden={decorative || undefined}>
    <span className="official-reminder-disc"><img src={iconUrlFor(role)} alt="" onError={event => { event.currentTarget.style.visibility = "hidden"; }} />
      {notation && <span className="official-reminder-pen" aria-hidden="true">✎</span>}
    </span>
    <span className="official-reminder-label">{text}</span>
    {notation && !decorative && <span className="sr-only"> (notation only)</span>}
  </span>;
}
