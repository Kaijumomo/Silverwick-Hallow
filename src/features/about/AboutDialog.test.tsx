import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { VersionLink } from "./VersionLink";
import { BUILD_INFO, describeBuild, shortVersion } from "@/config/buildInfo";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("version link and About dialog", () => {
  it("shows only the short version, and opens About with the build details on tap", () => {
    render(<VersionLink />);
    const link = screen.getByRole("button", { name: shortVersion() });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(link);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(BUILD_INFO.version);
    expect(dialog).toHaveTextContent(BUILD_INFO.commit);
    expect(dialog).toHaveTextContent(BUILD_INFO.channel);
  });
  it("copies the full build string", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<VersionLink />);
    fireEvent.click(screen.getByRole("button", { name: shortVersion() }));
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(describeBuild());
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });
  it("reports a failed copy instead of pretending it worked", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("no")) }, configurable: true });
    render(<VersionLink />);
    fireEvent.click(screen.getByRole("button", { name: shortVersion() }));
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByText(/Could not copy/)).toBeInTheDocument();
  });
});
