import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('../', import.meta.url));
const read = args => JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { cwd, encoding: 'utf8', maxBuffer: 4_000_000 }));
const commands = read(['help', '--json']);
const manuals = read(['explain', '--all', '--json']);
const lines = ['# Instrilo CLI reference', '', 'Generated from the CLI itself. Regenerate with `npm run docs:cli` after changing commands or manual topics.', '', 'Install the built app and CLI from the [GitHub release](https://github.com/nimeshbuilds/instrilo/releases) using the [installation guide](INSTALLATION.md). Run `instrilo web enable` to open the local app. Every example uses the installed `instrilo` command. Prepare the bundled quickstarts with `instrilo tutorials setup ./instrilo-tutorials`, then `cd ./instrilo-tutorials`; no source checkout is needed. Contributors can follow the source installation instructions, including `npm link`, to use the same command. `PROJECT`, `RUN_ID`, `HASH`, and uppercase example values are placeholders.', '', `This reference contains ${commands.length} command entries (including groups and the root) and ${Object.keys(manuals).length} offline manual topics.`, '', '```sh', 'instrilo help --all', 'instrilo help approvals approve', 'instrilo explain --list', 'instrilo explain --search JWT', 'instrilo help --json', '```', '', '## Command index', '', '| Command | Purpose |', '| --- | --- |'];
const cell = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
for (const c of commands) lines.push(`| \`${cell(c.command)}\` | ${cell(c.description)} |`);
lines.push('', '## Operational manual', '');
for (const [id, m] of Object.entries(manuals)) lines.push(`### ${m.title}`, '', `Available offline: \`instrilo explain ${id}\`.`, '', '```text', m.body, '```', '');
lines.push('## Every command, argument, and option', '');
for (const c of commands) {
  lines.push(`### ${c.command}`, '', c.description, '', '```text', c.command + c.arguments.map(a => ` ${a.required ? '<' : '['}${a.name}${a.variadic ? '...' : ''}${a.required ? '>' : ']'}`).join(''), '```', '');
  if (c.arguments.length) { lines.push('| Argument | Required | Default | Description |', '| --- | --- | --- | --- |'); for (const a of c.arguments) lines.push(`| \`${cell(a.name)}\` | ${a.required ? 'yes' : 'no'} | ${cell(a.default ?? '—')} | ${cell(a.description)} |`); lines.push(''); }
  if (c.options.length) { lines.push('| Option | Required | Default | Description |', '| --- | --- | --- | --- |'); for (const o of c.options) lines.push(`| \`${cell(o.flags)}\` | ${o.required ? 'yes' : 'no'} | ${cell(o.default ?? '—')} | ${cell(o.description)} |`); lines.push(''); }
  lines.push('Every command also accepts `-h, --help`.', '');
  if (c.examples.length) lines.push('```sh', ...c.examples, '```', '');
  if (manuals[c.topic]) lines.push(`Guide: \`instrilo explain ${c.topic}\`.`, '');
}
const output = lines.join('\n'), path = fileURLToPath(new URL('../docs/CLI.md', import.meta.url));
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== output) { console.error('CLI reference is stale. Run npm run docs:cli.'); process.exitCode = 1; }
  else console.log('CLI reference matches the command definitions and manual.');
} else { writeFileSync(path, output); console.log(`Wrote ${commands.length} command entries and ${Object.keys(manuals).length} manual topics to docs/CLI.md.`); }
