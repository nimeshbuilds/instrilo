# Walkthrough source contract

The public website is built from `website/scenarios/*.json`. Walkthroughs and the executable scenario checks share the same command strings.

Each file contains `{ id, order, title, summary, category, duration, prerequisites: string[], outcome, verification: { scope, limitations: string[] }, steps: [{ title, body, code?, expected }], next: [{ label, url }] }`.

- IDs are lowercase slugs; order is 1–10. Text is plain text, not raw HTML.
- `code` is a POSIX/Bash-compatible shell block, displayed verbatim and executed in step order by the scenario runner. All executable blocks in a scenario share one shell. Use `node dist/cli.js` from the cloned repository root; do not require a global install.
- Scenario projects go in `.studio/tutorials/SLUG`. The test runner runs in a fresh isolated directory with repository `dist`, `node_modules`, and `examples` symlinked into it. It does not replace HOME or touch account state.
- Use checked-in example files under `examples/quickstarts/SLUG`. Do not require users to guess JSON, IDs, or substitute undocumented placeholders. Static inputs can be supplied with `--file`. Bash variables must use `INSTRILO_` prefixes, never HOME/CODEX_HOME.
- Every executable block needs an observable success condition (`expected`). Expected unsuccessful commands must explicitly inspect their exit code. Assertions can follow command execution in the same block if useful to users.
- A step may have `manualCode` instead of `code` for an explicitly account-dependent action that the runner must not execute. The step must explain its unverified prerequisite, expected outcome and cost implications where relevant. Do not call the whole guide end-to-end verified if it contains manual account steps.
- Fixture services are named demonstrations, not real model inference. Prefer bundled deterministic localhost services over paid APIs. Helpers must be transparent, bounded and documented. Start background services using tracked PIDs and a shell EXIT trap; never kill by a broad process name.
- Only add optional cloud/account steps after the tested local path. Nothing in a tutorial should deploy a billable cloud service by default.
- Tests run on macOS and Linux CI. Windows guidance uses WSL. Python guides must document Python and uv prerequisites; TypeScript is available from the repository's Node.js install.
