import { act, render, waitFor } from "@testing-library/react";
import { App } from "@/app/App";

/** Renders the whole app and waits for its route's lazily loaded screen (F-13). */
export async function renderApp() {
  const result = render(<App />);
  await act(async () => { await import("@/app/StorytellerApp"); });
  await waitFor(() => { if (!result.container.firstChild) throw new Error("The app has not rendered its screen yet."); });
  return result;
}
