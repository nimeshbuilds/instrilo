import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { archiveName, assertPackageFiles, killTree, metadata, repository, run } from './release-utils.mjs';

let tarball = join(repository, 'release', archiveName), output = join(repository, 'release', 'verification-local.json');
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--tarball' && args[index + 1]) tarball = resolve(args[++index]);
  else if (args[index] === '--output' && args[index + 1]) output = resolve(args[++index]);
  else throw new Error('Usage: npm run test:release -- [--tarball FILE] [--output FILE]');
}
if (process.platform === 'win32') throw new Error('Run release verification in WSL. Native Windows is not a supported release platform yet.');
const started = Date.now(), archiveBytes = await readFile(tarball);
const report = {
  schemaVersion: 1, package: metadata.name, version: metadata.version,
  sha256: createHash('sha256').update(archiveBytes).digest('hex'),
  generatedAt: new Date().toISOString(), platform: process.platform, arch: process.arch, node: process.versions.node,
  status: 'running', checks: [],
  scope: 'Clean global, local-hoisted and extracted installs of the release archive; installed CLI aliases/manual; native TypeScript generation, dependency preparation and execution; Python generation; local browser app assets and authenticated API; uninstall preserves user projects.',
  limitations: ['Runtime dependencies require npm registry access.', 'No live provider login, paid model request, cloud deployment, native Windows operation or Python execution is claimed.'],
};
const root = await mkdtemp(join(tmpdir(), 'instrilo-release-'));
const env = {};
for (const key of ['PATH', 'HOME', 'USERPROFILE', 'USER', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'CI', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY']) if (process.env[key]) env[key] = process.env[key];
Object.assign(env, { npm_config_userconfig: join(root, 'empty.npmrc'), npm_config_cache: join(root, 'npm-cache'), OTEL_SDK_DISABLED: 'true', DO_NOT_TRACK: '1' });
await writeFile(env.npm_config_userconfig, '');
const command = (binary, arguments_, options = {}) => run(binary, arguments_, { cwd: root, env, ...options });
const passed = (id, details) => { report.checks.push({ id, status: 'passed', details }); console.log(`PASS ${id}`); };
const exists = async path => { try { await access(path); return true; } catch { return false; } };
let app;
const stopApp = async () => {
  if (!app) return;
  const child = app;
  app = undefined;
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolveStop => {
    const timer = setTimeout(() => killTree(child, 'SIGKILL'), 2000);
    child.once('close', () => { clearTimeout(timer); resolveStop(); });
    killTree(child);
  });
};
const stopOnSignal = () => { killTree(app, 'SIGKILL'); };
process.once('SIGINT', stopOnSignal); process.once('SIGTERM', stopOnSignal);
try {
  const archiveFiles = (await command('tar', ['-tzf', tarball])).stdout.trim().split('\n');
  assert.ok(archiveFiles.every(file => file.startsWith('package/')), 'Every archive file must have the npm package prefix.');
  assertPackageFiles(archiveFiles.map(file => file.slice('package/'.length)));
  passed('package-contents', 'Restrictive allowlist, complete compiled CLI/app assets, both language templates, offline reference and all ten example definitions.');

  const prefix = join(root, 'global');
  await command('npm', ['install', '--global', '--prefix', prefix, '--omit=dev', '--no-audit', '--no-fund', tarball]);
  const globalModules = (await command('npm', ['root', '--global', '--prefix', prefix])).stdout.trim();
  const installed = join(globalModules, '@nimeshbuilds/instrilo');
  const installedMetadata = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert.equal(installedMetadata.version, metadata.version);
  assert.equal(await exists(join(installed, 'src')), false, 'Release must not depend on source checkout.');
  assert.equal(await exists(join(installed, 'node_modules/typescript')), false, 'Installation must not need the TypeScript compiler.');
  for (const alias of ['instrilo', 'in', 'nb-agent']) {
    const binary = join(prefix, 'bin', alias);
    assert.equal((await command(binary, ['--version'])).stdout.trim(), metadata.version);
    assert.match((await command(binary, ['--help'])).stdout, /Instrilo|instrilo/);
  }
  const aliasEnv = { ...env, PATH: `${join(prefix, 'bin')}:${env.PATH || ''}` };
  assert.equal((await command('/bin/bash', ['--noprofile', '--norc', '-c', 'command in --version'], { env: aliasEnv })).stdout.trim(), metadata.version);
  const cli = (arguments_, options) => command(join(prefix, 'bin', 'instrilo'), arguments_, options);
  const allHelp = (await cli(['help', '--all'])).stdout, allManual = (await cli(['explain', '--all'])).stdout;
  assert.ok(allHelp.length > 20_000 && allManual.length > 20_000, 'Comprehensive offline help/manual must be present.');
  for (const term of ['subscriptions', 'deployment', 'approval', 'guidance', 'judge']) assert.ok(allManual.toLowerCase().includes(term), `Offline manual is missing ${term}.`);
  assert.ok((await readFile(join(installed, 'docs/CLI.md'), 'utf8')).length > 20_000);
  passed('global-install-aliases-manual', 'Installed without development dependencies; instrilo, in, nb-agent, Bash reserved-word invocation and comprehensive offline help all work.');

  const projects = join(root, 'user-projects');
  await cli(['init', 'typescript-release', '--directory', projects, '--language', 'typescript']);
  const tsProject = join(projects, 'typescript-release');
  await cli(['build', tsProject]);
  await cli(['prepare', tsProject]);
  const result = JSON.parse((await cli(['run', tsProject, '--input', 'Hello from the release'])).stdout);
  assert.equal(result.output, '[DEMO ONLY] Hello from the release');
  assert.ok(Array.isArray(result.trace) && result.trace.length > 0);
  for (const file of ['agent.ts', 'runtime.ts', 'server.ts', 'session.ts', 'mcp_server.ts', 'package.json', 'build-lock.json']) await access(join(tsProject, 'generated', file));
  passed('typescript-generation-and-run', 'The installed CLI generated, prepared and actually executed its native TypeScript runtime; the explicit offline result and trace were checked.');

  await cli(['init', 'python-release', '--directory', projects, '--language', 'python']);
  const pyProject = join(projects, 'python-release');
  await cli(['build', pyProject]);
  for (const file of ['agent.py', 'runtime.py', 'server.py', 'session.py', 'mcp_server.py', 'pyproject.toml', 'build-lock.json']) {
    assert.ok((await readFile(join(pyProject, 'generated', file), 'utf8')).length > 20, `Missing/empty Python artifact ${file}.`);
  }
  passed('python-template-generation', 'The installed package generated the Python runtime, HTTP/MCP servers, session support, project metadata and build evidence; no Python interpreter is required for generation.');

  app = spawn(join(prefix, 'bin', 'instrilo'), ['app', '--workspace', projects, '--port', '0'], { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const appUrl = await new Promise((resolveUrl, reject) => {
    let captured = '';
    const timer = setTimeout(() => reject(new Error('Installed app did not become ready within 15 seconds.')), 15_000);
    app.stdout.on('data', chunk => {
      captured += chunk;
      const match = captured.match(/http:\/\/127\.0\.0\.1:\d+\/#token=[0-9a-f]{64}/);
      if (match) { clearTimeout(timer); resolveUrl(new URL(match[0])); }
      if (captured.length > 65_536) { clearTimeout(timer); reject(new Error('Installed app exceeded startup output limit.')); }
    });
    // Drain stderr without exposing private workspace/session details in logs.
    app.stderr.resume();
    app.once('error', () => { clearTimeout(timer); reject(new Error('Installed app could not start.')); });
    app.once('close', () => { clearTimeout(timer); reject(new Error('Installed app stopped before becoming ready.')); });
  });
  const request = path => fetch(new URL(path, appUrl), { signal: AbortSignal.timeout(10_000) });
  const html = await request('/');
  assert.equal(html.status, 200); assert.match(await html.text(), /<title>Instrilo<\/title>/);
  for (const [asset, mime] of [['app.js', 'javascript'], ['deployment.js', 'javascript'], ['style.css', 'css'], ['icon.svg', 'svg']]) {
    const response = await request(`/${asset}`);
    assert.equal(response.status, 200, `App asset ${asset} must be served.`);
    assert.ok(response.headers.get('content-type')?.includes(mime));
    assert.ok((await response.text()).length > 100, `App asset ${asset} must not be empty.`);
  }
  assert.equal((await request('/api/meta')).status, 401);
  const token = new URLSearchParams(appUrl.hash.slice(1)).get('token');
  const authenticated = await fetch(new URL('/api/meta', appUrl), { headers: { 'X-Studio-Token': token }, signal: AbortSignal.timeout(10_000) });
  assert.equal(authenticated.status, 200); assert.equal((await authenticated.json()).version, metadata.version);
  const listed = await fetch(new URL('/api/projects', appUrl), { headers: { 'X-Studio-Token': token }, signal: AbortSignal.timeout(10_000) });
  assert.equal(listed.status, 200); assert.equal((await listed.json()).length, 2);
  await stopApp();
  passed('installed-browser-app', 'Local branded HTML, all JavaScript/CSS/icon assets, rejected unauthenticated API access, authenticated version metadata and both generated projects were verified.');

  const consumer = join(root, 'local-consumer');
  await mkdir(consumer);
  await command('npm', ['install', '--prefix', consumer, '--omit=dev', '--no-audit', '--no-fund', tarball]);
  const localCli = join(consumer, 'node_modules/.bin/instrilo');
  assert.equal(await exists(join(consumer, 'node_modules/tsx')), true, 'Exercise npm-hoisted runtime dependencies.');
  assert.equal(await exists(join(consumer, 'node_modules/@nimeshbuilds/instrilo/node_modules/tsx')), false, 'Local install should expose the hoisted-layout case.');
  const localResult = JSON.parse((await command(localCli, ['run', tsProject, '--input', 'Hoisted package works'])).stdout);
  assert.equal(localResult.output, '[DEMO ONLY] Hoisted package works');
  passed('local-install-hoisted-runtime', 'A separate local npm installation executed the prepared agent with hoisted runtime dependencies.');

  const extracted = join(root, 'extracted');
  await mkdir(extracted);
  await command('tar', ['-xzf', tarball, '-C', extracted]);
  const extractedPackage = join(extracted, 'package');
  await command('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: extractedPackage });
  assert.equal((await command(process.execPath, ['dist/cli.js', '--version'], { cwd: extractedPackage })).stdout.trim(), metadata.version);
  await command(process.execPath, ['dist/cli.js', 'guidance', 'inspect', 'examples/quickstarts/foundations/guidance'], { cwd: extractedPackage });
  const extractedResult = JSON.parse((await command(process.execPath, ['dist/cli.js', 'run', tsProject, '--input', 'Extracted package works'], { cwd: extractedPackage })).stdout);
  assert.equal(extractedResult.output, '[DEMO ONLY] Extracted package works');
  passed('extracted-walkthrough-layout', 'The archive installs runtime-only dependencies without lifecycle scripts; node dist/cli.js, bundled guidance examples and actual TypeScript execution work without a source build.');

  await command('npm', ['uninstall', '--global', '--prefix', prefix, '--no-audit', '--no-fund', metadata.name]);
  for (const alias of ['instrilo', 'in', 'nb-agent']) assert.equal(await exists(join(prefix, 'bin', alias)), false);
  await access(join(tsProject, 'agent-studio.yaml')); await access(join(pyProject, 'agent-studio.yaml'));
  passed('uninstall-preserves-projects', 'npm uninstall removes the installed package and all aliases while retaining the separately created user projects.');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  process.exitCode = 1;
  console.error(error instanceof Error ? error.message : String(error));
} finally {
  await stopApp();
  process.removeListener('SIGINT', stopOnSignal); process.removeListener('SIGTERM', stopOnSignal);
  await rm(root, { recursive: true, force: true });
  report.durationMs = Date.now() - started;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
}
console.log(`Release verification ${report.status}: ${report.checks.length} checks. Report contains no private session URLs, workspace paths or command output.`);
