import { act, fireEvent, screen } from "@testing-library/react";

/** Drives the real End confirmation and, by default, returns to the final
 * Grimoire. No-result preserves the semantic intent of earlier lifecycle tests. */
export async function finishGame({ choice = "noResult", review = true }: { choice?: "good" | "evil" | "noResult"; review?: boolean } = {}) {
  fireEvent.click(screen.getByRole("button", { name: "End game" }));
  if (choice === "noResult") fireEvent.click(screen.getByText("Other outcome"));
  const confirmLabel = choice === "noResult" ? "End without a result" : choice === "good" ? "Good wins" : "Evil wins";
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: confirmLabel })); });
  if (review) {
    const toReview = screen.queryByRole("button", { name: "Review the Grimoire" });
    if (toReview) fireEvent.click(toReview);
  }
}
