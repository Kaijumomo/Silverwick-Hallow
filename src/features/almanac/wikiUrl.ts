/** Canonical character wiki links; homebrew callers must withhold the link. */
export function wikiUrlFor(name: string): string {
  const slug = name.trim().replace(/['']/g, "").replace(/[^A-Za-z0-9 _-]/g, "")
    .split(/\s+/).filter(Boolean).join("_");
  return `https://wiki.bloodontheclocktower.com/${slug}`;
}
