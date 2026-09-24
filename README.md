<img src="assets/brand/banner.png" alt="Instrilo by nimeshbuilds. Build with intent. Ship with evidence." width="100%">

# Instrilo

[![CI](https://github.com/nimeshbuilds/instrilo/actions/workflows/ci.yml/badge.svg)](https://github.com/nimeshbuilds/instrilo/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-244E3A.svg)](LICENSE)

**Build with intent. Ship with evidence.**

A local CLI and web app for turning product guidance into an owned agent project. Choose Python or TypeScript, a framework, independent builder/runtime/judge connections, evaluation cases, and delivery artifacts.

Instrilo 0.1 is an early source release with exercised agent runtimes. Real provider access, model quality, cloud deployment, and installation into a user's desktop/chat account require their own verification. See [verification evidence and limits](docs/VERIFICATION.md).

[Product specification](docs/PRODUCT-SPEC.md) · [Roadmap](docs/ROADMAP.md) · [Competitors](docs/COMPETITORS.md) · [Contributing](CONTRIBUTING.md) · [Brand kit](assets/brand/README.md)

## Why Instrilo

Start from your product's guidance, keep the code you generate, and choose the model connections, framework, and deployment target independently. The CLI and local app share one project format, including Python and TypeScript support from this first release.

The long-term focus is agent quality that can be inspected: link requirements to evaluations, preserve custom code during upgrades, replay failures, and verify adapters across frameworks. Those capabilities are prioritized in the [roadmap](docs/ROADMAP.md); they are not all implemented in 0.1. The [competitive comparison](docs/COMPETITORS.md) explains the existing alternatives and the differentiation we still need to validate.

## Start the app

Requires Node.js 22 or newer and npm on macOS, Linux, or WSL. Native Windows support is not yet verified. Clone the source and run:

```sh
git clone https://github.com/nimeshbuilds/instrilo.git
cd instrilo
npm ci --ignore-scripts
npm run build
npm start -- --workspace .studio/projects --port 4317
```

Open the authenticated local URL printed in the terminal. The app listens on `127.0.0.1`; keep its session URL private. To run directly from source while developing:

```sh
npm run dev -- --workspace .studio/projects --port 4317
```

Create a project, import guidance or complete the interview, then use **Configuration** to select connections and framework. **Build project** generates code. **Install dependencies** prepares its runtime. The **Playground**, **Evaluations**, and **Code & delivery** tabs run, inspect, and export the result.

New projects use an explicit offline demo. It returns labeled demonstration output, makes no model request, and never produces an LLM judge score. Dependency installation can still download packages.

## Run the same workflow from the CLI

After building, optionally run `npm link` to make the `instrilo` command available. For example, `instrilo app` starts the workbench. The `nb-agent` command remains an alias, and existing `agent-studio.yaml` manifests and `NB_AGENT_PYTHON` settings remain compatible. No npm registry release is required for this source installation.

The CLI and app use the same project files and validation. This example runs without model credentials:

```sh
npm run cli -- init support-agent --directory .studio/projects --language typescript
npm run cli -- guidance create .studio/projects/support-agent/guidance
npm run cli -- validate .studio/projects/support-agent
npm run cli -- build .studio/projects/support-agent
npm run cli -- prepare .studio/projects/support-agent
npm run cli -- run .studio/projects/support-agent --input "Draft a response to a missing delivery."
npm run cli -- eval .studio/projects/support-agent --split development
```

`guidance create` asks ten questions in an interactive terminal. For unattended creation, provide a JSON answer object with `--answers ./answers.json`; its keys are `purpose`, `users`, `inputs`, `outputs`, `success`, `tools`, `boundaries`, `escalation`, `examples`, and `operations`. Blank answers remain explicitly undecided. The command preserves an existing interview document.

To start with existing instructions:

```sh
npm run cli -- guidance inspect /absolute/path/to/product-guidance
npm run cli -- create research-agent --guidance /absolute/path/to/product-guidance --directory .studio/projects
```

Eligible guidance is copied into the new project; the original directory is not modified. Add `--config ./agent-studio.yaml` to use an existing complete configuration. Explicit language/framework/target flags override its corresponding values.

The app's guidance editor supports existing eligible files and detects concurrent edits before saving. Builder follow-up answers are saved in separate clarification documents. The CLI also supports a builder-led follow-up interview:

```sh
npm run cli -- plan .studio/projects/support-agent
npm run cli -- plan .studio/projects/support-agent --interview
```

Use `--apply` to save the proposed instructions. A configured live builder consumes its provider allowance; `--interview` can invoke it again after your answers. In the app, saving clarification answers does not automatically invoke the builder again.

After changing configuration or guidance, rebuild before running or evaluating:

```sh
npm run cli -- build .studio/projects/support-agent --overwrite
```

Rebuilding replaces generated files. Keep custom application changes in version control before using `--overwrite`.

## Python projects

Generated Python projects require Python 3.11–3.13 and `uv` for the built-in dependency preparation command. Keep different generated framework projects in separate environments.

```sh
npm run cli -- init python-agent --directory .studio/projects --language python
npm run cli -- build .studio/projects/python-agent
npm run cli -- prepare .studio/projects/python-agent
npm run cli -- run .studio/projects/python-agent --input "Hello"
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
npm run cli -- providers
npm run cli -- doctor .studio/projects/support-agent
```

`doctor` checks configuration, environment-variable presence, and installed CLI availability. It does not prove an API credential, model, subscription entitlement, or cloud account works. See [provider setup and current restrictions](docs/PROVIDERS.md).

## Evaluations and export

Edit cases in the app or the project's `evals/cases.jsonl`. Each case has an ID, input, optional reference/checks, `source` (`reviewed` or `synthetic`), and `split` (`development` or `holdout`). Replace the synthetic seed cases with task-specific examples and calibrate judge outputs against human labels.

```sh
npm run cli -- eval .studio/projects/support-agent --split holdout --output ./holdout-report.json
npm run cli -- compare ./previous-report.json ./holdout-report.json
```

An empty holdout split fails explicitly. Reports preserve available traces and dataset/case/judge hashes. Comparison warns about changed evaluation conditions and avoids treating changed case contents as the same regression. Demo reports are smoke checks only.

The app exports a ZIP containing generated source, a portable Instrilo manifest, the inspected guidance, the saved evaluation dataset/rubric, tests, and selected delivery/host artifacts. `.env`, dependency directories, and symlinks are excluded. Environment references remain in the export; actual credentials must be supplied separately. To reopen a moved export in Instrilo, rebuild it from its portable manifest before invoking Instrilo run/eval so build fingerprints refer to its new location.

## Delivery

Generation supports local, Docker, AWS AgentCore, Google Cloud Run, and Azure Container Apps artifacts. Selected coding/desktop hosts receive instruction/configuration packages and MCP entry points. ChatGPT selection also generates a remote HTTP MCP entry point; external HTTPS hosting, an authorization service, and actual ChatGPT connection setup remain operator tasks. See [chat-host setup](docs/CHAT-HOSTS.md).

```sh
npm run cli -- deploy .studio/projects/support-agent
```

Without `--execute`, this displays the selected target and output directory. After reviewing target-specific scripts and supplying account IDs, identities, secrets, and cloud CLIs, `deploy --execute` explicitly runs the generated target script. That action can create billable resources. No real cloud deployment was performed while validating this repository.

The app itself is a local workbench. It does not supply a hosted identity provider, tenant administration, durable approval inbox, persistent workflow checkpointing, or a managed deployment control plane. See [delivery requirements](docs/DEPLOYMENT.md), the [full product specification](docs/PRODUCT-SPEC.md), and the [prioritized roadmap](docs/ROADMAP.md).

## Architecture and tests

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

Tests do not invoke paid models. Workbench integration tests install generated TypeScript dependencies, so registry access or a populated package cache is required. Set `NB_AGENT_PYTHON=/absolute/path/to/python3` to include the Python CLI integration test; it creates an isolated temporary environment and installs its native runtime dependencies. See [VERIFICATION.md](docs/VERIFICATION.md) for framework smoke commands, exact evidence, and what remains unverified.

## Open source

Instrilo is maintained by [nimeshbuilds](https://github.com/nimeshbuilds) under [Apache-2.0](LICENSE). Start with the [contribution guide](CONTRIBUTING.md) and [bounded roadmap tasks](docs/ROADMAP.md). Report vulnerabilities privately using [SECURITY.md](SECURITY.md). Branding assets and their source notes are in the [brand kit](assets/brand/README.md).
