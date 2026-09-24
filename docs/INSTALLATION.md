# Install Instrilo

The [v0.2.1 GitHub release](https://github.com/nimeshbuilds/instrilo/releases/tag/v0.2.1) includes the built CLI and local browser app in one package. Install once, then use `instrilo` from any project folder. You do not need Git, a source checkout, or a TypeScript build for normal use.

## Requirements

- [Node.js 22 or newer and npm](https://nodejs.org/en/download). Check them with `node --version` and `npm --version`.
- macOS, Linux, or Windows with [WSL](https://learn.microsoft.com/en-us/windows/wsl/install). Native Windows operation is not yet verified.
- Network access to GitHub and the npm registry during installation. The release contains compiled Instrilo code; npm fetches its runtime dependencies.
- Python projects additionally need Python 3.11–3.13 and [uv](https://docs.astral.sh/uv/getting-started/installation/). They are unnecessary for opening the app or creating TypeScript agents.

This package starts a local browser application. It is not a native desktop binary, an offline installer, or an npm registry publication. Model accounts and container/cloud dependencies are only needed when you choose those workflows.

## Install and open the app

Run these commands in Bash or zsh:

```sh
npm install --global https://github.com/nimeshbuilds/instrilo/releases/download/v0.2.1/nimeshbuilds-instrilo-0.2.1.tgz
instrilo --version
instrilo app --workspace "$HOME/Instrilo/projects" --port 0
```

The version command should print `0.2.1`. Open the local session URL printed by the app and leave the terminal running. `--port 0` chooses an available port; the workspace path gives your projects a stable home regardless of the terminal's current directory. Keep the session URL private. Stop the app with Ctrl+C. Starting it again with the same workspace reopens those projects.

The release also includes the `in` and `nb-agent` aliases. All three commands provide the same features. In Bash and POSIX sh, `in` is a reserved word, so use `command in help --all`. In zsh, `in help --all` also works.

## Install without administrator access

If the first command reports a permission error, choose a directory you own instead of using `sudo`. This does not change your npm configuration:

```sh
mkdir -p "$HOME/.local/instrilo"
npm install --global --prefix "$HOME/.local/instrilo" https://github.com/nimeshbuilds/instrilo/releases/download/v0.2.1/nimeshbuilds-instrilo-0.2.1.tgz
export PATH="$HOME/.local/instrilo/bin:$PATH"
instrilo --version
instrilo app --workspace "$HOME/Instrilo/projects" --port 0
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

Open the [release assets](https://github.com/nimeshbuilds/instrilo/releases/tag/v0.2.1), download `nimeshbuilds-instrilo-0.2.1.tgz` and `SHA256SUMS` into an empty directory, and follow that release's included `INSTALL.md` instructions to verify SHA-256 before installation. A checksum detects a damaged or changed download; compare against the trusted release page.

You can then install the downloaded archive directly from that directory:

```sh
npm install --global ./nimeshbuilds-instrilo-0.2.1.tgz
instrilo --version
```

This still downloads runtime dependencies. Add the user-owned `--prefix` option above if needed. See the release's verification reports and [repository verification record](VERIFICATION.md) for the tested paths and their limits.

## Upgrade

Stop the app with Ctrl+C. Open the [releases page](https://github.com/nimeshbuilds/instrilo/releases), read the target release's notes, then install its exact package URL. To install or reinstall this version:

```sh
npm install --global https://github.com/nimeshbuilds/instrilo/releases/download/v0.2.1/nimeshbuilds-instrilo-0.2.1.tgz
instrilo --version
```

For a user-owned prefix, include `--prefix "$HOME/.local/instrilo"`. The package installation does not move or delete your project workspace. Keep project backups before upgrading, and review generation plans before applying new generated artifacts. Installing an older CLI is not a substitute for restoring a compatible project backup.

## Replace a source-linked installation

If you previously ran `npm link`, remove that global link before installing the release. This leaves your source checkout and project folders intact:

```sh
npm uninstall --global @nimeshbuilds/instrilo
npm install --global https://github.com/nimeshbuilds/instrilo/releases/download/v0.2.1/nimeshbuilds-instrilo-0.2.1.tgz
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

The published quickstarts use repository fixtures and exact `node dist/cli.js` commands. To follow them unchanged, create a source checkout with Git and build it:

```sh
git clone https://github.com/nimeshbuilds/instrilo.git
cd instrilo
npm ci --ignore-scripts
npm run build
node dist/cli.js help --all
```

Keep this checkout separate from your global installation. Run the [ten scenario guides](https://nimeshbuilds.github.io/instrilo/#quickstarts) from this repository root, in one Bash session per guide. Normal release use does not require these steps. Contributors can start the app directly from TypeScript with `npm run dev -- --workspace .studio/projects --port 0`.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `instrilo: command not found` | Run `npm prefix --global`; its `bin` directory must be in PATH. For the user-owned installation, add `$HOME/.local/instrilo/bin` or invoke its full command path. |
| Permission error during installation | Use the user-owned prefix instructions; no administrator access is needed for that directory. |
| Unsupported engine or syntax error | Check `node --version` is at least 22, and `command -v node` points to the intended installation. Reopen the terminal after changing Node. |
| `in` produces a shell syntax error | Use `command in` or the full name `instrilo`. |
| App URL no longer works | Restart the app and use the newly printed URL; each session has its own token. Keep the same workspace path to reopen projects. |
| Model setup or cloud deployment fails | Installation alone does not authenticate providers or configure cloud accounts. Use `instrilo doctor PROJECT`, `instrilo explain subscriptions`, and the generated deployment runbook. |
| The wrong CLI version runs | Check `instrilo --version`, `command -v instrilo`, and `npm prefix --global`; remove or update the older installation at its own prefix. |

For an issue report, include your OS, Node/npm and Instrilo versions, installation command, and a redacted error. Never include credentials or a private local app session URL.
