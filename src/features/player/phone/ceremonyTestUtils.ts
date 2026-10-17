import { fireEvent, screen } from "@testing-library/react";

/** Walks the pre-game ceremony (circle -> token -> team) into the game shell. */
export async function receiveCharacter() {
  fireEvent.click(await screen.findByRole("button", { name: "Receive your character" }));
}

export function turnToken() {
  fireEvent.click(screen.getByRole("button", { name: "Turn your token over" }));
}

export async function enterTown() {
  await receiveCharacter();
  turnToken();
  fireEvent.click(screen.getByRole("button", { name: /^(Enter the town|Meet your team)$/ }));
  if (screen.queryByRole("heading", { name: "Sworn in darkness" })) {
    fireEvent.click(screen.getByRole("button", { name: "Enter the town" }));
  }
}
