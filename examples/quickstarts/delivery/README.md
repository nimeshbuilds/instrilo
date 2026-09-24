# Delivery walkthrough fixtures

These files support scenarios 6–10 on the Instrilo documentation site. They are
examples, not production configuration or model quality evidence.

- `fixture.mjs DIR` listens on an operating-system-assigned loopback port. It
  writes connection and tool JSON files plus `ready.json` into DIR. It uses only
  in-memory counters and fixed responses. It makes no external requests and
  stops after ten minutes. The walkthrough tracks its PID and stops it earlier.
- `control.mjs DIR ready` waits up to five seconds and checks readiness.
  `counts` reads model/tool request counts. `bad` changes only this fixture's
  runtime answer to demonstrate a regression without changing the dataset.
- The judge fixture checks an exact string. It exercises independent runtime
  and judge connections, the scoring contract, and report comparisons. It is
  **not an LLM** and cannot measure semantic correctness.
- The tool fixture proposes a read followed by a write. The write changes only
  an in-memory counter. Approval and replay run through the real generated
  native TypeScript runtime and Instrilo CLI.
- Datasets remain honestly labeled `synthetic`. The review walkthrough records
  an abstention and verifies that the default release policy rejects the demo.
- `verify.mjs CHECK PROJECT` contains the walkthroughs' readable assertions. It
  only reads tutorial outputs and prints the verified facts, or exits nonzero
  if something differs. It never substitutes for running the real CLI.
- `review-label.mjs PROJECT` creates `abstention.json` with the saved demo report
  ID, the fixed tutorial reviewer label and an explicit reason for abstaining.
  It does not register the label; the next visible CLI command does that.
- `openai.json` references an environment variable and a documented model ID.
  Artifact generation makes no API request. A real deployment requires your
  own supported model access, credentials and current platform prerequisites.

Run each walkthrough in its own shell from the cloned repository root after
`npm ci` and `npm run build`. The `.studio/tutorials` outputs are ignored by Git.
The full commands and assertions live in `website/scenarios/06-*.json` through
`10-*.json`; the documentation test runner executes those exact strings.
