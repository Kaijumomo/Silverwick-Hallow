/**
 * SOL-10F-L7: the ONE write-shape detector shared by the Role and Alignment
 * architecture guards (comments stripped first). It looks for ordinary direct
 * writer syntax for the given fields, regardless of formatting:
 *
 *  - an object literal / patch property, however the literal is closed or
 *    the statement ends -- `,`, `}`, `};`, `})`, end of line (multi-line
 *    literal) -- e.g. `const next = { ...p, actualRole: "x" };`. (A property
 *    value is never directly followed by `;`; a TYPE member is.)
 *  - direct property assignment `p.actualRole = x` (not `==` / `===`);
 *  - bracket assignment `p["actualRole"] = x`;
 *  - `delete p.actualRole`;
 *  - `Object.assign(p, { actualRole: x })` (the object-literal case).
 *
 * A TYPE annotation (`actualRole: RoleId;`, `{ actualRole: string }`,
 * `shownAlignment: ShownAlignment | null`) is not a write. It is deliberately
 * not a JavaScript parser: a false positive only asks for review.
 */

const TYPE_NAMES = "string|number|boolean|unknown|never|null|undefined|RoleId|Alignment|ShownAlignment|BehaviorMode|PlayerId|ParticipantId";

export function writePatterns(fields: readonly string[]): RegExp[] {
  const f = fields.join("|");
  return [
    // property in an object literal / patch: `field: <value>` followed by a
    // value terminator, where <value> is not a bare type annotation.
    new RegExp(`(?<![.\\w])["']?(${f})["']?[ \\t]*:[ \\t]*(?!(?:${TYPE_NAMES})[ \\t]*(?:[;,})\\]|]|$))(?=[^\\s;,}])[^\\n;,}]*(?:[,})\\]]|$)`, "gm"),
    new RegExp(`\\.(${f})\\s*=(?!=)`, "g"),
    new RegExp(`\\[\\s*['"\`](${f})['"\`]\\s*\\]\\s*=(?!=)`, "g"),
    new RegExp(`\\bdelete\\s+[\\w.?\\[\\]'"]*\\.(${f})\\b`, "g"),
    new RegExp(`\\bdelete\\s+[\\w.?]*\\[\\s*['"\`](${f})['"\`]\\s*\\]`, "g"),
  ];
}

export function stripCommentsForGuard(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

const lineOf = (code: string, index: number) => code.slice(0, index).split("\n").length;

/** 1-based line numbers of write-like shapes for `fields` in `source`. */
export function writeLinesFor(fields: readonly string[], source: string): number[] {
  const code = stripCommentsForGuard(source);
  const lines = new Set<number>();
  for (const pattern of writePatterns(fields)) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(code); match; match = pattern.exec(code)) lines.add(lineOf(code, match.index));
  }
  return [...lines].sort((a, b) => a - b);
}
