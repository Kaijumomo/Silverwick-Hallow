import { Fragment, isValidElement, type CSSProperties, type ReactNode } from "react";

// Helpers used by the view generated from the Claude Design handoff template (scripts/design-import).

const parsed = new Map<string, CSSProperties>();

const camel = (prop: string) => prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** Parse an inline CSS declaration string (as written in the design template) into a React style object. */
export function css(value: string | CSSProperties | null | undefined): CSSProperties | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") return value;
  const hit = parsed.get(value);
  if (hit) return hit;
  const style: Record<string, string> = {};
  for (const decl of value.split(/;(?![^(]*\))/)) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    if (!prop) continue;
    const name = prop.startsWith("--") ? prop : camel(prop.replace(/^-(webkit|moz|ms)-/, (_, v: string) => `${v}-`)).replace(/^(webkit|moz|ms)/, (m) => m[0]!.toUpperCase() + m.slice(1));
    style[name] = decl.slice(i + 1).trim();
  }
  if (parsed.size > 4000) parsed.clear();
  parsed.set(value, style);
  return style;
}

/**
 * Text interpolation. Elements and arrays pass through; strings and numbers are wrapped in a span
 * exactly as the design runtime does, so flex layouts that depend on the extra box match the design.
 */
export function T(value: unknown): ReactNode {
  if (value === undefined || value === null || typeof value === "boolean") return null;
  if (isValidElement(value) || Array.isArray(value)) return <Fragment>{value as ReactNode}</Fragment>;
  return <span>{String(value)}</span>;
}
