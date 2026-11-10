import "@testing-library/jest-dom/vitest";

// jsdom has no 2D canvas and reports every getContext call as an error; answer "no context" quietly instead, as a
// browser without canvas support would (the Grimoire sky then falls back to its page layers).
if (typeof HTMLCanvasElement !== "undefined") HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;

// jsdom has no page scrolling and reports window.scrollTo as an error; the phone shell calls it to keep itself at the top.
if (typeof window !== "undefined") window.scrollTo = (() => {}) as typeof window.scrollTo;
