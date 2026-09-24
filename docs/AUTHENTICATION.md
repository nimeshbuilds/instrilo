# Provider installation and sign-in

Use `instrilo setup codex`, `instrilo setup claude`, or `instrilo setup grok` to discover an official provider CLI, install it if missing, and sign in. Running `instrilo setup` in a terminal asks which provider to use. The same commands work through the `in` alias; Bash/POSIX sh requires `command in` because `in` is reserved.

Instrilo invokes the unmodified official CLI. The provider owns authentication, account selection, consent and credential storage. Instrilo never opens its credential files and does not collect passwords, API keys, session tokens or browser cookies. Signing into a CLI does not sign into a desktop chat app; see [chat-host setup](CHAT-HOSTS.md).

## Command reference

| Command | Behavior |
| --- | --- |
| `setup [provider]` | Discover → review/install if missing → sign in if subscription credentials are not confirmed → check status. |
| `auth status [provider]` | Inspect one or all providers without installing, logging in or calling a model. |
| `auth install <provider> --plan` | Print the exact official package, registry, arguments and destination. No changes. |
| `auth install <provider> [--yes]` | Install/update the official package. A terminal prompt or `--yes` authorizes installation. |
| `auth login <provider> [--device] [--install] [--yes]` | Start official login, even when credentials already exist. `--install` offers installation if missing. |
| `auth verify <provider> [--model ID]` | Make one bounded live request. It can consume subscription allowance or API billing. |
| `connect <provider> [project] --role builder` | Set up the provider and save an independent project role assignment. |

Use `--help` on any command or `instrilo explain subscriptions` for the complete offline manual. `setup` and `connect` support `--yes` to approve the displayed install plan and start official login without Instrilo prompts. The provider still requires its own account authorization. Setup does not call a model; verification is always explicit.

`connect` supports `builder`, `runtime`, `judge` or `all`; builder is the default. `--connection NAME` chooses a name; `--replace` explicitly allows replacing a connection of a different kind. `--model ID` selects a model. Compatibility is validated before installation or login, and concurrent project edits prevent the final save. CLI runtime roles require the native framework, local target, no portable HTTP tools, and no remote ChatGPT bridge. Rebuild after changing a connection. CLI runtime connections do not support durable recorded runs.

## Installation

This release supports guided installation on macOS, Linux and WSL with Node.js 22+ and npm. Native Windows npm shims and process-tree cancellation are not supported by onboarding; use WSL. Missing Node/npm produces prerequisite guidance.

Plans use these fixed official packages from `https://registry.npmjs.org`:

| Provider | Package | Official login | Device login |
| --- | --- | --- | --- |
| Codex | `@openai/codex` | `codex login` | `codex login --device-auth` |
| Claude Code | `@anthropic-ai/claude-code` | `claude auth login` | Not supported by this integration |
| Grok Build | `@xai-official/grok` | `grok login` | `grok login --device-auth` |

The command is `npm install --global --prefix PREFIX PACKAGE --registry https://registry.npmjs.org --no-audit --no-fund`. Provider package install scripts run as part of npm installation. No `sudo` or arbitrary shell command is used. The default prefix is `~/.local/share/instrilo/providers`; `INSTRILO_PROVIDER_HOME` can select another absolute directory.

Both Instrilo and generated Python/TypeScript runtimes search absolute PATH entries, the managed prefix's `bin`, `~/.local/bin`, then `~/.bun/bin`. Existing PATH installations take precedence. Inspect the selected path with `auth status`; installing a newer managed copy does not override an older PATH copy. Managed tools work through Instrilo without a PATH edit. Add the managed `bin` directory to your shell's PATH only if you want to invoke those binaries directly.

An installation lock prevents concurrent npm writes to the prefix. Cancellation terminates the child process group and releases the lock. Installation and login are bounded to five and ten minutes respectively; status probes are bounded to five seconds each. An interrupted npm installation may leave package files: retry the reviewed install. After a machine crash, ensure no installer is running before removing an abandoned `.install.lock` in the prefix.

## App flow

Open **Connections & adapters**. Each provider card offers status checking, a reviewable install plan, sign-in and supported device login. Installation runs only after you click the explicit install action. Login starts the provider's browser flow; only trusted provider URLs and recognized device codes are displayed. Cancel stops the local process. Sign-in handoff details are temporary and are cleared when the job finishes; they are never persisted to project files.

Configuration includes setup links for CLI connections. Unsaved configuration drafts are retained while moving between setup and configuration. Setup changes the machine's provider installation/login; selecting and saving builder/runtime/judge assignments remains a project configuration action.

Some provider flows require terminal input, particularly when browser callbacks fail. The app then directs you to `instrilo auth login PROVIDER`. Complete that in a terminal and refresh the card. No promise of unattended account creation or browser consent is made.

## What status means

Codex and Claude expose official credential-status commands. Instrilo reports missing, authenticated, unauthenticated, unknown or error states, and distinguishes subscription/API-key authentication when recognizable. Unknown output formats never establish subscription readiness. Grok currently exposes no supported noninteractive authentication-status command; installation or successful login does not prove a durable authenticated session.

Status does not prove subscription eligibility, remaining quota, model access, or a successful model call. `auth verify` tests one real request through the selected CLI, without establishing future quota or billing source. Environment credentials and provider configuration can affect billing. Checks mention relevant environment variable names without revealing their values.

If status fails, update the selected CLI installation and use its official login in a terminal. Device authentication may need an account/workspace setting enabled. Inspect connection compatibility with `instrilo doctor PROJECT`; use `instrilo auth verify PROVIDER` only when you intend a live request.

## Official references

Install and login commands were checked against official documentation on September 24, 2026:

- [Codex repository and installation](https://github.com/openai/codex), [Codex authentication](https://learn.chatgpt.com/docs/auth), [Codex CLI reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli).
- [Claude Code setup](https://code.claude.com/docs/en/setup), [CLI reference](https://code.claude.com/docs/en/cli-reference), [authentication](https://code.claude.com/docs/en/authentication).
- [Grok CLI reference](https://docs.x.ai/build/cli/reference), [enterprise installation and device authentication](https://docs.x.ai/build/enterprise), [official login implementation](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-login/src/flow.rs).

Automated tests use isolated fake CLIs and installers; no real subscription account or public package installation is exercised by these tests. Provider behavior and terms can change. See [provider restrictions](PROVIDERS.md) before relying on an integration.
