# Instrilo on GitHub Pages

Public documentation: <https://nimeshbuilds.github.io/instrilo/>.

This is a static documentation site. The Instrilo app runs on the reader's own machine; GitHub Pages does not host agents, collect credentials, or run inference.

## Follow a guide

Install the [built release](../docs/INSTALLATION.md), then prepare the tutorial inputs once. No source checkout is needed to follow any public quickstart:

```sh
instrilo tutorials setup ./instrilo-tutorials
cd ./instrilo-tutorials
```

Use Bash and keep the same terminal for every step in one guide. Reuse the prepared folder for another guide, or choose a new folder for a fresh run. The tenth guide covers a complete agent build with architecture, graph, judge, evaluation evidence, and artifacts for supported clouds.

## Contributor workflow: build and verify

Use Node.js 22+, Python 3.11–3.13, and uv. From the repository root:

```sh
npm ci --ignore-scripts
npm run build
npm run test:scenarios
npm run site:build
node --import tsx --test tests/site.test.ts
```

If the desired Python interpreter is not the system default, set `NB_AGENT_PYTHON` to its absolute path when running `npm run test:scenarios`. The generated Python project uses an isolated uv environment. Scenario checks can download public packages but do not call paid models, install global provider/container clients, log in, or deploy cloud resources.

The scenario runner executes the public `instrilo` commands from an isolated installation, sets up bundled tutorial inputs, and executes every `code` block in order in one Bash session per guide in a fresh temporary workspace. Required inputs and deterministic local fixtures live in `examples/quickstarts`. A failed command, missing completion checkpoint, or changed source prevents a passing result. JSON evidence contains scope, step counts, date, platform, duration, and a fingerprint of the exact guide, CLI source, dependencies and example files. `manualCode` blocks are excluded and visibly identified as account-dependent or otherwise unverified. A passing badge applies only to the stated tested steps.

The temporary workspace is removed after each scenario. Fixtures shut down their own recorded process IDs through an EXIT trap. Shared package caches remain. Evidence is generated as `website/verification.json` and is intentionally not committed. Without fresh matching evidence the site shows an unverified status, never a fabricated passing result.

Use `node scripts/test-scenarios.mjs --only SCENARIO_ID --output /tmp/instrilo-scenario.json` for one guide. The default full run is required before publication. Read [AUTHORING.md](AUTHORING.md) before editing a guide.

## Publication

`.github/workflows/pages.yml` verifies all ten guides on Linux, builds the site, checks links/assets/content, and uploads only `_site`. Deployment depends on the successful verification job. Pull requests test and build without publishing. The repository Pages source is GitHub Actions; deployment uses the official pinned Pages actions and its `github-pages` environment.

Brand masters are under `assets/brand`. The site uses local assets and system fonts, with no analytics, external font service, or account form. Search and copy controls enhance static HTML; the guides remain readable without JavaScript.
