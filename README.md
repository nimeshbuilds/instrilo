<img src="assets/brand/banner.png" alt="Instrilo by nimeshbuilds. Build with intent. Ship with evidence." width="100%">

# Instrilo

[![CI](https://github.com/nimeshbuilds/instrilo/actions/workflows/ci.yml/badge.svg)](https://github.com/nimeshbuilds/instrilo/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-244E3A.svg)](LICENSE)

**Build with intent. Ship with evidence.**

A local CLI and web app for turning product guidance into an owned agent project. Choose Python or TypeScript, a framework, independent builder/runtime/judge connections, evaluation cases, and delivery artifacts.

Instrilo 0.2.3 includes a ready-built app and CLI package for Node.js. It provides exercised agent runtimes, safe regeneration, release evidence, human review, adapters, and durable local runs. Real provider access, model quality, cloud deployment, and installation into a user's desktop/chat account require their own verification. See [verification evidence and limits](docs/VERIFICATION.md).

[Install the release](docs/INSTALLATION.md) · [Website & ten practical quickstarts](https://nimeshbuilds.github.io/instrilo/) · [CLI manual](docs/CLI.md) · [Product specification](docs/PRODUCT-SPEC.md) · [Roadmap](docs/ROADMAP.md) · [Competitors](docs/COMPETITORS.md) · [Contributing](CONTRIBUTING.md) · [Brand kit](assets/brand/README.md)

The quickstarts cover TypeScript, Python, separate model connections, HTTP tools, LangGraph, subscription setup, evaluations, human review, approvals/replay, and an end-to-end agent build with architecture, graph, judge, release evidence, and cloud artifacts. All ten guides use the installed CLI and bundled tutorial inputs. Their published command blocks are executed in isolated workspaces before the documentation site is deployed. Each guide identifies local fixtures, expected results, and manual account-dependent steps; passing a tutorial is not a claim that every provider or cloud account has been verified. GitHub Pages hosts the documentation; the Instrilo app runs locally.

## Why Instrilo

Start from your product's guidance, keep the code you generate, and choose the model connections, framework, and deployment target independently. The CLI and local app share one project format, including Python and TypeScript support from this first release.

Link reviewed requirements to exact evaluation cases, preserve custom code during regeneration, review outputs without seeing the judge's verdict, and apply a release policy. Record supported runs, approve exact tool calls, replay frozen responses, and inspect the observed execution graph. The [roadmap](docs/ROADMAP.md) distinguishes implemented local workflows from future hosted and framework expansion. The [competitive comparison](docs/COMPETITORS.md) explains the existing alternatives and the differentiation we still need to validate.

## Get the app and CLI

Choose the **built release** or **build from source**. Both include the same CLI and local browser app. Requires [Node.js 22 or newer](https://nodejs.org/en/download) and npm on macOS, Linux, or WSL. Native Windows support is not yet verified.

### Download and install the release

Install the ready-built [v0.2.3 release](https://github.com/nimeshbuilds/instrilo/releases/tag/v0.2.3) without cloning or compiling:

```sh
npm install --global https://github.com/nimeshbuilds/instrilo/releases/download/v0.2.3/nimeshbuilds-instrilo-0.2.3.tgz
instrilo web enable
```

You can also [download the package and verify its checksum](docs/INSTALLATION.md#download-and-verify-before-installation) before installing it. npm fetches runtime dependencies. If the global installation directory is not writable, use the [user-owned prefix](docs/INSTALLATION.md#install-without-administrator-access).

### Build from source

For contributors and people who want to change Instrilo itself. With [Git](https://git-scm.com/downloads) installed:

```sh
git clone https://github.com/nimeshbuilds/instrilo.git
cd instrilo
npm ci --ignore-scripts
npm run build
npm link
instrilo web enable
```

`npm link` makes the built `instrilo` command available from any folder. Every guide uses that same command. If linking reports a permission error, use the [source setup instructions](docs/INSTALLATION.md#build-from-source-instead) for a user-owned prefix.

### Open the web app

`instrilo web enable` (or simply `instrilo web`) starts the app, chooses an available port, and opens your browser. Projects live in `~/Instrilo/projects` by default. Keep the terminal running; stop the app with Ctrl+C. Run the command again to reopen your projects.

```sh
instrilo web enable --workspace ./my-projects
instrilo web enable --port 4317
instrilo web enable --no-open
instrilo explain web
```

Use `--no-open` on a server or when you prefer to open the printed URL yourself. The app listens on `127.0.0.1`; keep its session URL private. If automatic opening is unavailable, the app keeps running and prints a fallback URL. The existing `instrilo app` command still starts the server without opening a browser; add `--open` if desired.

The [installation guide](docs/INSTALLATION.md) covers checksums, PATH, upgrades, uninstalling, and troubleshooting. GitHub Pages hosts the documentation; the workbench runs on your computer.

Create a project, import guidance or complete the interview, then use **Configuration** to select connections and framework. **Build project** previews file changes; **Apply reviewed build** applies that exact plan. **Install dependencies** prepares its runtime. The **Playground**, **Evaluations**, and **Code & delivery** tabs run, inspect, and export the result. **Evidence & review** links requirements and reviews reports; **Runs & approvals** records, approves, resumes, and replays supported runs.

New projects use an explicit offline demo. It returns labeled demonstration output, makes no model request, and never produces an LLM judge score. Dependency installation can still download packages.

## Run the same workflow from the CLI

The release installs `instrilo`, its short alias `in`, and the legacy alias `nb-agent`. All three commands expose the same functionality. Existing `agent-studio.yaml` manifests and `NB_AGENT_PYTHON` settings remain compatible. If you previously used `npm link`, follow the [source-install migration steps](docs/INSTALLATION.md#replace-a-source-linked-installation).

`in help --all` works directly in zsh. In Bash and POSIX sh, `in` is a reserved word: use `command in help --all` (or `instrilo help --all`). `command in` works in all three shells.

The CLI and app use the same project files and validation. This example runs without model credentials:

```sh
instrilo init support-agent --directory .studio/projects --language typescript
instrilo guidance create .studio/projects/support-agent/guidance
instrilo validate .studio/projects/support-agent
instrilo build .studio/projects/support-agent
instrilo prepare .studio/projects/support-agent
instrilo run .studio/projects/support-agent --input "Draft a response to a missing delivery."
instrilo eval .studio/projects/support-agent --split development
```

`guidance create` asks ten questions in an interactive terminal. For unattended creation, provide a JSON answer object with `--answers ./answers.json`; its keys are `purpose`, `users`, `inputs`, `outputs`, `success`, `tools`, `boundaries`, `escalation`, `examples`, and `operations`. Blank answers remain explicitly undecided. The command preserves an existing interview document.

To start with existing instructions:

```sh
instrilo guidance inspect /absolute/path/to/product-guidance
instrilo create research-agent --guidance /absolute/path/to/product-guidance --directory .studio/projects
```

Eligible guidance is copied into the new project; the original directory is not modified. Add `--config ./agent-studio.yaml` to use an existing complete configuration. Explicit language/framework/target flags override its corresponding values.

The app's guidance editor supports existing eligible files and detects concurrent edits before saving. Builder follow-up answers are saved in separate clarification documents. The CLI also supports a builder-led follow-up interview:

```sh
instrilo plan .studio/projects/support-agent
instrilo plan .studio/projects/support-agent --interview
```

Use `--apply` to save the proposed instructions. A configured live builder consumes its provider allowance; `--interview` can invoke it again after your answers. In the app, saving clarification answers does not automatically invoke the builder again.

After changing configuration or guidance, rebuild before running or evaluating:

```sh
instrilo build .studio/projects/support-agent --overwrite
```

Rebuilding compares the new output, retained baseline, and current files. Unowned files and unchanged-generator customizations survive; conflicting edits stop the transaction. Preview with `generation plan PROJECT`; use `--merge` for conservative non-overlapping text merges and `--expected-plan HASH` to apply only the reviewed plan. Keep version control as an independent backup. Legacy builds have no trustworthy baseline for existing edits; see [regeneration and migration](docs/REGENERATION.md).

## Everything from the terminal

The CLI includes an offline operational manual and a complete command reference. Each command explains its arguments, options, examples, and related guide. No app or hosted account is required for the CLI workflows.

```sh
instrilo help --all
instrilo help connections add
instrilo explain --list
instrilo explain quickstart
instrilo explain --search JWT
instrilo explain approvals
instrilo help --json
```

Use `config`, `connections`, `tools`, `guidance`, and `cases` to create and edit project inputs. Use `requirements`, `evidence`, `policy`, `review`, and `release` for quality decisions. Use `generation`, `deps`, `runs`, `approvals`, `adapters`, `artifacts`, `reports`, and `export` for maintenance and delivery. `explain --all` prints the full manual; `--json` supports tooling. See the [complete CLI reference](docs/CLI.md).

## Guided provider setup

Instrilo helps install the official Codex, Claude Code or Grok Build CLI, starts the provider's own sign-in flow, and checks credential status. Start from the terminal or **Connections & adapters** in the app:

```sh
instrilo setup codex
instrilo auth install claude --plan
instrilo auth login grok --install --device
instrilo connect claude .studio/projects/support-agent --role judge
instrilo auth status
instrilo auth verify grok
instrilo explain subscriptions
```

Installation requires an explicit review or `--yes` and uses a managed user directory without `sudo`. Instrilo and generated Python/TypeScript agents discover that directory automatically. Sign-in stays in the official provider CLI/browser; Instrilo never reads its credential files. `auth verify` is an explicit live request that can use subscription allowance or API billing. Grok has no supported authentication-status command, so a completed login remains unverified until a live check. See the [setup guide](docs/AUTHENTICATION.md) for device login, environment overrides, troubleshooting and platform limits.

## Platform-aware deployment checks

Generated projects include a dated platform contract and a detailed `DEPLOYMENT.md`: prerequisites, architecture, identity and secret setup, build/push/deploy steps, invocation, logs, troubleshooting and teardown. AgentCore uses ARM64; Cloud Run and Azure Container Apps use AMD64. Inspect the official references included with each target.

```sh
instrilo deployment prerequisites PROJECT --engine podman
instrilo deployment guide PROJECT
instrilo deployment engine install podman             # Review platform setup
instrilo deployment engine install podman --execute   # Supported installation
instrilo deployment engine start podman --execute     # Dedicated VM on macOS
instrilo deployment test PROJECT --engine podman      # Review local test plan
instrilo deployment test PROJECT --engine podman --execute
instrilo deployment reports PROJECT
instrilo deployment cleanup RUN_ID PROJECT --execute
instrilo deployment engine cleanup podman             # Review dependency removal
instrilo explain deployment
```

Local tests build the generated Dockerfile for the target architecture and exercise its server/framework with fixture model and identity services. JSON and Markdown reports record checkpoints, mocks, unverified cloud requirements and cleanup results. The app exposes the same workflow in **Code & delivery**. A local pass does not verify cloud IAM, real secret-manager access, account quotas or model quality.

Test resources are removed automatically unless `--keep` is selected; reports remain. Cleanup verifies exact resource ownership and never runs a global prune. Removing container dependencies is a separate explicit operation: pre-existing/shared installations are preserved. For an Instrilo-owned Podman VM, `engine cleanup podman --remove-machine-data` previews deleting its entire disk, including cached images; add `--execute` only after reviewing the inventory. Docker Desktop uninstallation and privileged Linux/WSL installation steps use official manual instructions when automatic ownership or privileges cannot be established. See [deployment details](docs/DEPLOYMENT.md).

## Engineering workflows in 0.2

| Workflow | What it does | Boundary |
| --- | --- | --- |
| [Requirements and release evidence](docs/EVIDENCE.md) | Versioned requirements, reviewed case links, stale-source detection, holdout policies and release decisions | Default policy rejects demo/synthetic evidence; local records are not independent attestations. |
| [Safe regeneration](docs/REGENERATION.md) | Read-only plans, retained baselines, preserved edits, optional text merge, transaction recovery, legacy migration | Conflicts require a reviewed resolution; dependency locks must be resolved explicitly. |
| [Human review](docs/EVIDENCE.md) | Blind review queues, immutable labels/corrections, disagreements and judge-human agreement | Descriptive calibration, not a statistical reliability guarantee or hosted reviewer identity. |
| [Durable runs and replay](docs/RUNS.md) | Pause/review/resume, expiry and single-use claims, uncertain-write reconciliation, graphs and portable frozen replay | Native and LangGraph in both languages; API transports, macOS/Linux/WSL. Local operator trust. |
| [Adapter conformance](docs/ADAPTERS.md) | Trusted pinned extensions, capability inspection, bounded invocation, conformance checks and authenticated provider bridge | Generator extensions add artifacts to built-in runtimes; they do not register a new primary framework. |

Start by reading the relevant `explain` topic. For example:

```sh
instrilo requirements example
instrilo cases example
instrilo explain release
instrilo generation plan PROJECT
instrilo deps lock PROJECT
instrilo deps install PROJECT
instrilo runs start PROJECT --input "Draft a response" --record-content
instrilo runs list PROJECT
instrilo runs graph RUN_ID PROJECT --format mermaid
instrilo runs replay RUN_ID PROJECT
instrilo runs export RUN_ID PROJECT --output issue-bundle.json
instrilo adapters catalog
instrilo export PROJECT --output project.zip
```

`PROJECT`, `RUN_ID`, and `HASH` are placeholders. Recording explicitly persists model/tool content on your machine. Exports omit run content by default; a full scrubbed bundle can replay with `runs replay-bundle FILE PROJECT --execute-local` only against matching trusted local code. Replay never falls back to live model or tool requests through the supported runtime.

## Python projects

Generated Python projects require Python 3.11–3.13 and `uv` for the built-in dependency preparation command. Keep different generated framework projects in separate environments.

```sh
instrilo init python-agent --directory .studio/projects --language python
instrilo build .studio/projects/python-agent
instrilo prepare .studio/projects/python-agent
instrilo run .studio/projects/python-agent --input "Hello"
```

Set `NB_AGENT_PYTHON` to an explicit interpreter path when needed. The runner first uses the generated project's `.venv`, then `NB_AGENT_PYTHON`, then `python3`. `prepare` passes the explicit interpreter to `uv` when supplied.

## Connections and frameworks

Builder, runtime, and judge each reference a named connection in `agent-studio.yaml`. They can use different providers, models, endpoints, and authentication. Supported transports include OpenAI, Anthropic, xAI, compatible gateways, Ollama, and bounded local provider-CLI sessions. Use **Configuration** or edit the manifest.

| Framework | Generated languages | Runtime connections |
| --- | --- | --- |
| Native | Python, TypeScript | API connections; local CLI sessions; offline demo |
| LangGraph | Python, TypeScript | OpenAI, xAI, gateway, Ollama |
| OpenAI Agents SDK | Python, TypeScript | OpenAI, xAI, gateway |
| CrewAI | Python | OpenAI |

CLI runtimes require the native framework, local target, and no portable HTTP tool definitions or remote ChatGPT bridge. A subscription is accessed only through a supported, installed provider CLI under that provider's terms; it is not converted into a universal API key. Actual authenticated subscription inference has not been verified in this implementation session.

Credentials are environment-variable references, never secret values in the manifest. Set the referenced variables before starting the app or CLI. Gateways can use API keys, existing bearer tokens/JWTs, or OAuth client credentials. Inbound JWT settings authenticate callers to the generated agent; they are separate from outbound provider credentials and from the local app's session token.

```sh
instrilo providers
instrilo doctor .studio/projects/support-agent
```

`doctor` checks configuration, environment-variable presence, installed CLIs and supported credential-status commands. It does not prove an API credential, model, subscription entitlement, or cloud account works. See [provider setup and current restrictions](docs/PROVIDERS.md).

## Evaluations and export

Edit cases in the app or the project's `evals/cases.jsonl`. Each case has an ID, input, optional reference/checks, `source` (`reviewed` or `synthetic`), and `split` (`development` or `holdout`). Replace the synthetic seed cases with task-specific examples and calibrate judge outputs against human labels.

```sh
instrilo eval .studio/projects/support-agent --split holdout --output ./holdout-report.json
instrilo compare ./previous-report.json ./holdout-report.json
```

An empty holdout split fails explicitly. Reports preserve available traces and dataset/case/judge hashes. Comparison warns about changed evaluation conditions and avoids treating changed case contents as the same regression. Demo reports are smoke checks only.

The app exports a ZIP containing generated source, a portable Instrilo manifest, the inspected guidance, the saved evaluation dataset/rubric, tests, and selected delivery/host artifacts. `.env`, dependency directories, and symlinks are excluded. Environment references remain in the export; actual credentials must be supplied separately. To reopen a moved export in Instrilo, rebuild it from its portable manifest before invoking Instrilo run/eval so build fingerprints refer to its new location.

## Delivery

Generation supports local, Docker, AWS AgentCore, Google Cloud Run, and Azure Container Apps artifacts. Selected coding/desktop hosts receive instruction/configuration packages and MCP entry points. ChatGPT selection also generates a remote HTTP MCP entry point; external HTTPS hosting, an authorization service, and actual ChatGPT connection setup remain operator tasks. See [chat-host setup](docs/CHAT-HOSTS.md).

```sh
instrilo deploy .studio/projects/support-agent
```

Without `--execute`, this displays the selected target and output directory. After reviewing target-specific scripts and supplying account IDs, identities, secrets, and cloud CLIs, `deploy --execute` explicitly runs the generated target script. That action can create billable resources. No real cloud deployment was performed while validating this repository.

The app itself is a local workbench. It does not supply a hosted identity provider, tenant administration, durable approval inbox, persistent workflow checkpointing, or a managed deployment control plane. See [delivery requirements](docs/DEPLOYMENT.md), the [full product specification](docs/PRODUCT-SPEC.md), and the [prioritized roadmap](docs/ROADMAP.md).

## Follow the ten walkthroughs

The [ten practical quickstarts](https://nimeshbuilds.github.io/instrilo/#quickstarts) work with the installed release. Prepare their bundled inputs once in a new folder, then follow any guide in the same Bash terminal:

```sh
instrilo tutorials setup ./instrilo-tutorials
cd ./instrilo-tutorials
```

No source checkout is needed. If the app is using that terminal, stop it with Ctrl+C first. For another guide, reuse the prepared folder. Each guide creates its own project under `.studio/tutorials/` and labels optional live-account steps.

[Build an agent from guidance to cloud artifacts](https://nimeshbuilds.github.io/instrilo/quickstarts/deployment-artifacts/) connects the full workflow: architecture and guidance, LangGraph, separate builder/runtime/judge connections, evaluations, observed run graph, release gates, and deployment packages for supported clouds. The tested local path uses transparent fixture services; live model quality, cloud identity, and an actual deployment need your own environment checks.

## Architecture and tests

This section is for contributors working in a source checkout. The [contribution guide](CONTRIBUTING.md) covers development commands; everyday use and every quickstart use `instrilo`.

```text
CLI + web app
  └─ shared project/guidance validation
       ├─ builder connection and refinement
       ├─ framework generator → owned runtime source
       ├─ runtime execution → traces/results
       ├─ deterministic checks + independent judge
       └─ target/host artifacts + portable export
```

Core contracts live in `src/types.ts`; validation/guidance in `src/core.ts`; connections in `src/providers.ts`; framework/target generation in `src/generators.ts` and `src/templates/`; execution/evaluation in `src/execution.ts`; project operations in `src/workbench.ts`; and the app in `src/server.ts` and `src/web/`.

```sh
npm run check
npm run build
npm test
```

Tests do not invoke paid models. Workbench integration tests install generated TypeScript dependencies, so registry access or a populated package cache is required. Set `NB_AGENT_PYTHON=/absolute/path/to/python3` to include Python CLI and durable native/LangGraph integration tests; they create isolated temporary environments and install their runtime dependencies. `uv` must be available. See [VERIFICATION.md](docs/VERIFICATION.md) for framework smoke commands, exact evidence, and what remains unverified.

## Open source

Instrilo is maintained by [nimeshbuilds](https://github.com/nimeshbuilds) under [Apache-2.0](LICENSE). Start with the [contribution guide](CONTRIBUTING.md) and [bounded roadmap tasks](docs/ROADMAP.md). Report vulnerabilities privately using [SECURITY.md](SECURITY.md). Branding assets and their source notes are in the [brand kit](assets/brand/README.md).
