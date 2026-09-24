import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { manuals } from '../src/cli-help.js';
import { defaultSpec, validateSpec } from '../src/core.js';
const exec = promisify(execFile);
async function cli(...args: string[]) { return exec(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { maxBuffer: 4_000_000 }); }
test('complete CLI reference has discoverable descriptions, argument and option help, and manual coverage', async () => {
  const commands = JSON.parse((await cli('help', '--json')).stdout);
  const manuals = JSON.parse((await cli('explain', '--all', '--json')).stdout);
  assert.ok(commands.length >= 120);
  assert.ok(Object.keys(manuals).length >= 27);
  for (const command of commands) {
    assert.ok(command.description.trim(), command.command);
    for (const arg of command.arguments) assert.ok(arg.description.trim(), command.command + ':' + arg.name);
    for (const option of command.options) assert.ok(option.description.trim(), command.command + ':' + option.flags);
    if (!commands.some((c: any) => c.command.startsWith(command.command + ' '))) assert.ok(command.examples.length, command.command + ' needs an example');
  }
  for (const topic of ['quickstart', 'guidance', 'configuration', 'gateways', 'subscriptions', 'requirements', 'release', 'review', 'regeneration', 'dependencies', 'runs', 'approvals', 'replay', 'adapters', 'deployment', 'desktop', 'security', 'troubleshooting']) assert.ok(manuals[topic]?.body.length > 150, topic);
  assert.match(manuals.replay.body, /replay-bundle/);
  assert.match(manuals.approvals.body, /reconcile/);
  const all = (await cli('help', '--all')).stdout.replace(/\s+/g, ' ');
  for (const command of commands.filter((c: any) => c.command !== 'instrilo')) assert.ok(all.includes(command.description), command.command);
});
test('nested help, searchable explanations and mistakes are useful without opening documentation', async () => {
  const nested = await cli('help', 'approvals', 'approve');
  for (const text of ['--digest', '--expires-in', 'Required options', 'Examples:', 'instrilo explain approvals']) assert.ok(nested.stdout.includes(text), text);
  const search = JSON.parse((await cli('explain', '--search', 'JWT', '--json')).stdout);
  assert.ok(search.some((m: any) => m.topic === 'gateways'));
  assert.match((await cli()).stdout, /Commands:/);
  assert.match((await cli('runs')).stdout, /replay-bundle/);
  await assert.rejects(() => cli('explain', 'does-not-exist'), (e: any) => e.code === 1 && /explain --list/.test(e.stderr));
  await assert.rejects(() => cli('approvals', 'approve', 'invalid-run'), (e: any) => e.code === 1 && /required option/.test(e.stderr));
});
test('documented framework and scoped-tool examples satisfy the actual configuration schema', async () => {
  const spec=defaultSpec('manual-example');
  for(const line of manuals.frameworks.body.split('\n')){
    const add=line.match(/^\s*instrilo connections add (\S+) PROJECT --data '(.+)'$/);
    if(add){spec.connections[add[1]]=JSON.parse(add[2]);assert.ok(validateSpec(spec).spec);}
    const use=line.match(/^\s*instrilo connections use runtime (\S+) PROJECT$/);
    if(use){spec.roles.runtime=use[1];assert.ok(validateSpec(spec).spec);}
    const framework=line.match(/^\s*instrilo config set framework (\S+) PROJECT$/);
    if(framework){spec.framework=framework[1] as typeof spec.framework;assert.ok(validateSpec(spec).spec,'The manual must select a compatible runtime before changing frameworks.');}
  }
  assert.equal(spec.framework,'langgraph');assert.equal(spec.connections[spec.roles.runtime].kind,'openai');
  const tool=JSON.parse((await cli('tools','example')).stdout),local=defaultSpec('tools-example');
  local.agent.tools=[tool];assert.ok(validateSpec(local).issues.some(issue=>issue.code==='AUTHORIZATION_WITHOUT_IDENTITY'));
  const inbound=manuals.tools.body.match(/config set security\.inbound '(.+)' PROJECT --json/);
  assert.ok(inbound,'Scoped tool instructions must supply the required inbound identity configuration.');
  local.security.inbound=JSON.parse(inbound[1]);assert.ok(validateSpec(local).spec);
  const reference=JSON.parse((await cli('help','--json')).stdout);
  const examples=(command:string)=>reference.find((entry:any)=>entry.command==='instrilo '+command).examples.join('\n');
  assert.match(examples('runs replay-bundle'),/--execute-local/);
  assert.match(examples('guidance write'),/operations\.md/);
  assert.match(examples('adapters init'),/--id deploy-notes/);
  assert.match(examples('requirements link'),/--kind deterministic/);
});
