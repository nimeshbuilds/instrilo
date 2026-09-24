# Changelog

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
