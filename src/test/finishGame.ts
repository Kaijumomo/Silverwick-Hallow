import { act, fireEvent, screen } from "@testing-library/react";

/**
 * Phase 10H: "Finish game" now opens the Storyteller's result declaration
 * (Good / Evil / End Without Result -- contract §14). This drives the REAL
 * dialog: press Finish game, choose, confirm. The default intent is End
 * Without Result -- exactly what the former confirm-only Finish produced
 * (Slice 1) -- so pre-10H tests keep their semantics. With `review` (the
 * default) the post-game summary is then dismissed into the read-only final
 * Grimoire review those tests assert.
 */
export async function finishGame({ choice = "noResult", review = true }: { choice?: "good" | "evil" | "noResult"; review?: boolean } = {}) {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Finish game" })); });
  if (choice === "noResult") fireEvent.click(screen.getByRole("button", { name: "End without a result…" }));
  else fireEvent.click(screen.getByRole("button", { name: choice === "good" ? /^Good wins/ : /^Evil wins/ }));
  const confirmLabel = choice === "noResult" ? "End Without Result" : choice === "good" ? "Declare Good Victory" : "Declare Evil Victory";
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: new RegExp(`${confirmLabel}$`) })); });
  if (review) {
    const toReview = screen.queryByRole("button", { name: "Review the final Grimoire" });
    if (toReview) fireEvent.click(toReview);
  }
}
