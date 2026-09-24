// Readiness and control for the checked-in local tutorial fixture only.
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
const [directory, action = 'ready'] = process.argv.slice(2);
let state;
for (let attempt = 0; attempt < 100; attempt++) {
  try { state = JSON.parse(await readFile(join(resolve(directory), 'ready.json'), 'utf8')); break; } catch { await setTimeout(50); }
}
if (!state) throw new Error('Tutorial fixture did not start in five seconds. Inspect fixture.log.');
const url = new URL(state.base);
if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Only a loopback tutorial fixture is allowed.');
const response = await fetch(state.base + (action === 'bad' ? '/variant' : '/counts'), { ...(action === 'bad' ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ variant: 'bad' }) } : {}), signal: AbortSignal.timeout(5000) });
if (!response.ok) throw new Error('Tutorial fixture returned ' + response.status);
console.log(JSON.stringify(await response.json(), null, 2));
