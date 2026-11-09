#!/usr/bin/env node
// One-off importer for Claude Design handoff templates (`*.dc.html`).
//
// Reads the <x-dc> template of a design prototype and emits
//   1. a React view component that renders the template against a view-model (`vm`)
//   2. a stylesheet holding the :hover / :focus / :active rules the template declares
//
// The view-model is hand-written (see src/features/grimoire-v6/*). The generated view is kept
// in the repo as the reviewed source of truth; this script exists so the import is reproducible.
//
// Usage: node scripts/design-import/dc-to-tsx.mjs <input.dc.html> <out.tsx> <out.css> <ComponentName> <classPrefix>
import { readFileSync, writeFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const [, , inFile, outTsx, outCss, componentName = 'DesignView', prefix = 'dv', optsJson = '{}'] = process.argv;
// opts.rootId        emit only the subtree under the element with this id (drops the prototype's device frame)
// opts.rootStyle     replacement inline style for that root element
// opts.dropStyleHas  drop elements whose inline style contains any of these substrings (retired UI)
const opts = JSON.parse(optsJson);
if (!inFile || !outTsx || !outCss) {
  console.error('usage: dc-to-tsx.mjs <in.dc.html> <out.tsx> <out.css> [Component] [prefix]');
  process.exit(1);
}

const src = readFileSync(inFile, 'utf8');
const open = /<x-dc(?:\s[^>]*)?>/.exec(src);
const close = src.lastIndexOf('</x-dc>');
if (!open || close < open.index) throw new Error('no <x-dc> block');
let html = src.slice(open.index + open[0].length, close);

// Sample data the design bakes into the template (a made-up game code and host) becomes view-model fields.
for (const { regex, flags = 'g', replace } of opts.templatePatches ?? []) {
  const before = html;
  html = html.replace(new RegExp(regex, flags), replace);
  if (html === before) throw new Error(`template patch matched nothing: ${regex}`);
}

// Same pre-processing the design runtime applies so attribute case survives parsing.
const CAMEL = 'sc-camel-';
html = html.replace(/<helmet(\s|>)/gi, '<sc-helmet$1').replace(/<\/helmet\s*>/gi, '</sc-helmet>');
html = html.replace(
  /(\s)([a-z]+[A-Z][A-Za-z0-9]*)(\s*=)/g,
  (_, sp, name, eq) => sp + CAMEL + name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()) + eq,
);

const dom = new JSDOM(`<!doctype html><body><template id="t">${html}</template></body>`);
const tpl = dom.window.document.getElementById('t').content;
const kebabToCamel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

// ---------- expressions ----------
function expr(raw, scope) {
  const e = raw.trim();
  if (e.startsWith('!')) return `!${expr(e.slice(1), scope)}`;
  const eq = /^(.*?)\s*(===|!==|==|!=)\s*(.*)$/.exec(e);
  if (eq) return `(${expr(eq[1], scope)} ${eq[2].length === 2 ? eq[2] + '=' : eq[2]} ${expr(eq[3], scope)})`;
  if (/^(true|false|null|undefined)$/.test(e)) return e;
  if (/^-?\d+(\.\d+)?$/.test(e)) return e;
  if (/^(['"]).*\1$/.test(e)) return JSON.stringify(e.slice(1, -1));
  // dotted path with optional [expr] indexing
  const head = /^[A-Za-z_$][\w$]*/.exec(e);
  if (!head) throw new Error(`bad expression: ${raw}`);
  let out = scope.has(head[0]) ? head[0] : `vm.${head[0]}`;
  let i = head[0].length;
  while (i < e.length) {
    if (e[i] === '.') {
      const m = /^[\w$]+/.exec(e.slice(i + 1));
      out += `?.${m[0]}`.replace(/\?\.(\d+)/, '?.[$1]');
      i += 1 + m[0].length;
    } else if (e[i] === '[') {
      let d = 1;
      let j = i + 1;
      while (d > 0) {
        if (e[j] === '[') d++;
        else if (e[j] === ']') d--;
        j++;
      }
      out += `?.[${expr(e.slice(i + 1, j - 1), scope)}]`;
      i = j;
    } else throw new Error(`bad expression: ${raw}`);
  }
  return out;
}

function attrValue(raw, scope) {
  const whole = raw.match(/^\s*\{\{([\s\S]+?)\}\}\s*$/);
  if (whole) return { kind: 'expr', code: expr(whole[1], scope) };
  if (raw.includes('{{')) {
    const parts = raw.split(/\{\{([\s\S]+?)\}\}/g);
    const code = parts
      .map((p, i) => (i & 1 ? `\${${expr(p, scope)} ?? ''}` : p.replace(/[`\\$]/g, (c) => '\\' + c)))
      .join('');
    return { kind: 'tpl', code: '`' + code + '`' };
  }
  return { kind: 'str', code: JSON.stringify(raw) };
}

// ---------- styles ----------
const hoisted = [];
const hoistIndex = new Map();
function cssToObjSource(css) {
  const entries = new Map();
  for (const decl of css.split(/;(?![^(]*\))/)) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    let prop = decl.slice(0, i).trim();
    const val = decl.slice(i + 1).trim();
    if (!prop) continue;
    if (!prop.startsWith('--')) {
      prop = prop.replace(/^-webkit-/, 'webkit-').replace(/^-moz-/, 'moz-').replace(/^-ms-/, 'ms-');
      prop = kebabToCamel(prop).replace(/^(webkit|moz|ms)/, (m) => m[0].toUpperCase() + m.slice(1));
    }
    entries.set(prop, val);
  }
  return `{ ${[...entries].map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }`;
}
function hoistStyle(css) {
  const src = cssToObjSource(css);
  if (!hoistIndex.has(src)) {
    hoistIndex.set(src, `S${hoisted.length}`);
    hoisted.push(src);
  }
  return hoistIndex.get(src);
}

const pseudoCss = [];
const pseudoIndex = new Map();
function pseudoClass(pseudo, css) {
  const key = `${pseudo}|${css}`;
  if (pseudoIndex.has(key)) return pseudoIndex.get(key);
  if (css.includes('{{')) throw new Error(`dynamic ${pseudo} style not supported: ${css}`);
  const cls = `${prefix}-${pseudo[0]}${pseudoIndex.size.toString(36)}`;
  const body = css
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => `${d.replace(/\s*!important\s*$/, '')} !important`)
    .join('; ');
  pseudoCss.push(`.${cls}:${pseudo} { ${body}; }`);
  pseudoIndex.set(key, cls);
  return cls;
}

// ---------- JSX emit ----------
const propName = (n) => {
  if (n.startsWith(CAMEL)) return kebabToCamel(n.slice(CAMEL.length));
  if (n === 'class') return 'className';
  if (n === 'for') return 'htmlFor';
  if (n.startsWith('aria-') || n.startsWith('data-')) return n;
  if (n === 'tabindex') return 'tabIndex';
  if (n === 'viewbox') return 'viewBox';
  if (n === 'maxlength') return 'maxLength';
  if (n === 'readonly') return 'readOnly';
  if (n === 'autofocus') return 'autoFocus';
  return n.includes('-') ? kebabToCamel(n) : n;
};

const ind = (d) => '  '.repeat(d);
const esc = (s) => s.replace(/[{}<>]/g, (c) => `{${JSON.stringify(c)}}`);

function emitText(node, scope, d) {
  const txt = node.nodeValue ?? '';
  if (!txt.includes('{{')) {
    if (!txt.trim()) return txt.includes(' ') && !txt.includes('\n') ? `${ind(d)}{' '}` : '';
    // JSX drops a space that touches a line break, so a space between text and a neighbouring element is spelled out.
    const lead = /^[ \t]/.test(txt) && node.previousSibling?.nodeType === 1 ? "{' '}" : '';
    const trail = /[ \t]$/.test(txt) && node.nextSibling?.nodeType === 1 ? "{' '}" : '';
    return `${ind(d)}${lead}${esc(txt.replace(/\s+/g, ' ').trim())}${trail}`;
  }
  const parts = txt.split(/\{\{([\s\S]+?)\}\}/g);
  const out = [];
  parts.forEach((p, i) => {
    if (i & 1) out.push(`{T(${expr(p, scope)})}`);
    else if (p.trim() || (p.includes(' ') && !p.includes('\n'))) out.push(esc(p.replace(/\s+/g, ' ')));
  });
  return `${ind(d)}${out.join('')}`;
}

function emitNode(node, scope, d, keyFor) {
  if (node.nodeType === 3) return emitText(node, scope, d);
  if (node.nodeType !== 1) return '';
  const tag = node.localName;
  const kids = (sc = scope, dd = d + 1) =>
    [...node.childNodes].map((c) => emitNode(c, sc, dd)).filter((s) => s !== '');

  if (tag === 'sc-helmet') return '';
  if (tag === 'sc-if') {
    const v = attrValue(node.getAttribute('value'), scope);
    return `${ind(d)}{${v.code} && (\n${ind(d + 1)}<>\n${kids().join('\n')}\n${ind(d + 1)}</>\n${ind(d)})}`;
  }
  if (tag === 'sc-for') {
    const list = attrValue(node.getAttribute('list'), scope).code;
    const as = node.getAttribute('as');
    const inner = new Set([...scope, as]);
    return `${ind(d)}{(${list} ?? []).map((${as}: any, ${as}$i: number) => (\n${ind(d + 1)}<Fragment key={${as}$i}>\n${kids(inner, d + 2).join('\n')}\n${ind(d + 1)}</Fragment>\n${ind(d)}))}`;
  }
  if (tag === 'dc-import' || tag === 'x-import') {
    return `${ind(d)}{vm.${JSON.stringify(node.getAttribute('name'))
      .replace(/"/g, '')
      .replace(/\W+/g, '_')}}`;
  }

  if (opts.dropStyleHas?.some((m) => (node.getAttribute('style') ?? '').includes(m))) return '';
  const props = [];
  let styleProp = null;
  const pseudo = [];
  let classAttr = null;
  for (const a of [...node.attributes]) {
    const name = a.name;
    if (name.startsWith('hint-') || name === 'sc-name' || name === 'data-dc-tpl') continue;
    if (name.startsWith('style-')) {
      pseudo.push(pseudoClass(name.slice(6), a.value));
      continue;
    }
    if (name === 'style') {
      if (opts.rootId && node.getAttribute('id') === opts.rootId && opts.rootStyle) {
        styleProp = `style={${hoistStyle(opts.rootStyle)}}`;
        continue;
      }
      if (!a.value.includes('{{')) styleProp = `style={${hoistStyle(a.value)}}`;
      else {
        const v = attrValue(a.value, scope);
        styleProp = `style={css(${v.code})}`;
      }
      continue;
    }
    const pn = propName(name);
    const v = attrValue(a.value, scope);
    if (pn === 'className') {
      classAttr = v;
      continue;
    }
    if (pn === 'ref') {
      props.push(`ref={${v.code}}`);
      continue;
    }
    const numeric = v.kind === 'str' && ['tabIndex', 'maxLength', 'rows', 'cols'].includes(pn);
    props.push(numeric ? `${pn}={${a.value}}` : v.kind === 'str' ? `${pn}=${v.code}` : `${pn}={${v.code}}`);
  }
  if (classAttr || pseudo.length) {
    const base = classAttr ? (classAttr.kind === 'str' ? classAttr.code : classAttr.code) : '""';
    props.push(pseudo.length ? `className={[${base}, ${JSON.stringify(pseudo.join(' '))}].filter(Boolean).join(' ')}` : `className={${base}}`);
  }
  if (styleProp) props.push(styleProp);
  const VOID = new Set(['br', 'img', 'input', 'hr']);
  const attrs = props.length ? ' ' + props.join(' ') : '';
  const jsxTag = tag;
  if (VOID.has(tag)) return `${ind(d)}<${jsxTag}${attrs} />`;
  const children = kids();
  if (!children.length) return `${ind(d)}<${jsxTag}${attrs} />`;
  return `${ind(d)}<${jsxTag}${attrs}>\n${children.join('\n')}\n${ind(d)}</${jsxTag}>`;
}

const rootEl = opts.rootId ? tpl.querySelector(`#${opts.rootId}`) : null;
const body = (rootEl ? [rootEl] : [...tpl.childNodes]).map((c) => emitNode(c, new Set(), 3)).filter((s) => s.trim() !== '');

const out = `/* eslint-disable */
// @generated by scripts/design-import/dc-to-tsx.mjs from ${inFile.split('/').pop()}. The reviewed source of truth is this file.
import { Fragment } from 'react';
import { css, T } from './designRuntime';

${hoisted.map((s, i) => `const S${i}: React.CSSProperties = ${s};`).join('\n')}

export function ${componentName}({ vm }: { vm: any }) {
  return (
    <>
${body.join('\n')}
    </>
  );
}
`;
writeFileSync(outTsx, out);
writeFileSync(outCss, `/* @generated by scripts/design-import/dc-to-tsx.mjs from ${inFile.split('/').pop()} */\n${pseudoCss.join('\n')}\n`);
console.log(`wrote ${outTsx} (${out.split('\n').length} lines, ${hoisted.length} style objects) and ${outCss} (${pseudoCss.length} rules)`);
