import { readFileSync, writeFileSync } from 'node:fs';
import { buildDevelopmentRules } from './development-rules.mjs';

// Local generation only. This script has no Firebase/network/deployment code.
if (process.argv.length !== 2) throw new Error('This local generator accepts no arguments.');
const base = new URL('../src/firebase/rules.json', import.meta.url);
const target = new URL('../src/firebase/development.multiplayer.rules.json', import.meta.url);
writeFileSync(target, JSON.stringify(buildDevelopmentRules(JSON.parse(readFileSync(base, 'utf8'))), null, 2) + '\n');
console.log('Prepared local development candidate. Hosted deny-all configuration is unchanged.');
