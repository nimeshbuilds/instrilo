# Foundation tutorial fixtures

These inputs back the first five executable website walkthroughs. They contain synthetic policy/order data and obvious demonstration credentials, never real accounts.

`fixture.mjs` starts one loopback HTTP server on an available port. It implements an OpenAI-compatible chat endpoint, an OAuth client-credentials token endpoint, a read-only order lookup, health and request counters. Builder, runtime and judge responses are deterministic. API-key, bearer and OAuth requests are actually transmitted and validated, but no cryptographic JWT signing or real identity provider is involved.

`files` writes example connection and tool JSON with the actual temporary port. It does not modify an Instrilo manifest; the public commands import those documents. `wait` allows at most ten seconds for readiness. The server limits request size/time and stops after fifteen minutes even if the tutorial is abandoned; each guide also uses a tracked PID and EXIT trap.

`verify.mjs CHECK PROJECT` contains the guides' read-only assertions. It reads the JSON files saved by visible CLI commands, checks outputs, traces, role assignments and fixture request counts, and prints a human-readable success message. It never writes files, calls a model, installs dependencies or starts a service. Keeping these checks in a source file leaves the copyable quickstart commands easy to scan.

`answers.json` demonstrates all ten guidance questions. `guidance/product.md` demonstrates a pre-existing product-guidance directory. `role-cases.jsonl` deliberately labels the example synthetic. Replace these with reviewed requirements and task-specific evaluations before using a live model or making a release decision.

The tutorials use Node.js 22+ and Bash from the cloned, built repository. Python additionally needs uv and Python 3.11–3.13. Preparing a generated agent downloads its declared packages from npm or PyPI; offline model execution does not mean dependency installation is offline.
