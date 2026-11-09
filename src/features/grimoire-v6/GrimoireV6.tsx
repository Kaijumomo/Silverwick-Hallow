import "./grimoire-v6.css";
import "./grimoire-v6-pseudo.css";
import { GrimoireV6View } from "./GrimoireV6View";

export function GrimoireV6({ vm }: { vm: Record<string, unknown> }) {
  return <div className="gv-root" style={{ position: "absolute", inset: 0 }}><GrimoireV6View vm={vm} /></div>;
}
