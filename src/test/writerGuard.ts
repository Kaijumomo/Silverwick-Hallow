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

/** The top-level helper or store command (6-space `name: (` member) that
 * encloses `line` (1-based) in the comment-stripped source. */
export function enclosingUnitFor(source: string, line: number): string {
  const lines = stripCommentsForGuard(source).split("\n");
  for (let i = line - 1; i >= 0; i--) {
    const top = /^(?:export )?(?:const|function|async function) (\w+)/.exec(lines[i]!);
    if (top) return top[1]!;
    const command = /^ {6}(\w+): (?:\(|async \()/.exec(lines[i]!);
    if (command) return command[1]!;
  }
  return "<module>";
}

/**
 * SOL-10F-L7: a read-only SNAPSHOT module (a workflow fingerprint, a Night step
 * view, a delivery record) is admitted only inside its one reviewed unit, and
 * only as verbatim OBSERVED copies `field: player.field`. Returns every
 * write-shaped line that is anything else -- a planted writer elsewhere in an
 * allowlisted module is therefore still caught.
 */
export function snapshotViolations(fields: readonly string[], source: string, unit: string): string[] {
  const code = stripCommentsForGuard(source).split("\n");
  const copy = new RegExp(`(?<![.\\w])(${fields.join("|")})[ \\t]*:[ \\t]*player\\.\\1(?=[ \\t]*[,}]|[ \\t]*$)`, "g");
  return writeLinesFor(fields, source).flatMap((line) => {
    const text = code[line - 1]!;
    const where = enclosingUnitFor(source, line);
    const residue = writeLinesFor(fields, text.replace(copy, ""));
    return where === unit && residue.length === 0 ? [] : [`${line} (${where}): ${text.trim()}`];
  });
}
