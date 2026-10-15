// Copies the official edition logos and Carousel icons from the private PNG
// handoff into public/art/ (git-ignored). Usage:
//   node scripts/install-private-art.mjs <path to asset-package>
// The artwork belongs to The Pandemonium Institute and was collected for private
// personal use only; it is deliberately not committed. Without it the Home and
// Reference screens show their marked temporary treatments.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const src = process.argv[2] ? resolve(process.argv[2]) : null;
if (!src || !existsSync(join(src, "scripts", "tb.png"))) {
  console.error("Usage: node scripts/install-private-art.mjs <path to asset-package>");
  process.exit(1);
}
const dest = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "art");
const files = [
  ...["tb", "bmr", "snv"].map((id) => `scripts/${id}.png`),
  ...["lleech", "balloonist", "pixie", "huntsman", "boffin", "king"].map((id) => `characters/carousel/${id}.png`),
];
for (const rel of files) {
  const from = join(src, rel);
  if (!existsSync(from)) {
    console.error(`Missing in package: ${rel}`);
    process.exit(1);
  }
  mkdirSync(dirname(join(dest, rel)), { recursive: true });
  cpSync(from, join(dest, rel));
}
console.log(`Installed ${files.length} files into ${dest}. They are git-ignored; do not commit or redistribute them.`);
