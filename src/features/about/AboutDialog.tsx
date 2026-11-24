import { useState } from "react";
import { Modal } from "@/components/Modal";
import { BUILD_INFO, describeBuild, formatBuiltAt } from "@/config/buildInfo";

/** Build details for troubleshooting: version, commit, build time and channel, with a Copy button. */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(describeBuild());
      setCopied("yes");
    } catch {
      setCopied("no");
    }
  };
  const rows: [string, string][] = [
    ["Version", BUILD_INFO.version],
    ["Commit", BUILD_INFO.commit],
    ["Built", formatBuiltAt(BUILD_INFO.builtAt)],
    ["Channel", BUILD_INFO.channel],
  ];
  return (
    <Modal title="About Silverwick Hollow" onClose={onClose} className="about-dialog">
      <div className="dialog-body">
        <dl className="about-rows">
          {rows.map(([k, v]) => (
            <div key={k} className="about-row">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="about-help">Quote these when reporting a problem, so we know exactly which build you were running.</p>
        <div className="dialog-row">
          <button className="about-copy" onClick={copy}>Copy</button>
          {copied === "yes" && <span className="about-status" role="status">Copied</span>}
          {copied === "no" && <span className="about-status" role="status">Could not copy. Select the text above instead.</span>}
        </div>
      </div>
    </Modal>
  );
}
