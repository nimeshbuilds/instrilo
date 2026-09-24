# Adapter development

Instrilo API v1 adapters are reviewed, locally installed JavaScript bundles. They add generation artifacts or connect a custom model provider through a local gateway. Python and TypeScript projects can use the same adapter bundle; the adapter itself executes with Node.js 22+.

Framework, target, and host adapters **augment** the selected built-in implementation. They write files under `extensions/ADAPTER_ID/`; they do not register new manifest framework names, replace the generated runtime, or bypass its tool approval and authorization checks. Provider adapters become usable connections through `adapters serve` and the existing `gateway` provider kind.

## Create, inspect, install, test, build

From an Instrilo source installation with the CLI linked:

```sh
instrilo init support-agent
instrilo adapters catalog
instrilo adapters init ./deploy-notes --id deploy-notes --kind target
# Edit deploy-notes/entry.mjs and adapter.json; review all bundled files.
instrilo adapters inspect ./deploy-notes
instrilo adapters install ./deploy-notes ./support-agent --trust-code
instrilo adapters test deploy-notes ./support-agent
instrilo adapters list ./support-agent
instrilo build ./support-agent
instrilo artifacts read extensions/deploy-notes/README.md ./support-agent
```

`inspect` validates files and computes their content pin without executing the entrypoint. Installation requires `--trust-code`, copies the bundle into the project, and records its manifest, SHA-256 pin, and individual file hashes. Editing the original source directory does not change the installed copy.

After changing an adapter:

```sh
instrilo adapters inspect ./deploy-notes
instrilo adapters install ./deploy-notes ./support-agent --trust-code --replace
instrilo adapters test deploy-notes ./support-agent
instrilo build ./support-agent --overwrite
```

Inspect and reinstall intentionally; changing an installed bundle in place makes future invocation fail its pin check. Increment the adapter version when distributing a changed implementation. `--replace` permits an explicit replacement even if the version string remains the same.

To disable an adapter and regenerate:

```sh
instrilo adapters remove deploy-notes ./support-agent
instrilo build ./support-agent --overwrite
```

Removal retains pinned bundles on disk. The next build removes unchanged, obsolete generated extension files; modified files follow the normal regeneration preservation/conflict rules. See [Regeneration](REGENERATION.md).

## Manifest and bundle

`adapter.json` is a strict JSON object:

```json
{
  "schemaVersion": "1",
  "apiVersion": "1",
  "id": "deploy-notes",
  "version": "0.1.0",
  "kind": "target",
  "description": "Generate deployment review notes for a project.",
  "entry": "entry.mjs",
  "operations": ["generate"],
  "languages": ["python", "typescript"],
  "permissions": {
    "environment": [],
    "network": false,
    "filesystem": false
  }
}
```

- IDs contain 2–63 lowercase letters, digits, or hyphens and start with a letter.
- Versions use `major.minor.patch`, optionally followed by a lowercase prerelease suffix.
- `kind` is `provider`, `framework`, `target`, or `host`. Only a provider can declare `complete`; every kind can declare `generate`.
- `operations` contains `generate`, `complete`, or both, with no duplicate operations.
- `languages` lists the supported generated languages. Builds refuse a generating adapter that does not support the selected language.
- `entry` names a bundled `.mjs` file with an ASCII relative path. Use Node built-ins or bundle external dependencies into the source distribution.
- `permissions.environment` lists at most 30 uppercase environment variable names. Store references here, never values. Process/loader controls such as `NODE_OPTIONS`, `PATH`, `HOME`, `LD_*`, `DYLD_*`, and reserved `INSTRILO_*` names cannot be forwarded.
- `network` and `filesystem` describe the adapter's intended access. They are disclosure fields, **not an enforced sandbox**.

Bundles allow at most 2,000,000 total content bytes, 100 regular files, 200 filesystem entries, and 16 directory levels. Paths are limited to 512 UTF-8 bytes. Hidden files, `node_modules`, symbolic links, special files, absolute/traversal paths, and backslashes are rejected. The manifest is limited to 64,000 bytes. Never include credentials in a bundle: these checks do not constitute a general secret scanner.

## Entry interface

Export a default function from the entrypoint. It receives one JSON request and returns a JSON-compatible value, directly or through a promise. Validate `apiVersion`, the operation, and required inputs; throw an error for unsupported or invalid requests. No SDK import is required.

Each invocation gets a fresh subprocess with its working directory set to the pinned bundle. Persistent state must be deliberate; module globals do not survive calls. Return the result rather than printing protocol JSON. Ordinary `console.log`, `console.info`, and `console.debug` diagnostics are redirected to stderr. Direct writes to stdout can corrupt the machine response.

### Generation

Request:

```ts
{
  apiVersion: '1',
  operation: 'generate',
  spec: ProjectSpec,
  guidance: { files: GuidanceFile[], combined: string }
}
```

`spec` is the validated manifest with inspected guidance applied. Guidance file records include their relative path, content, and SHA-256; use only fields your adapter needs. See [types.ts](../src/types.ts) for the complete `ProjectSpec` and `GuidanceFile` declarations.

Example implementation:

```js
export default async function (request) {
  if (request.apiVersion !== '1' || request.operation !== 'generate') {
    throw new Error('Unsupported operation');
  }
  if (!request.spec || !['python', 'typescript'].includes(request.spec.language)) {
    throw new Error('Language required');
  }
  return {
    artifacts: [{
      path: 'extensions/deploy-notes/README.md',
      content: `# Deployment review\n\nProject: ${request.spec.name}\n`
    }]
  };
}
```

Return at most 100 unique artifacts and 2,000,000 total content bytes per adapter. Paths must remain under `extensions/<manifest.id>/`. Hidden/traversal paths and executable artifacts are rejected. Generation does not execute returned files or automatically import them into the runtime.

### Model completion

Request:

```ts
{
  apiVersion: '1',
  operation: 'complete',
  model: string,
  messages: Array<unknown>,
  // Other OpenAI-compatible request fields are passed through.
}
```

Return a completion result rather than the outer OpenAI HTTP envelope:

```json
{
  "model": "my-model",
  "message": { "role": "assistant", "content": "The answer." },
  "usage": { "prompt_tokens": 12, "completion_tokens": 4, "total_tokens": 16 }
}
```

`usage` is optional; counts must be nonnegative integers. `message.content` is a string or `null`. Optional `message.tool_calls` uses OpenAI function calls with `id`, `type: "function"`, and `function: { name, arguments }`; `arguments` is a JSON string. The adapter must implement whichever request features its selected model/framework needs. Interface conformance does not prove tool calling or structured-output quality. Builder/judge text generation requires assistant text; it does not handle tool-only responses.

## Use a provider through the local gateway

```sh
instrilo adapters init ./provider-adapter --id local-provider --kind provider
# Implement entry.mjs; declare upstream credential variable names in adapter.json.
instrilo adapters inspect ./provider-adapter
instrilo adapters install ./provider-adapter ./support-agent --trust-code
instrilo adapters test local-provider ./support-agent
export ADAPTER_GATEWAY_TOKEN="$(openssl rand -hex 32)"
instrilo adapters serve local-provider ./support-agent --token-env ADAPTER_GATEWAY_TOKEN
```

The scaffold returns labeled fixture text. Replace it before live use. An adapter should return a deterministic local response when `process.env.INSTRILO_ADAPTER_FIXTURE === '1'`; conformance withholds declared environment variables.

Keep the serving process running. Its default endpoint is `http://127.0.0.1:4320/v1`; `--port` accepts 1024–65535. Create a connection document containing environment references:

```json
{
  "kind": "gateway",
  "model": "my-model",
  "baseUrl": "http://127.0.0.1:4320/v1",
  "auth": { "type": "bearer-env", "env": "ADAPTER_GATEWAY_TOKEN" }
}
```

Save it as `local-provider.json`, then use it independently for the desired roles:

```sh
instrilo connections add local-provider ./support-agent --file ./local-provider.json
instrilo connections use builder local-provider ./support-agent
instrilo connections use runtime local-provider ./support-agent
instrilo connections use judge local-provider ./support-agent
instrilo build ./support-agent --overwrite
```

The launching environments for Instrilo and the generated runtime need the same `ADAPTER_GATEWAY_TOKEN`. The serving process separately needs the upstream credentials declared by the adapter. The gateway token is not forwarded to an adapter unless explicitly declared. A cloud deployment cannot reach this laptop loopback endpoint; configure a reachable authenticated gateway for cloud use.

The bridge supports authenticated, non-streaming `POST /v1/chat/completions` only. It requires `Authorization: Bearer TOKEN` with a token of at least 24 characters, binds IPv4 loopback, validates Host, and refuses browser-origin requests. This bridge uses a shared bearer token; it is not a JWT issuer/verifier or a remote multi-tenant service. Upstream custom authentication belongs in the reviewed provider implementation or an existing gateway; see [Providers](PROVIDERS.md).

Requests are capped at 1,000,000 bytes, eight concurrent operations, and a 30-second request deadline. Each adapter invocation has a 15-second default deadline. Disconnecting a client cancels its running invocation. The bridge returns generic failure responses so upstream credential-bearing error text is not exposed to clients.

## Conformance, isolation, and provenance

`adapters test` checks generation envelopes for every declared language, provider completion envelopes, and rejection of unknown operations and missing inputs. It returns structured checks and a nonzero CLI exit status on failure. It withholds declared credentials and sets fixture mode, but does not block network access or certify a provider, framework, cloud deployment, or security boundary.

The worker receives only the basic execution environment (`PATH`, `NODE_ENV`, fixture flag) plus declared variables in normal mode; an operating system may add its own startup variables. Recognized credential values are redacted from surfaced worker errors. Do not intentionally put credentials in returned artifacts or completion results: successful content is the adapter's responsibility.

Requests, results, and diagnostics have separate 2,000,000-byte limits. Timeout/cancellation terminates the subprocess group on macOS/Linux/WSL, including ordinary descendants. Explicitly trusted code can read files, make network calls, or create detached processes outside this control; Instrilo does not provide OS sandboxing for adapters.

Installed records live in `PROJECT/.instrilo/adapters.json`; bundles live in `.instrilo/adapters/ID/SHA256/`. Generation records adapter pins in `build-lock.json` and generation metadata. Installation, removal, and the build's extension generation plus pin capture share `.instrilo/adapters.lock`. Concurrent mutation fails rather than pairing artifacts with a different pin. Dry-run previews use read-only pin checks before and after generation and do not create registry metadata; applying a reviewed plan regenerates under the lock and validates the plan hash. Preview still invokes trusted generator code, whose own side effects remain its responsibility. A completed build can intentionally retain its previous pin until the next rebuild.

Locks fail closed after a process crash. Inspect the owning PID and operation before manually recovering a stale lock; never remove a live operation's lock. Content pins detect changes, but they are not publisher signatures or protection against a malicious local user who can modify both code and registry.
