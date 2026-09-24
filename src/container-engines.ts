import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, mkdir, open, realpath, stat, unlink } from 'node:fs/promises';
import os from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';

export type ContainerEngine = 'docker' | 'podman';
export interface ContainerEngineStatus {
  engine: ContainerEngine; installed: boolean; path?: string; ready: boolean; version?: string;
  connection?: string; message: string; nextSteps: string[]; warnings: string[];
}
export interface ContainerEnginePlan {
  engine: ContainerEngine; supported: boolean; platform: string; command?: string; args?: string[];
  commands?: { command: string; args: string[] }[]; steps: string[]; docs: string[];
  requiresConsent: true; impact: string[]; owned?: boolean; blockedReason?: string;
  machineStorage?: { machine: string; rootless: StorageInventory; rootful: StorageInventory };
}
type Operation = { consent: boolean; signal?: AbortSignal; onProgress?: (message: string) => void; removeMachineData?: boolean };
type StorageInventory = { containers: string[]; images: string[]; volumes: string[]; networks: string[] };
type Fingerprint = { path: string; realpath: string; dev: number; ino: number };
type Receipt = { schemaVersion: 1; engine: ContainerEngine; installedAt?: string; installation?: Fingerprint; package?: string; brew?: Fingerprint; machine?: { name: typeof MACHINE; createdAt: string; providerCreatedAt: string; executable: Fingerprint } };
const MACHINE = 'instrilo-deployment-tests';
const PROBE_TIMEOUT = 8_000;
const CHANGE_TIMEOUT = 600_000;
const INSTALL_DOCS = {
  docker: ['https://docs.docker.com/desktop/setup/install/mac-install/', 'https://docs.docker.com/engine/install/', 'https://docs.docker.com/desktop/setup/install/windows-install/'],
  podman: ['https://podman.io/docs/installation', 'https://docs.podman.io/en/latest/markdown/podman-machine.1.html'],
};

function engineId(engine: string): ContainerEngine {
  if (engine !== 'docker' && engine !== 'podman') throw new Error('Choose docker or podman.');
  return engine;
}
function stateDirectory() { return join(os.homedir(), '.local/share/instrilo/container-engines'); }
function receiptPath(engine: ContainerEngine) { return join(stateDirectory(), engine + '.json'); }
async function executable(binary: string): Promise<string | undefined> {
  const directories = [...(process.env.PATH ?? '').split(delimiter), join(os.homedir(), '.docker/bin')];
  const names = process.platform === 'win32' ? [binary + '.exe', binary] : [binary];
  for (const directory of [...new Set(directories)]) {
    if (!directory || !isAbsolute(directory)) continue;
    for (const name of names) {
      const path = join(directory, name);
      try { await access(path, constants.X_OK); if ((await stat(path)).isFile()) return path; } catch { /* Try the next absolute directory. */ }
    }
  }
  return undefined;
}
function notify(options: Operation, message: string) { try { options.onProgress?.(message); } catch { /* Progress callbacks do not own subprocesses. */ } }
function kill(child: ChildProcess) {
  try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { child.kill('SIGKILL'); }
}
async function run(command: string, args: string[], options: { signal?: AbortSignal; timeout?: number; env?: NodeJS.ProcessEnv } = {}): Promise<{ code: number; stdout: string }> {
  if (options.signal?.aborted) throw new Error('Container engine operation was cancelled.');
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', env: options.env ?? process.env });
    let stdout = '', bytes = 0, failure: Error | undefined, settled = false;
    const finish = (error?: Error, code = 1) => { if (settled) return; settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort); if (error) reject(error); else resolve({ code, stdout }); };
    const stop = (message: string) => { failure ??= new Error(message); kill(child); };
    const abort = () => stop('Container engine operation was cancelled.');
    const timer = setTimeout(() => stop('Container engine operation timed out. Inspect the official tool in a terminal.'), options.timeout ?? PROBE_TIMEOUT);
    options.signal?.addEventListener('abort', abort, { once: true }); if (options.signal?.aborted) abort();
    for (const [channel, stream] of [['stdout', child.stdout], ['stderr', child.stderr]] as const) stream?.on('data', (chunk: Buffer) => {
      bytes += chunk.length; if (bytes > 512 * 1024) { stop('Container engine output exceeded the diagnostic limit.'); return; }
      if (channel === 'stdout') stdout += chunk.toString('utf8');
    });
    child.once('error', () => finish(failure ?? new Error('The container engine command could not start. Check executable permissions and dependencies.')));
    child.once('close', code => finish(failure, code ?? 1));
  });
}
async function fingerprint(path: string): Promise<Fingerprint> { const metadata = await stat(path); return { path, realpath: await realpath(path), dev: metadata.dev, ino: metadata.ino }; }
async function sameExecutable(identity: Fingerprint, path: string): Promise<boolean> {
  try { const current = await fingerprint(path); return current.realpath === identity.realpath && current.dev === identity.dev && current.ino === identity.ino; } catch { return false; }
}
function validFingerprint(value: unknown): value is Fingerprint {
  const f = value as Fingerprint | undefined;
  return !!f && typeof f.path === 'string' && isAbsolute(f.path) && typeof f.realpath === 'string' && isAbsolute(f.realpath) && Number.isSafeInteger(f.dev) && Number.isSafeInteger(f.ino);
}
async function readReceipt(engine: ContainerEngine): Promise<Receipt | undefined> {
  let file;
  try {
    file = await open(receiptPath(engine), constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > 16_384 || (process.getuid && metadata.uid !== process.getuid()) || (metadata.mode & 0o022)) throw new Error('Container engine ownership receipt is unsafe; inspect its permissions.');
    const receipt = JSON.parse(await file.readFile('utf8')) as Receipt;
    if (receipt.schemaVersion !== 1 || receipt.engine !== engine || (receipt.installation && (!validFingerprint(receipt.installation) || !validFingerprint(receipt.brew) || receipt.package !== (engine === 'podman' ? 'podman' : 'docker-desktop'))) || (receipt.machine && (engine !== 'podman' || receipt.machine.name !== MACHINE || typeof receipt.machine.providerCreatedAt !== 'string' || !receipt.machine.providerCreatedAt || !validFingerprint(receipt.machine.executable)))) throw new Error('Container engine ownership receipt is invalid; no cleanup is authorized by it.');
    return receipt;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  finally { await file?.close(); }
}
async function ensureState() {
  await mkdir(stateDirectory(), { recursive: true, mode: 0o700 });
  const metadata = await lstat(stateDirectory());
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (process.getuid && metadata.uid !== process.getuid()) || (metadata.mode & 0o022)) throw new Error('Container engine state must be a private directory owned by the current user.');
}
async function writeReceipt(receipt: Receipt) {
  await ensureState();
  const file = await open(receiptPath(receipt.engine), constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(JSON.stringify(receipt, null, 2) + '\n'); } finally { await file.close(); }
}
async function locked<T>(engine: ContainerEngine, fn: () => Promise<T>): Promise<T> {
  await ensureState();
  const path = join(stateDirectory(), engine + '.lock'); let file;
  try { file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Another container engine operation is running. Wait for it to finish; inspect an abandoned lock before removing it.'); throw error; }
  try { await file.writeFile(JSON.stringify({ pid: process.pid, engine })); return await fn(); } finally { await file.close(); await unlink(path); }
}
function consent(options: Operation) { if (options?.consent !== true) throw new Error('This container engine change requires explicit consent to the displayed plan.'); if (options.removeMachineData !== undefined && typeof options.removeMachineData !== 'boolean') throw new Error('removeMachineData must be a boolean.'); if (options.signal?.aborted) throw new Error('Container engine operation was cancelled.'); }
function startupSteps(engine: ContainerEngine): string[] {
  if (engine === 'docker') return process.platform === 'darwin' ? ['Run instrilo deployment engine start docker --execute to open Docker Desktop.', 'Complete Docker Desktop first-run setup and review its subscription terms; wait for the engine to start.', 'Run instrilo deployment engine status docker.'] : ['Start Docker Desktop, or start your Linux Docker service using the official installation guide.', 'Use Linux containers, then run instrilo deployment engine status docker.'];
  return process.platform === 'darwin' ? ['Run instrilo deployment engine start podman --execute to create and start a dedicated Instrilo VM.', 'Run instrilo deployment engine status podman.'] : ['Configure rootless Podman using the distribution guide (user namespaces, /etc/subuid and /etc/subgid, networking).', 'Run podman info, then instrilo deployment engine status podman.'];
}

/** Fixed discovery and connection arguments for deployment tests. Never changes a system default. */
export async function containerEngineInvocation(input: ContainerEngine, options: { signal?: AbortSignal } = {}): Promise<{ executable: string; args: string[]; identity: string }> {
  const engine = engineId(input), path = await executable(engine);
  if (!path) throw new Error(`${engine} was not found. Run instrilo deployment engine install ${engine} to review setup.`);
  if (engine === 'podman' && (process.env.CONTAINER_HOST || process.env.CONTAINER_CONNECTION)) throw new Error('Local Podman tests require local rootless mode or the owned Instrilo VM. Unset CONTAINER_HOST/CONTAINER_CONNECTION before testing.');
  const receipt = await readReceipt(engine);
  if (engine === 'podman' && receipt?.machine) {
    if (!await sameExecutable(receipt.machine.executable, path)) throw new Error('The Podman executable changed since VM setup. Inspect the ownership receipt before using the managed VM.');
    const identity = await machineIdentity(path, options.signal);
    if (identity.created !== receipt.machine.providerCreatedAt) throw new Error('The named Podman VM was replaced after creation; ownership no longer matches.');
    const result = await run(path, ['system', 'connection', 'list', '--format', 'json'], options);
    let connections: unknown; try { connections = JSON.parse(result.stdout); } catch { /* Refuse below. */ }
    const connection = Array.isArray(connections) ? connections.find(c => c?.Name === MACHINE) : undefined;
    let uri: URL | undefined; try { uri = new URL(connection?.URI); } catch { /* Refuse below. */ }
    if (result.code !== 0 || !connection || connection.IsMachine !== true || connection.Identity !== identity.identityPath || !uri || uri.protocol !== 'ssh:' || uri.password || uri.search || uri.hash || !['127.0.0.1', 'localhost', '[::1]'].includes(uri.hostname) || Number(uri.port) !== identity.port || decodeURIComponent(uri.username) !== identity.username || !/^\/run\/user\/\d+\/podman\/podman.sock$/.test(uri.pathname)) throw new Error('The managed Podman connection no longer matches its local VM. Inspect the connection before deployment testing.');
    return { executable: path, args: ['--url', connection.URI, '--identity', connection.Identity], identity: engineIdentity(['podman', identity.created, connection.URI, connection.Identity]) };
  }
  if (engine === 'docker') {
    if (process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT) {
      if (!localEndpoint(process.env.DOCKER_HOST)) throw new Error('Local deployment tests refuse a remote DOCKER_HOST. Select a local Docker engine before testing.');
      return { executable: path, args: ['--host', process.env.DOCKER_HOST], identity: engineIdentity(['docker', process.env.DOCKER_HOST, process.env.DOCKER_TLS_VERIFY ?? '', process.env.DOCKER_CERT_PATH ?? '']) };
    }
    const requested = process.env.DOCKER_CONTEXT;
    if (requested && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(requested)) throw new Error('The selected Docker context name is invalid. Select a local context before testing.');
    const result = await run(path, ['context', 'inspect', ...(requested ? [requested] : [])], options);
    let parsed: any; try { parsed = JSON.parse(result.stdout); } catch { /* Refuse below. */ }
    const context = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : undefined;
    if (result.code !== 0 || typeof context?.Name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(context.Name) || !localEndpoint(context.Endpoints?.docker?.Host)) throw new Error('The selected Docker context is remote or could not be verified. Select a local Docker context before deployment testing.');
    if (context.Endpoints.docker.Host.startsWith('tcp:') && (context.Endpoints.docker.SkipTLSVerify || Object.keys(context.TLSMaterial ?? {}).length)) throw new Error('The local Docker TCP context uses TLS settings. Set explicit DOCKER_HOST, DOCKER_TLS_VERIFY, and DOCKER_CERT_PATH as appropriate, then unset DOCKER_CONTEXT so the reviewed endpoint and TLS settings can be pinned for testing.');
    return { executable: path, args: ['--host', context.Endpoints.docker.Host], identity: engineIdentity(['docker', context.Name, context.Endpoints.docker, context.TLSMaterial ?? {}, process.env.DOCKER_TLS_VERIFY ?? '', process.env.DOCKER_CERT_PATH ?? '']) };
  }
  if (process.platform !== 'linux') throw new Error('Local Podman testing on this platform requires the dedicated Instrilo VM. Run instrilo deployment engine start podman --execute on macOS, or use Linux/WSL.');
  const result = await run(path, ['--remote=false', 'info', '--format', '{{json .}}'], options);
  let info: any; try { info = JSON.parse(result.stdout); } catch { /* Refuse below. */ }
  if (result.code !== 0 || typeof info?.store?.graphRoot !== 'string' || !isAbsolute(info.store.graphRoot) || typeof info?.store?.runRoot !== 'string' || !isAbsolute(info.store.runRoot)) throw new Error('Local Podman storage identity could not be verified. Run podman info and complete rootless setup before testing.');
  return { executable: path, args: ['--remote=false'], identity: engineIdentity(['podman', info.store.graphRoot, info.store.runRoot, process.getuid?.() ?? '', os.homedir()]) };
}
function engineIdentity(values: unknown[]): string { return createHash('sha256').update(JSON.stringify(values)).digest('hex'); }
function localEndpoint(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 4096) return false;
  let endpoint: URL; try { endpoint = new URL(value); } catch { return false; }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return false;
  if (endpoint.protocol === 'unix:') return !endpoint.hostname && endpoint.pathname.startsWith('/') && endpoint.pathname.length > 1;
  if (endpoint.protocol === 'npipe:') return !endpoint.hostname && /^\/\/\.\/pipe\/[a-zA-Z0-9_.-]+$/.test(endpoint.pathname);
  return endpoint.protocol === 'tcp:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname) && !!endpoint.port && Number(endpoint.port) > 0 && ['/', ''].includes(endpoint.pathname);
}
export async function containerEngineStatus(input: ContainerEngine, options: { signal?: AbortSignal } = {}): Promise<ContainerEngineStatus> {
  const engine = engineId(input), path = await executable(engine);
  if (options.signal?.aborted) throw new Error('Container engine operation was cancelled.');
  const status: ContainerEngineStatus = { engine, installed: !!path, ...(path ? { path } : {}), ready: false, message: path ? 'The CLI is installed; the Linux engine has not been verified.' : 'The container CLI was not found.', nextSteps: path ? startupSteps(engine) : [`instrilo deployment engine install ${engine}`], warnings: ['A reachable engine does not prove support for the target CPU architecture; deployment testing checks that separately.'] };
  if (!path) return status;
  try {
    const version = await run(path, ['--version'], options);
    if (version.code === 0) status.version = version.stdout.match(/\b\d{1,6}\.\d{1,6}\.\d{1,6}\b/)?.[0];
    const invocation = await containerEngineInvocation(engine, options);
    if (engine === 'podman' && invocation.args[0] === '--url') status.connection = MACHINE;
    const result = await run(path, [...invocation.args, 'info', '--format', '{{json .}}'], options);
    let info: Record<string, any> = {}; try { info = JSON.parse(result.stdout); } catch { /* Unknown output cannot establish readiness. */ }
    const linux = engine === 'docker' ? info?.OSType === 'linux' : info?.host?.os === 'linux';
    status.ready = result.code === 0 && linux;
    status.message = status.ready ? (status.connection ? 'The dedicated Instrilo Podman VM is reachable and runs Linux containers.' : 'The selected engine is reachable and runs Linux containers.') : 'The CLI is installed, but a Linux engine is not reachable or its status is unrecognized.';
    if (status.ready) status.nextSteps = [];
    if (engine === 'docker' && (process.env.DOCKER_HOST || process.env.DOCKER_CONTEXT)) status.warnings.push('DOCKER_HOST or DOCKER_CONTEXT selects the engine. Confirm it is the engine you intend to use for local tests.');
    if (engine === 'podman' && !status.connection && (process.env.CONTAINER_HOST || process.env.CONTAINER_CONNECTION)) status.warnings.push('CONTAINER_HOST or CONTAINER_CONNECTION selects the engine. Confirm it is the engine you intend to use for local tests.');
  } catch (error) { if (options.signal?.aborted) throw error; status.message = 'The container engine check failed or timed out. Review setup in a terminal; provider diagnostics were not exposed.'; }
  return status;
}

export function containerEngineInstallPlan(input: ContainerEngine): ContainerEnginePlan {
  const engine = engineId(input), platform = process.platform, docs = [...INSTALL_DOCS[engine]];
  const plan: ContainerEnginePlan = { engine, platform, supported: platform === 'darwin', requiresConsent: true, docs, steps: [], impact: [] };
  if (platform === 'darwin') {
    plan.command = 'brew'; plan.args = engine === 'podman' ? ['install', 'podman'] : ['install', '--cask', 'docker-desktop'];
    plan.steps = ['Install Homebrew first from https://brew.sh if brew is not on PATH; Instrilo does not bootstrap a package manager.', 'Review this plan, then run instrilo deployment engine install ' + engine + ' --execute.', ...startupSteps(engine)];
    plan.impact = engine === 'podman' ? ['Installs the Homebrew Podman formula and its dependencies. The Podman project recommends its official .pkg installer; Homebrew is a community-maintained alternative.', 'A separate start step downloads a Linux VM and allocates CPU, memory, and disk. No VM is created during installation.'] : ['Installs Docker Desktop in Applications, supporting binaries, and launch integrations. macOS may require administrator authorization.', 'Review Docker Desktop license/subscription eligibility before use. First launch may require user interaction.'];
    plan.docs.push(engine === 'podman' ? 'https://formulae.brew.sh/formula/podman' : 'https://formulae.brew.sh/cask/docker-desktop');
  } else if (platform === 'linux') {
    plan.steps = engine === 'podman' ? ['Use the official Podman instructions for your distribution.', 'Debian/Ubuntu: sudo apt-get update, then sudo apt-get install podman. Fedora: sudo dnf install podman. Run these yourself after reviewing package changes.', ...startupSteps(engine)] : ['Select your distribution in the official Docker Engine installation guide and configure its package repository.', 'Install Docker Engine, the CLI, containerd, and the Buildx plugin as documented for that distribution.', 'Configure rootless Docker or authorized socket access. Do not make the Docker socket world-writable.', ...startupSteps(engine)];
    plan.impact = ['Distribution package installation, service setup, and rootless prerequisites can require administrator privileges. Instrilo provides instructions and does not run sudo.', 'Inside WSL2, either use the Linux distribution instructions or enable Docker Desktop WSL integration; do not assume Windows and WSL share the same CLI.'];
  } else if (platform === 'win32') {
    plan.steps = engine === 'docker' ? ['Install Docker Desktop using the official Windows installer and meet its supported Windows, WSL2, virtualization, and memory requirements.', 'Enable WSL2 and hardware virtualization; restart Windows if requested.', 'Enable Docker Desktop integration for the chosen WSL distribution. Run Instrilo inside that distribution and select Linux containers.'] : ['Use the official Podman Windows installer and enable WSL2/hardware virtualization.', 'Complete the Podman machine setup from the official installer or Podman Desktop.', 'Run Instrilo within WSL with a working Linux Podman CLI, or manage the Windows CLI explicitly in a terminal.'];
    plan.impact = ['WSL2 and virtualization setup can require administrator privileges and a reboot. Native Windows installer automation is not supported.'];
  } else { plan.steps = ['Use a supported Linux host, macOS, or Windows with WSL2 and follow the official installation guide.']; plan.impact = ['Instrilo has no verified automatic installation path for this operating system.']; }
  return plan;
}
export async function installContainerEngine(input: ContainerEngine, options: Operation): Promise<ContainerEngineStatus> {
  const engine = engineId(input); consent(options);
  return locked(engine, async () => {
    const existing = await executable(engine);
    if (existing) { notify(options, 'An existing container CLI was found; it will not be replaced or marked as Instrilo-owned.'); return containerEngineStatus(engine, options); }
    const plan = containerEngineInstallPlan(engine);
    if (!plan.supported || !plan.command || !plan.args) throw new Error('Automatic installation is unavailable on this platform. Follow the displayed official installation steps.');
    const brew = await executable('brew'); if (!brew) throw new Error('Homebrew was not found on PATH. Follow the displayed package-manager or official installer instructions.');
    const packageName = engine === 'podman' ? 'podman' : 'docker-desktop';
    const preexisting = await run(brew, ['list', ...(engine === 'docker' ? ['--cask'] : ['--formula']), '--versions', packageName], options);
    if (preexisting.code === 0) throw new Error('The package is already installed by Homebrew. Repair PATH or complete first-run setup; Instrilo will not claim ownership.');
    if (preexisting.code !== 1) throw new Error('Homebrew could not establish that the package is absent; installation was not attempted.');
    if (engine === 'docker') { try { await lstat('/Applications/Docker.app'); throw new Error('Docker Desktop already exists in Applications. Complete its setup; Instrilo will not replace it.'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
    notify(options, 'Installing the reviewed Homebrew package. First-run prompts may still need completion in a terminal or desktop app.');
    const result = await run(brew, plan.args, { ...options, timeout: CHANGE_TIMEOUT, env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_INSTALL_CLEANUP: '1', NONINTERACTIVE: '1' } });
    if (result.code !== 0) throw new Error('Container engine installation did not complete. Review the official installer in a terminal; a partial installation may need manual cleanup.');
    const path = await executable(engine);
    if (!path) throw new Error('The installer completed but the CLI is not on PATH. Reopen your terminal and inspect the installation; ownership has not been assumed.');
    const receipt = await readReceipt(engine) ?? { schemaVersion: 1, engine };
    receipt.installation = await fingerprint(path); receipt.brew = await fingerprint(brew); receipt.package = packageName; receipt.installedAt = new Date().toISOString();
    await writeReceipt(receipt);
    notify(options, 'Installation ownership recorded. Checking whether the engine is running.');
    return containerEngineStatus(engine, options);
  });
}

export function containerEngineStartPlan(input: ContainerEngine): ContainerEnginePlan {
  const engine = engineId(input), plan: ContainerEnginePlan = { engine, platform: process.platform, supported: process.platform === 'darwin', steps: startupSteps(engine), docs: [...INSTALL_DOCS[engine]], requiresConsent: true, impact: [] };
  if (process.platform !== 'darwin') { plan.impact = ['Start the installed engine using the official platform instructions. Instrilo will not start privileged system services.']; return plan; }
  if (engine === 'docker') { plan.command = 'open'; plan.args = ['-a', 'Docker']; plan.impact = ['Opens the installed Docker Desktop application. Complete license and first-run prompts yourself. Readiness is checked separately.']; }
  else {
    plan.command = 'podman'; plan.args = ['machine', 'init', '--cpus', '2', '--memory', '4096', '--disk-size', '20', MACHINE];
    plan.commands = [{ command: 'podman', args: plan.args }, { command: 'podman', args: ['machine', 'start', '--update-connection=false', MACHINE] }];
    plan.impact = ['Creates only a new VM named ' + MACHINE + ' (2 CPUs, 4 GiB memory, 20 GiB maximum guest disk); downloads the vendor VM image.', 'Podman may mount your home directory according to its standard machine configuration. Review containers.conf before proceeding if you require different mounts.', 'An existing Instrilo-owned VM is started without reinitialization. An unowned VM with this name is never adopted. A different running VM is left running and startup is refused.', 'Instrilo uses this VM through an explicit connection argument. Your default Podman connection is not changed.'];
    plan.docs.push('https://docs.podman.io/en/latest/markdown/podman-machine-init.1.html', 'https://docs.podman.io/en/latest/markdown/podman-machine-start.1.html');
  }
  return plan;
}
async function machines(path: string, signal?: AbortSignal): Promise<{ Name: string; Running: boolean }[]> {
  const result = await run(path, ['machine', 'list', '--format', 'json'], { signal });
  let parsed: unknown; try { parsed = JSON.parse(result.stdout); } catch { /* Fail closed below. */ }
  if (result.code !== 0 || !Array.isArray(parsed) || parsed.some(m => !m || typeof m.Name !== 'string' || typeof m.Running !== 'boolean')) throw new Error('Podman machine inventory could not be verified. No VM was changed.');
  return parsed;
}
async function machineIdentity(path: string, signal?: AbortSignal): Promise<{ created: string; port: number; identityPath: string; username: string }> {
  const result = await run(path, ['machine', 'inspect', MACHINE], { signal });
  let parsed: any; try { parsed = JSON.parse(result.stdout); } catch { /* Refuse below. */ }
  const machine = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : undefined;
  if (result.code !== 0 || machine?.Name !== MACHINE || typeof machine.Created !== 'string' || !machine.Created || !Number.isInteger(machine.SSHConfig?.Port) || machine.SSHConfig.Port <= 0 || typeof machine.SSHConfig.IdentityPath !== 'string' || !isAbsolute(machine.SSHConfig.IdentityPath) || typeof machine.SSHConfig.RemoteUsername !== 'string') throw new Error('The named Podman VM identity could not be verified. It was not modified.');
  return { created: machine.Created, port: machine.SSHConfig.Port, identityPath: machine.SSHConfig.IdentityPath, username: machine.SSHConfig.RemoteUsername };
}
export async function startContainerEngine(input: ContainerEngine, options: Operation): Promise<ContainerEngineStatus> {
  const engine = engineId(input); consent(options);
  return locked(engine, async () => {
    const plan = containerEngineStartPlan(engine);
    if (!plan.supported) throw new Error('Automatic startup is unavailable on this platform. Follow the displayed startup instructions.');
    const path = await executable(engine); if (!path) throw new Error(`Install ${engine} first with instrilo deployment engine install ${engine}.`);
    if (engine === 'docker') {
      notify(options, 'Opening Docker Desktop. Complete any first-run prompts in the application.');
      const result = await run('/usr/bin/open', ['-a', 'Docker'], options);
      if (result.code !== 0) throw new Error('Docker Desktop could not be opened. Open it manually from Applications.');
      return containerEngineStatus(engine, options);
    }
    const receipt: Receipt = await readReceipt(engine) ?? { schemaVersion: 1, engine };
    const inventory = await machines(path, options.signal), target = inventory.find(m => m.Name === MACHINE);
    if (inventory.some(m => m.Name !== MACHINE && m.Running)) throw new Error('Another Podman VM is running. Stop it yourself before starting the Instrilo VM; it was not changed.');
    if (target && !receipt.machine) throw new Error('A VM with the Instrilo name already exists without an ownership receipt. It will not be adopted or modified.');
    if (receipt.machine && !await sameExecutable(receipt.machine.executable, path)) throw new Error('Podman changed since VM creation. Inspect ownership before starting or cleaning the VM.');
    if (target && receipt.machine && (await machineIdentity(path, options.signal)).created !== receipt.machine.providerCreatedAt) throw new Error('The named Podman VM was replaced after creation. It will not be modified.');
    if (!target) {
      notify(options, 'Creating the reviewed dedicated Podman VM.');
      const result = await run(path, plan.args!, { ...options, timeout: CHANGE_TIMEOUT });
      if (result.code !== 0) throw new Error('Podman VM initialization failed. Inspect the named VM in a terminal; a partial VM is not automatically adopted.');
      receipt.machine = { name: MACHINE, createdAt: new Date().toISOString(), providerCreatedAt: (await machineIdentity(path, options.signal)).created, executable: await fingerprint(path) }; await writeReceipt(receipt);
    }
    if (!target?.Running) {
      notify(options, 'Starting the dedicated VM without changing the default Podman connection.');
      const result = await run(path, ['machine', 'start', '--update-connection=false', MACHINE], { ...options, timeout: CHANGE_TIMEOUT });
      if (result.code !== 0) throw new Error('The Instrilo Podman VM could not start. Its ownership receipt was retained for retry or cleanup.');
    }
    return containerEngineStatus(engine, options);
  });
}

/** The plan is advisory; execute repeats ownership and workload checks under a lock. */
export async function containerEngineCleanupPlan(input: ContainerEngine, options: { removeMachineData?: boolean; signal?: AbortSignal } = {}): Promise<ContainerEnginePlan> {
  if (options.removeMachineData !== undefined && typeof options.removeMachineData !== 'boolean') throw new Error('removeMachineData must be a boolean.');
  const engine = engineId(input), receipt = await readReceipt(engine);
  const owned = !!(receipt?.installation || receipt?.machine);
  const plan: ContainerEnginePlan = { engine, platform: process.platform, supported: owned && process.platform === 'darwin' && engine === 'podman', owned, requiresConsent: true, docs: [...INSTALL_DOCS[engine]], steps: [], impact: ['Only resources with a matching Instrilo ownership receipt are candidates. Runtime removal affects every application using that runtime.', 'Cleanup refuses unknown or foreign workloads; it never runs a global prune, system reset, brew autoremove, or credential/configuration deletion.'] };
  if (!owned) { plan.blockedReason = 'No owned runtime or VM was recorded. Pre-existing installations are never uninstalled by Instrilo.'; plan.steps = ['Clean individual deployment-test resources using instrilo deployment cleanup.', 'If you separately intend to remove the shared engine, follow its official uninstall guide after backing up its data.']; }
  else if (engine === 'docker') { plan.supported = false; plan.blockedReason = 'Docker Desktop can hold data and integrations beyond the selected context. Automatic full uninstallation cannot safely prove those are unused.'; plan.steps = ['Clean Instrilo test resources first.', 'Open Docker Desktop and review all containers, images, volumes, Kubernetes data, extensions, and contexts.', 'Use Docker Desktop Troubleshoot > Uninstall only after reviewing the official uninstall guide. This can destroy local Docker data.']; plan.docs.push('https://docs.docker.com/desktop/uninstall/'); }
  else {
    plan.commands = [];
    if (receipt?.machine) plan.commands.push({ command: 'podman', args: ['machine', 'rm', '--force', MACHINE] });
    if (receipt?.installation) plan.commands.push({ command: 'brew', args: ['uninstall', '--formula', 'podman'] });
    plan.steps = ['Run instrilo deployment cleanup for each test run first.', 'Keep the owned VM running for fresh rootless and rootful workload checks. Empty foreign/default VM inventory is required before package removal.', 'Review this plan, then run instrilo deployment engine cleanup podman --execute.'];
    plan.impact.push('Removing the owned VM deletes its disk, generated connections, and VM files after checking it for foreign workloads.', 'Only the Podman formula itself is removed if Instrilo installed it. Homebrew, shared dependencies, download caches, and user configuration are retained for manual review.');
    plan.docs.push('https://docs.podman.io/en/latest/markdown/podman-machine-rm.1.html');
    if (options.removeMachineData) {
      if (!receipt?.machine) { plan.supported = false; plan.blockedReason = 'Removing machine data requires an Instrilo-owned VM receipt.'; return plan; }
      const path = await executable(engine);
      if (!path || !await sameExecutable(receipt.machine.executable, path) || (await machineIdentity(path, options.signal)).created !== receipt.machine.providerCreatedAt) throw new Error('The owned VM identity changed; its data cannot be scheduled for removal.');
      plan.machineStorage = { machine: MACHINE, rootless: await storageInventory(path, ['machine', 'ssh', MACHINE, 'podman'], options.signal), rootful: await storageInventory(path, ['machine', 'ssh', '--username', 'root', MACHINE, 'podman'], options.signal) };
      plan.impact = plan.impact.filter(line => !line.includes('refuses unknown or foreign workloads'));
      plan.impact.push('REMOVE MACHINE DATA: permanently deletes the entire owned VM disk, including every listed container, image, volume, custom network, downloaded base image, build cache, and any other files inside that VM. This includes work you added to this VM outside Instrilo. Host home-directory mounts are not deleted.', 'This explicit option applies only to the verified receipt-owned VM. Other machines, their disks, and shared host storage are never targeted.');
      plan.steps[2] = 'Review machineStorage and the whole-disk deletion impact, then run instrilo deployment engine cleanup podman --remove-machine-data --execute.';
    }
  }
  return plan;
}
async function storageInventory(path: string, prefix: string[], signal?: AbortSignal): Promise<StorageInventory> {
  const inventory: StorageInventory = { containers: [], images: [], volumes: [], networks: [] };
  for (const [key, args] of [['containers', ['ps', '--all', '--quiet']], ['images', ['images', '--quiet']], ['volumes', ['volume', 'ls', '--quiet']], ['networks', ['network', 'ls', '--format', '{{.Name}}']]] as const) {
    const result = await run(path, [...prefix, ...args], { signal });
    if (result.code !== 0) throw new Error('Runtime storage could not be fully inspected. Start the owned VM, then retry cleanup.');
    const items = [...new Set(result.stdout.trim().split(/\r?\n/).filter(Boolean))];
    if (items.length > 1000 || items.some(value => !/^[a-zA-Z0-9_.:/-]{1,256}$/.test(value))) throw new Error('The runtime storage inventory is unrecognized or exceeds the review limit. Inspect it manually before cleanup.');
    inventory[key] = items;
  }
  return inventory;
}
function requireEmpty(inventory: StorageInventory) {
  if (inventory.containers.length || inventory.images.length || inventory.volumes.length) throw new Error('The runtime contains containers, images, or volumes. Clean reviewed test resources first; foreign or unclassified data is never deleted automatically. Use --remove-machine-data only after reviewing the owned VM whole-disk deletion plan.');
  if (inventory.networks.some(name => !['podman', 'bridge', 'host', 'none'].includes(name))) throw new Error('The runtime contains an unknown network. Review it before cleanup.');
}
export async function cleanupContainerEngine(input: ContainerEngine, options: Operation): Promise<{ engine: ContainerEngine; removed: string[]; retained: string[]; message: string }> {
  const engine = engineId(input); consent(options);
  return locked(engine, async () => {
    const plan = await containerEngineCleanupPlan(engine, options);
    if (!plan.supported) throw new Error(plan.blockedReason ?? 'Automatic cleanup is unavailable on this platform. Follow the displayed manual cleanup instructions.');
    const receipt = (await readReceipt(engine))!, path = await executable(engine);
    if (!path) throw new Error('The runtime executable is missing. Review the ownership receipt and manual cleanup instructions.');
    if (receipt.installation && !await sameExecutable(receipt.installation, path)) throw new Error('The runtime executable changed after installation. Automatic package removal was refused.');
    if (receipt.machine && !await sameExecutable(receipt.machine.executable, path)) throw new Error('The VM executable no longer matches the ownership receipt. Cleanup was refused.');
    const inventory = await machines(path, options.signal);
    if (receipt.installation && inventory.some(m => m.Name !== receipt.machine?.name)) throw new Error('Other Podman VMs exist. The shared package will not be removed.');
    const removed: string[] = [], retained = ['Homebrew and its shared dependencies', 'Host user configuration, credentials, and download caches'];
    const target = inventory.find(m => m.Name === receipt.machine?.name);
    if (target) {
      if ((await machineIdentity(path, options.signal)).created !== receipt.machine!.providerCreatedAt) throw new Error('The named Podman VM was replaced after creation. Cleanup was refused.');
      if (!target.Running) throw new Error('Start the owned Podman VM so both rootless and rootful storage can be checked before deletion.');
      // Query the exact machine, rather than a user-editable connection pointing elsewhere.
      const rootless = await storageInventory(path, ['machine', 'ssh', MACHINE, 'podman'], options.signal);
      const rootful = await storageInventory(path, ['machine', 'ssh', '--username', 'root', MACHINE, 'podman'], options.signal);
      if (!options.removeMachineData) { requireEmpty(rootless); requireEmpty(rootful); }
    } else if (receipt.installation && !receipt.machine && inventory.length === 0) {
      // A package that was never given a VM has no local VM storage to delete.
    }
    if (receipt.installation) {
      const connections = await run(path, ['system', 'connection', 'list', '--format', 'json'], { signal: options.signal });
      let parsed: unknown; try { parsed = JSON.parse(connections.stdout); } catch { /* Refuse below. */ }
      if (connections.code !== 0 || !Array.isArray(parsed) || parsed.some(c => !c || typeof c.Name !== 'string' || ![MACHINE, MACHINE + '-root'].includes(c.Name) || !receipt.machine)) throw new Error('Other or unrecognized Podman connections exist. Package removal could affect shared workloads and was refused.');
      if (!receipt.brew || !await sameExecutable(receipt.brew, receipt.brew.path)) throw new Error('Homebrew changed or cannot be verified. Automatic uninstallation was refused.');
      const users = await run(receipt.brew.path, ['uses', '--installed', 'podman'], options);
      if (users.code !== 0 || users.stdout.trim()) throw new Error('Another Homebrew package may depend on Podman. Automatic uninstallation was refused.');
    }
    if (target) {
      notify(options, options.removeMachineData ? 'Removing the explicitly reviewed owned Podman VM and its entire disk.' : 'Removing only the owned, empty Podman VM.');
      const result = await run(path, ['machine', 'rm', '--force', MACHINE], { ...options, timeout: CHANGE_TIMEOUT });
      if (result.code !== 0) throw new Error('Owned VM removal did not complete. Its receipt was retained for inspection.');
      removed.push('Podman VM ' + MACHINE);
    }
    if (receipt.machine) { delete receipt.machine; await writeReceipt(receipt); }
    if (receipt.installation) {
      notify(options, 'Uninstalling only the Podman package recorded as newly installed by Instrilo.');
      const result = await run(receipt.brew!.path, ['uninstall', '--formula', 'podman'], { ...options, timeout: CHANGE_TIMEOUT, env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_AUTOREMOVE: '1', NONINTERACTIVE: '1' } });
      if (result.code !== 0) throw new Error('Package removal did not complete. Its ownership receipt was retained for inspection.');
      removed.push('Homebrew Podman formula');
    } else retained.push('The pre-existing Podman installation');
    await unlink(receiptPath(engine));
    return { engine, removed, retained, message: options.removeMachineData ? 'The reviewed owned VM and its disk were removed. Shared dependencies and host user configuration were retained.' : 'Owned container dependencies were removed. Shared dependencies and host user configuration were retained.' };
  });
}
