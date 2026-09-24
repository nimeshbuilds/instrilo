import type { Command } from 'commander';
import { spawn } from 'node:child_process';
import { homedir, release } from 'node:os';
import { join } from 'node:path';
import { startServer } from './server.js';

interface WebOptions { workspace: string; port: string; open: boolean }
interface BrowserCommand { command: string; args: string[]; env: NodeJS.ProcessEnv }
export type BrowserResult = 'opened' | 'unavailable' | 'timed-out' | 'cancelled';

export function parseWebPort(value: string): number {
  if (!/^\d+$/.test(value) || Number(value) > 65535) throw new Error('Port must be a whole number from 0 to 65535. Use 0 to choose an available port.');
  return Number(value);
}

export function expandWebWorkspace(workspace: string): string {
  return workspace === '~' ? homedir() : workspace.startsWith('~/') ? join(homedir(), workspace.slice(2)) : workspace;
}

/** Keep the URL as a single argument or environment value, never interpolated into shell code. */
export function browserCommands(url: string, platform = process.platform, env = process.env, osRelease = release()): BrowserCommand[] {
  if (platform === 'darwin') return [{ command: 'open', args: [url], env }];
  if (platform === 'win32') return [{ command: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:INSTRILO_BROWSER_URL -ErrorAction Stop'], env: { ...env, INSTRILO_BROWSER_URL: url } }];
  if (platform === 'linux') {
    const commands = env.WSL_DISTRO_NAME || env.WSL_INTEROP || /microsoft/i.test(osRelease) ? ['wslview', 'explorer.exe', 'xdg-open'] : ['xdg-open'];
    return commands.map(command => ({ command, args: [url], env }));
  }
  return [];
}

/** A browser handoff is optional. Failure must never take down the already listening application. */
export async function openBrowser(url: string, options: { signal: AbortSignal; timeoutMs?: number; platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; osRelease?: string }): Promise<BrowserResult> {
  const deadline = Date.now() + (options.timeoutMs ?? 5000);
  for (const opener of browserCommands(url, options.platform, options.env, options.osRelease)) {
    if (options.signal.aborted) return 'cancelled';
    const remaining = deadline - Date.now();
    if (remaining <= 0) return 'timed-out';
    const result = await new Promise<BrowserResult>(resolve => {
      const child = spawn(opener.command, opener.args, { env: opener.env, shell: false, stdio: 'ignore', windowsHide: true, detached: true });
      let finished = false;
      const finish = (value: BrowserResult) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        options.signal.removeEventListener('abort', abort);
        child.unref();
        resolve(value);
      };
      // Some desktop openers become the browser process. Release the handoff after the
      // bounded wait; never close a user's browser when the app stops or the wait expires.
      const abort = () => finish('cancelled');
      const timer = setTimeout(() => finish('timed-out'), remaining);
      options.signal.addEventListener('abort', abort, { once: true });
      if (options.signal.aborted) abort();
      child.once('error', () => finish('unavailable'));
      child.once('close', code => finish(code === 0 ? 'opened' : 'unavailable'));
    });
    if (result !== 'unavailable') return result;
  }
  return options.signal.aborted ? 'cancelled' : 'unavailable';
}

export async function launchWebApp(options: WebOptions) {
  const port = parseWebPort(options.port);
  const controller = new AbortController();
  let app: Awaited<ReturnType<typeof startServer>> | undefined;
  let stopping = false;
  const cleanListeners = () => { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); };
  const stop = () => {
    controller.abort();
    if (app && !stopping) {
      stopping = true;
      app.server.close();
      app.server.closeAllConnections();
    }
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    app = await startServer({ workspace: expandWebWorkspace(options.workspace), port });
    app.server.once('close', cleanListeners);
    if (controller.signal.aborted) { stop(); return app; }
    console.log(`\nInstrilo\n${app.url}\n\nWorkspace: ${app.workspace}\nLocal access only. Keep the session URL private.\nKeep this terminal open. Press Ctrl-C to stop the web app.\n`);
    if (options.open) {
      const result = await openBrowser(app.url, { signal: controller.signal });
      if (result === 'opened') console.log('Browser handoff complete. If no tab appeared, open the private session URL above.');
      else if (result !== 'cancelled') console.error(`The browser ${result === 'timed-out' ? 'handoff timed out' : 'could not be opened automatically'}. The web app is still running. Open the private session URL above in your browser, or use --no-open for a headless session.`);
    }
    return app;
  } catch (error) {
    stop();
    cleanListeners();
    throw error;
  }
}

function webOptions(command: Command, workspace: string, port: string, autoOpen: boolean) {
  return command.option('--workspace <directory>', 'directory containing your projects', workspace)
    .option('--port <number>', 'local HTTP port; 0 chooses an available port', port)
    .option('--open', 'open the authenticated app URL in your default browser', autoOpen)
    .option('--no-open', 'print the authenticated URL without opening a browser');
}

export function registerWebCommands(program: Command) {
  const workspace = '~/Instrilo/projects';
  const web = webOptions(program.command('web').description('Start the local web app and open your browser. Keep this terminal open; Ctrl-C stops it.'), workspace, '0', true);
  web.action(async options => { await launchWebApp(options); });
  webOptions(web.command('enable').description('Start and open the web app for this terminal session; equivalent to instrilo web.'), workspace, '0', true)
    .action(async (options: WebOptions, command: Command) => {
      // Accept options on either side of "enable"; an explicit child option wins over a parent default.
      for (const key of ['workspace', 'port', 'open'] as const) {
        if (command.getOptionValueSource(key) === 'default' && web.getOptionValueSource(key) !== 'default') (options as any)[key] = web.opts()[key];
      }
      await launchWebApp(options);
    });
  webOptions(program.command('app').description('Start the local web app with legacy workspace/port defaults; add --open to open your browser.'), '.studio/projects', '4317', false)
    .action(async options => { await launchWebApp(options); });
}
