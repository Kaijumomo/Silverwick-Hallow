import { useState } from "react";
import { shortVersion } from "@/config/buildInfo";
import { AboutDialog } from "./AboutDialog";

/**
 * The quiet version text in the Home footer links row (tablet and phone). Tapping it opens the About dialog. Shown only on
 * the two Home screens; nothing about it appears during a game.
 */
export function VersionLink({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`about-version-link${className ? ` ${className}` : ""}`}
        onClick={() => setOpen(true)} aria-haspopup="dialog" title="About this version">
        {shortVersion()}
      </button>
      {open && <AboutDialog onClose={() => setOpen(false)} />}
    </>
  );
}
