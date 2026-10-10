import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDevelopmentRules } from './development-rules.mjs';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const base = read('../src/firebase/rules.json');
const candidate = read('../src/firebase/development.multiplayer.rules.json');
describe('development Rules artifact safety', () => {
  it('is generated exactly from current authoritative Rules without mutating them', () => {
    const before = structuredClone(base);
    expect(candidate).toEqual(buildDevelopmentRules(base));
    expect(base).toEqual(before);
  });
  it('keeps the deployable development configuration locked', () => {
    expect(read('../firebase.development.json').database).toEqual({
      instance: 'silverwick-hollow-default-rtdb', rules: 'src/firebase/development.locked.rules.json',
    });
    expect(read('../src/firebase/development.locked.rules.json')).toEqual({ rules: { '.read': false, '.write': false } });
  });
  it('refuses unreviewed top-level data or unconditional grants', () => {
    expect(() => buildDevelopmentRules({ rules: { ...base.rules, other: {} } })).toThrow();
    const changed = structuredClone(base);
    changed.rules.lobbies.$code['.read'] = true;
    expect(() => buildDevelopmentRules(changed)).toThrow();
  });
  it('fails closed on changed display syntax and preserves added public restrictions', () => {
    const changed = structuredClone(base);
    changed.rules.lobbies.$code.public['.read'] += ' && false';
    expect(() => buildDevelopmentRules(changed)).toThrow(/public\/display/);
    changed.rules.lobbies.$code.public['.read'] = 'false && ' + base.rules.lobbies.$code.public['.read'];
    expect(buildDevelopmentRules(changed).rules.lobbies.$code.public['.read']).toContain('&& (false && auth');
  });
  it('preserves all validators and fences, restricting every existing permission', () => {
    function check(original, restricted, path = '') {
      for (const [key, value] of Object.entries(original)) {
        const here = `${path}/${key}`;
        if (key === '.read' || key === '.write') {
          if (here === '/lobbies/$code/displayMembers/$uid/.write') expect(restricted[key]).toBe(false);
          else {
            expect(restricted[key]).toContain("auth.token.firebase.sign_in_provider === 'anonymous'");
            expect(restricted[key]).toContain("root.child('developmentAccess/users')");
            expect(restricted[key]).toContain("root.child('developmentAccess/games')");
            if (here !== '/lobbies/$code/public/.read') expect(restricted[key].endsWith(`&& (${value})`)).toBe(true);
          }
        } else if (key.startsWith('.')) expect(restricted[key]).toEqual(value);
        else check(value, restricted[key], here);
      }
    }
    check(base.rules, candidate.rules);
    expect(candidate.rules.developmentAccess).toEqual({ '.read': false, '.write': false });
    expect(candidate.rules.lobbies.$code.public['.read']).not.toContain('displayMembers');
  });
});
