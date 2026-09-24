# Changelog

## 0.2.3 — 2026-09-24

- Every public walkthrough uses the installed `instrilo` CLI. `instrilo tutorials setup` copies bundled example files and offline guides into a fresh workspace; `tutorials list` and `tutorials show` make the whole path available in the terminal.
- The end-to-end guide connects guidance, architecture, a real LangGraph, independent model roles and judge, recorded runs, evaluation and release evidence to deployment artifact exports for AWS AgentCore, Cloud Run and Azure Container Apps. Local fixture checks and live production requirements are explicit.
- Walkthrough verification now installs the packed release into an isolated prefix and executes the published commands against that package without a source checkout.

## 0.2.2 — 2026-09-24

- `instrilo web enable` starts the local browser app and opens it automatically; `instrilo web` is a shorthand. A stable home workspace and automatic free port make repeated startup straightforward. Use `--workspace`, `--port`, or `--no-open` when needed.
- Preserve the existing server-only `app` command and add its optional `--open` flag. Browser-launch failures retain the running app and provide the local URL for manual opening.
- Two clear installation paths in the README, installation guide, and branded website: download the built release or build from source. The offline manual covers app startup, terminal lifetime, browser fallback, and both installation paths.

## 0.2.1 — 2026-09-24

- Ready-built GitHub release package containing both the CLI and local browser app; install with npm without cloning or compiling Instrilo. The package includes the `instrilo`, `in`, and `nb-agent` commands.
- Release checksums, installation instructions, and clean-install verification for the packaged CLI/app. Node.js remains a prerequisite; npm installs runtime dependencies.
- Release-first website and README, with user-owned installation, upgrades, source-link migration, uninstalling, and clear source setup for the ten exact walkthroughs.

- Branded GitHub Pages documentation with ten practical walkthroughs, source-exact tested command blocks, expected results, troubleshooting, cleanup, and fingerprint-bound verification records. Pages publication is gated on running the walkthroughs.
- Platform-specific deployment contracts and detailed prerequisite/runbooks for local, Docker, AgentCore, Cloud Run and Azure Container Apps; corrected Azure managed-identity bootstrap and platform architecture handling.
- Optional Docker/Podman deployment contract tests with isolated fixture services, target-architecture checks, retained JSON/Markdown evidence, cancellation and ownership-checked cleanup.
- Container engine inspection, reviewed platform setup/startup and explicit cleanup of owned dependencies, available through the comprehensive CLI and Code & delivery app workspace.

- Add `in` as a CLI executable alias for `instrilo`, alongside `nb-agent`; document `command in` for Bash/POSIX sh.
- Guided Codex, Claude Code and Grok Build onboarding in the CLI and app: reviewed official package installation, provider-owned browser/device login, credential-status checks, cancellation and terminal fallback.
- Add `setup`, `auth status/install/login/verify`, and `connect` with independent project roles, compatibility validation and concurrent-edit protection; expand the offline manual and complete CLI reference.
- Discover user-managed provider installations in builder/judge transports and generated Python/TypeScript runtimes. Distinguish installation, login, subscription credentials and an explicit live verification request.

## 0.2.0 — 2026-09-24

- Comprehensive CLI with nested help, an offline searchable manual, examples, machine-readable command metadata, and validated project/configuration/guidance/tool/dataset operations.
- Reviewed requirements and exact case links, immutable registered evaluation reports, stale evidence detection, project release policies and explicit release-gate exit codes.
- Blind human review, version-bound labels and corrections, judge-human agreement and disagreement reports.
- Safe regeneration with content baselines, preserved user edits, preview hashes, conservative merges, recoverable transactions and backed-up legacy migration; npm/uv dependency-lock commands.
- Durable native/LangGraph runs in Python and TypeScript: exact expiring approvals, pause/resume, uncertain-write reconciliation, frozen replay, portable scrubbed bundles, and observed execution graphs.
- Trusted pinned adapter bundles, conformance checks, artifact extension contracts, and an authenticated loopback provider bridge.
- App evidence/review and run/approval workspaces, reviewed build previews, and coherent exports that reject stale source inputs.

The manifest remains schema version 1. Durable execution supports API transports on macOS/Linux/WSL; external provider accounts, deployment accounts, hosted multi-user identity, and arbitrary plugin code are separate trust boundaries. This is a source release, not an npm registry publication.

## 0.1.0 — 2026-09-24

First public source release of **Instrilo** by nimeshbuilds.

- Shared CLI and local web app for guidance interviews, project configuration, code generation, execution, evaluations, and export.
- Python and TypeScript generation with native, LangGraph, and OpenAI Agents runtimes; CrewAI generation for Python.
- Independent builder, runtime, and judge connections, with API/gateway authentication and bounded local CLI transports.
- Local/container/cloud delivery artifacts, coding-tool guidance, and desktop/remote MCP bridges.
- Build freshness checks, evaluation provenance, comparison reports, and security-focused local fixtures.
- Apache-2.0 license, brand assets, contributor documentation, compatibility notes, and a prioritized roadmap.

See [verification](docs/VERIFICATION.md) for the exact test coverage and live-account/cloud limitations. This release is installed from source; no npm registry package has been published. The legacy `nb-agent` CLI alias, `agent-studio.yaml` manifest, and `NB_AGENT_PYTHON` setting remain compatible.
