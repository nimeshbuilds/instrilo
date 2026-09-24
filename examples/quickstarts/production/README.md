# Complete agent walkthrough fixtures

Use the installed Instrilo CLI:

```sh
instrilo tutorials setup ./instrilo-tutorials
cd instrilo-tutorials
instrilo tutorials show deployment-artifacts
```

Follow [scenario 10](https://nimeshbuilds.github.io/instrilo/quickstarts/deployment-artifacts/) and the [real-account continuation](https://github.com/nimeshbuilds/instrilo/blob/main/docs/PRODUCTION-WALKTHROUGH.md).

- `answers.json` covers the ten product-guidance interview sections.
- `architecture.md` explains LangGraph, tool, identity, judge, evidence and delivery boundaries.
- `fixture.mjs` provides deterministic loopback-only builder/runtime/judge/policy routes. It is not an LLM. The shell owns its PID; it also stops after 15 minutes.
- `cases.jsonl` contains two **synthetic** examples with distinct development/holdout splits. The holdout example verifies workflow wiring, not independent quality.
- `requirements.json` contains proposed requirements, with no fabricated human reviewer.
- `policy.json` requires real holdout/deterministic/human evidence and forbids demo/synthetic/waived evidence.
- `cloud-*.json` are inspectable provider/tool templates with `.invalid` addresses, explicit model placeholders and secret environment references. Replace them before live use.
- `verify.mjs` only reads and checks outputs; all generation, runtime, judge, evidence and deployment operations use `instrilo`.

Every generated cloud bundle remains **generated, not deployed**. Automatic checks exercise TypeScript LangGraph with fixtures and all three target artifact sets. Real models, human reviews, container execution and cloud deployment are separately identified manual work.
