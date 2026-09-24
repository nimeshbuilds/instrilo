import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const metadata = JSON.parse(await readFile(resolve(repository, 'package.json'), 'utf8'));
export const archiveName = `${metadata.name.replace('@', '').replace('/', '-')}-${metadata.version}.tgz`;

export function killTree(child, signal = 'SIGTERM') {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  try { process.platform === 'win32' ? child.kill(signal) : process.kill(-child.pid, signal); } catch { child.kill(signal); }
}

export function run(command, args, { cwd = repository, env = process.env, timeout = 240_000 } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', shell: false });
    let stdout = '', stderr = '', failure, bytes = 0;
    const fail = message => { failure ??= new Error(message); killTree(child, 'SIGKILL'); };
    const abort = () => fail('Release operation cancelled.');
    process.once('SIGINT', abort); process.once('SIGTERM', abort);
    const timer = setTimeout(() => fail(`${command} exceeded ${timeout / 1000} seconds.`), timeout);
    const cleanup = () => { clearTimeout(timer); process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); };
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 8_000_000) fail('Release command exceeded its output bound.'); else stdout += chunk; });
    child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > 8_000_000) fail('Release command exceeded its output bound.'); else stderr += chunk; });
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', code => {
      cleanup();
      if (failure || code !== 0) reject(failure || new Error(`${command} exited ${code}.\n${stdout.slice(-4000)}\n${stderr.slice(-4000)}`));
      else resolveResult({ stdout, stderr });
    });
  });
}

export function assertPackageFiles(files) {
  const allowed = /^(?:package\.json|(?:README|LICENSE|CHANGELOG|SECURITY)(?:\.md)?|dist\/(?:[^/]+\.js|adapter-worker\.mjs|templates\/(?:frameworks\.js|[^/]+\.tpl)|web\/[^/]+\.(?:js|css|svg|html))|docs\/[^/]+\.md|assets\/brand\/(?:[^/]+\.(?:svg|png)|README\.md)|examples\/quickstarts\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:mjs|json|jsonl|md)|website\/(?:README\.md|scenarios\/[a-z0-9-]+\.json))$/;
  for (const file of files) if (!allowed.test(file) || file.split('/').some(part => part.startsWith('.'))) throw new Error(`Unexpected package file: ${file}`);
  const required = [
    'package.json', 'README.md', 'LICENSE', 'SECURITY.md', 'docs/CLI.md',
    'dist/cli.js', 'dist/server.js', 'dist/execution.js', 'dist/adapter-worker.mjs', 'dist/templates/frameworks.js',
    ...['agent', 'runtime', 'server', 'session', 'mcp_server', 'mcp_http'].flatMap(name => ['py', 'ts'].map(language => `dist/templates/${name}.${language}.tpl`)),
    ...['index.html', 'app.js', 'deployment.js', 'style.css', 'icon.svg'].map(file => `dist/web/${file}`),
    'examples/quickstarts/foundations/answers.json', 'examples/quickstarts/foundations/guidance/product.md',
    'examples/quickstarts/foundations/fixture.mjs', 'examples/quickstarts/foundations/verify.mjs',
    'examples/quickstarts/delivery/fixture.mjs', 'examples/quickstarts/delivery/verify.mjs',
  ];
  for (const file of required) if (!files.includes(file)) throw new Error(`Release is missing required file: ${file}`);
  if (files.filter(file => file.startsWith('website/scenarios/')).length !== 10) throw new Error('Release must include all ten walkthrough definitions.');
}
