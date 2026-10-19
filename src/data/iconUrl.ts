// Resolves a RoleDef to a token image URL using the official BOTC CDN.
// Source: https://release.botc.app/resources/characters/
//
// Path conventions (mirrored from the official app):
//   fabled:       fabled/{id}.webp
//   loric:        loric/{id}.webp
//   traveler:     {edition}/{id}_g.webp
//   experimental: carousel/{id}_{g|e}.webp
//   standard:     {edition}/{id}_{g|e}.webp  (g = townsfolk/outsider, e = minion/demon)
//
// Override the CDN base at build time with VITE_ICON_BASE_URL.
// If a RoleDef carries its own iconUrl, that always wins.

import type { RoleDef } from "@/stores/types";
import { localCharacterArt } from "./localArt";

const DEFAULT_BASE = "https://release.botc.app/resources/characters/";

// A handful of roles whose CDN slug differs from their data id.
const CDN_ID_OVERRIDES: Record<string, string> = {
  pitterhag: "pithag",
  lilmonsta: "lilmonsta",
};

function readBaseUrl(): string {
  const meta = import.meta as unknown as {
    env?: Record<string, string | undefined>;
  };
  const fromEnv = meta.env?.VITE_ICON_BASE_URL;
  const base =
    fromEnv && fromEnv.trim().length > 0 ? fromEnv.trim() : DEFAULT_BASE;
  return base.endsWith("/") ? base : `${base}/`;
}

function cdnUrlForRole(role: RoleDef): string {
  const base = readBaseUrl();
  const { id, type, edition } = role;

  if (type === "fabled") return `${base}fabled/${id}.webp`;
  if (type === "loric") return `${base}loric/${id}.webp`;

  if (type === "traveler") {
    if (edition === "experimental") return `${base}carousel/${id}_g.webp`;
    const ed = edition ?? "tb";
    return `${base}${ed}/${id}_g.webp`;
  }

  if (edition === "experimental") {
    const align = type === "townsfolk" || type === "outsider" ? "g" : "e";
    return `${base}carousel/${id}_${align}.webp`;
  }

  const cdnId = CDN_ID_OVERRIDES[id] ?? id;
  const ed = edition ?? "tb";
  const align = type === "townsfolk" || type === "outsider" ? "g" : "e";
  return `${base}${ed}/${cdnId}_${align}.webp`;
}

export function iconUrlFor(roleOrId: string | RoleDef): string {
  if (typeof roleOrId !== "string") {
    if (roleOrId.iconUrl) return roleOrId.iconUrl;
    // Package 3: self-hosted official art wins; the CDN is only the fallback
    // for characters with no local file.
    return localCharacterArt(roleOrId.id) ?? cdnUrlForRole(roleOrId);
  }
  // String-only path: no RoleDef available (e.g. unknown custom role).
  // Fall back to a best-guess TB townsfolk path; the img's onError hides it.
  const base = readBaseUrl();
  const id = roleOrId.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const local = localCharacterArt(id);
  if (local) return local;
  return `${base}tb/${id}_g.webp`;
}
