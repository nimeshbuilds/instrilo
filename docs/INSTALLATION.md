# Install Instrilo

Choose a built release or a source build. Both provide the same local app and CLI.

The [v0.2.2 GitHub release](https://github.com/nimeshbuilds/instrilo/releases/tag/v0.2.2) includes the built CLI and local browser app in one package. Install once, then use `instrilo` from any project folder. You do not need Git, a source checkout, or a TypeScript build for normal use.

## Requirements

- [Node.js 22 or newer and npm](https://nodejs.org/en/download). Check them with `node --version` and `npm --version`.
- macOS, Linux, or Windows with [WSL](https://learn.microsoft.com/en-us/windows/wsl/install). Native Windows operation is not yet verified.
- Network access to GitHub and the npm registry during installation. The release contains compiled Instrilo code; npm fetches its runtime dependencies.
- Python projects additionally need Python 3.11–3.13 and [uv](https://docs.astral.sh/uv/getting-started/installation/). They are unnecessary for opening the app or creating TypeScript agents.

This package starts a local browser application. It is not a native desktop binary, an offline installer, or an npm registry publication. Model accounts and container/cloud dependencies are only needed when you choose those workflows.

## Download and install the release

Run these commands in Bash or zsh:

```sh
npm install --global https://github.com/nimeshbuilds/instrilo/releases/download/v0.2.2/nimeshbuilds-instrilo-0.2.2.tgz
instrilo --version
instrilo web enable
```

The version command should print `0.2.2`. `instrilo web enable` opens the app in your default browser and chooses an available port. It uses `~/Instrilo/projects` as a stable home for projects, regardless of your current directory. Keep the terminal running, and stop the app with Ctrl+C. Running the command again reopens those projects.

## Build from source instead

With [Git](https://git-scm.com/downloads) installed:

```sh
git clone https://github.com/nimeshbuilds/instrilo.git
cd instrilo
npm ci --ignore-scripts
npm run build
node dist/cli.js web enable
```

That final command opens the same local app. No global link is required. For the other CLI examples in this guide, replace `instrilo` with `node dist/cli.js` from the repository root. Optionally run `npm link` to use `instrilo` from any directory; if you already have a release installed, choose which global installation you intend to keep first. See [source-link migration](#replace-a-source-linked-installation).

## Open, customize, and stop the app

After a release or linked installation, just run:

```sh
instrilo web enable
```

`instrilo web` is a shorthand for the same behavior. To customize it:

```sh
instrilo web enable --workspace ./my-projects
instrilo web enable --port 4317
instrilo web enable --no-open
instrilo help web enable
instrilo explain web
```

`--workspace` chooses a different project directory. `--port` chooses a fixed port; use `0` or omit it to select an available port. `--no-open` starts the server and prints the URL without trying to launch a browser. This is useful in SSH sessions or headless environments. Open that URL in a browser that can reach the machine's loopback address. WSL browser opening depends on the local WSL/browser setup; the printed URL is always available.

The app stays in the foreground: leave the terminal running while you use it. Ctrl+C stops the app without deleting projects. It does not install a background service or configure startup at login. The server listens on `127.0.0.1`, and the session URL contains a private access token. Use the newly printed URL after each restart.

If browser launching fails, the server keeps running and prints the URL for manual opening. The earlier `instrilo app` command retains its existing server-only behavior and defaults; `instrilo app --workspace ./my-projects --port 0 --open` also opens the browser.

The release also includes the `in` and `nb-agent` aliases. All three commands provide the same features. In Bash and POSIX sh, `in` is a reserved word, so use `command in help --all`. In zsh, `in help --all` also works.

## Install without administrator access

If the first command reports a permission error, choose a directory you own instead of using `sudo`. This does not change your npm configuration:

```sh
mkdir -p "$HOME/.local/instrilo"
npm install --global --prefix "$HOME/.local/instrilo" https://github.com/nimeshbuilds/instrilo/releases/download/v0.2.2/nimeshbuilds-instrilo-0.2.2.tgz
export PATH="$HOME/.local/instrilo/bin:$PATH"
instrilo --version
instrilo web enable
```

To keep that PATH in new terminals, add this line once to `~/.zshrc` for zsh or `~/.bashrc` for Bash, then open a new terminal:

```sh
export PATH="$HOME/.local/instrilo/bin:$PATH"
```

A Bash login shell may use `~/.bash_profile`; if yours does not already load `~/.bashrc`, place the line in that file instead. You can always bypass PATH configuration with `"$HOME/.local/instrilo/bin/instrilo" help --all`.

Use the same `--prefix "$HOME/.local/instrilo"` when upgrading or uninstalling this installation.

## Start from the CLI

No model credentials are needed for this first demo. Choose a fresh project name if `first-agent` already exists:

```sh
instrilo help --all
instrilo explain --list
instrilo init first-agent --directory "$HOME/Instrilo/projects" --language typescript
instrilo build "$HOME/Instrilo/projects/first-agent"
instrilo prepare "$HOME/Instrilo/projects/first-agent"
instrilo run "$HOME/Instrilo/projects/first-agent" --input "Hello from Instrilo"
```

`prepare` downloads the generated agent's dependencies. The initial runtime is an explicit offline demo; its output checks the local workflow and is not a real model response. To use your own product guidance, see `instrilo help create` and `instrilo explain guidance`. For provider setup, use `instrilo explain subscriptions` and the [authentication guide](AUTHENTICATION.md).

The [complete CLI manual](CLI.md) is also available offline through `instrilo help --all` and `instrilo explain --all`.

## Download and verify before installation

Open the [release assets](https://github.com/nimeshbuilds/instrilo/releases/tag/v0.2.2), download `nimeshbuilds-instrilo-0.2.2.tgz` and `SHA256SUMS` into an empty directory, and follow that release's included `INSTALL.md` instructions to verify SHA-256 before installation. A checksum detects a damaged or changed download; compare against the trusted release page.

You can then install the downloaded archive directly from that directory:

```sh
npm install --global ./nimeshbuilds-instrilo-0.2.2.tgz
instrilo --version
```

This still downloads runtime dependencies. Add the user-owned `--prefix` option above if needed. See the release's verification reports and [repository verification record](VERIFICATION.md) for the tested paths and their limits.

## Upgrade

Stop the app with Ctrl+C. Open the [releases page](https://github.com/nimeshbuilds/instrilo/releases), read the target release's notes, then install its exact package URL. To install or reinstall this version:

```sh
npm install --global https://github.com/nimeshbuilds/instrilo/releases/download/v0.2.2/nimeshbuilds-instrilo-0.2.2.tgz
instrilo --version
```

For a user-owned prefix, include `--prefix "$HOME/.local/instrilo"`. The package installation does not move or delete your project workspace. Keep project backups before upgrading, and review generation plans before applying new generated artifacts. Installing an older CLI is not a substitute for restoring a compatible project backup.

## Replace a source-linked installation

If you previously ran `npm link`, remove that global link before installing the release. This leaves your source checkout and project folders intact:

```sh
npm uninstall --global @nimeshbuilds/instrilo
npm install --global https://github.com/nimeshbuilds/instrilo/releases/download/v0.2.2/nimeshbuilds-instrilo-0.2.2.tgz
instrilo --version
```

Use the prefix associated with the old link if it differs from npm's current global prefix. `npm prefix --global` prints the current prefix; `command -v instrilo` shows which command your shell will use. If several installations exist, keep PATH pointed at the one you intend to run. Do not use `--force` to overwrite unrelated executables.

## Uninstall

Stop the running app, then remove the package:

```sh
npm uninstall --global @nimeshbuilds/instrilo
```

If you used the user-owned prefix:

```sh
npm uninstall --global --prefix "$HOME/.local/instrilo" @nimeshbuilds/instrilo
```

This removes the installed app and its command aliases. It leaves your projects, reports, generated environments, provider logins, and any separately installed container engine intact. Remove the PATH line if you no longer use that prefix. Review project folders before deleting them yourself. Instrilo's deployment cleanup commands separately handle the exact container resources it owns; see the [deployment guide](DEPLOYMENT.md).

## Source installation for the ten walkthroughs

The published quickstarts use repository fixtures and exact `node dist/cli.js` commands. Complete [Build from source instead](#build-from-source-instead), stop the app with Ctrl+C if it is running, and follow a guide from that repository root in one Bash session. The [ten scenario guides](https://nimeshbuilds.github.io/instrilo/#quickstarts) label the fixture checks and any optional live-account steps.

Keep a source checkout separate from your global release installation. Normal release use does not require the walkthrough fixtures; [Start from the CLI](#start-from-the-cli) above works immediately after installation. Contributors can launch directly from TypeScript with `npm run cli -- web enable`.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `instrilo: command not found` | Run `npm prefix --global`; its `bin` directory must be in PATH. For the user-owned installation, add `$HOME/.local/instrilo/bin` or invoke its full command path. |
| Permission error during installation | Use the user-owned prefix instructions; no administrator access is needed for that directory. |
| Unsupported engine or syntax error | Check `node --version` is at least 22, and `command -v node` points to the intended installation. Reopen the terminal after changing Node. |
| `in` produces a shell syntax error | Use `command in` or the full name `instrilo`. |
| Browser does not open | The app should remain running. Open the complete printed session URL, or use `--no-open` to skip launching. Check the default browser or use a browser that can reach that loopback address. |
| Port already in use | Omit `--port` or use `--port 0` to choose an available port. |
| App URL no longer works | Restart the app and use the newly printed URL; each session has its own token. Keep the same workspace path to reopen projects. |
| Model setup or cloud deployment fails | Installation alone does not authenticate providers or configure cloud accounts. Use `instrilo doctor PROJECT`, `instrilo explain subscriptions`, and the generated deployment runbook. |
| The wrong CLI version runs | Check `instrilo --version`, `command -v instrilo`, and `npm prefix --global`; remove or update the older installation at its own prefix. |

For an issue report, include your OS, Node/npm and Instrilo versions, installation command, and a redacted error. Never include credentials or a private local app session URL.
