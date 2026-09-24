# Provider connections

Connections name a transport and model. Builder, runtime and judge can use different connections. Secrets are environment-variable references, never values in a project file. The explicit `demo` provider is offline; it does not measure model quality or fabricate a judge score. No live provider falls back to demo.

## API connections

| Kind | Protocol | Default base URL |
| --- | --- | --- |
| `openai` | OpenAI chat completions | `https://api.openai.com/v1` |
| `anthropic` | Native Anthropic Messages | `https://api.anthropic.com/v1` |
| `xai` | OpenAI-compatible chat completions | `https://api.x.ai/v1` |
| `gateway` | OpenAI-compatible chat completions | Required |
| `ollama` | Ollama OpenAI compatibility | `http://127.0.0.1:11434/v1` |

Set an explicit model; Ollama defaults to `llama3.2`, which must already be installed. Base URLs include the API version prefix, not the final `/messages` or `/chat/completions` path. HTTPS is mandatory except literal loopback development hosts. URLs cannot contain embedded credentials, query strings or fragments. Redirects are rejected to prevent forwarding credentials to an unexpected endpoint.

Authentication choices:

- `api-key`, with `env`: Bearer authentication, or Anthropic's `x-api-key` header.
- `bearer-env`, with `env`: an already-issued Bearer token, including a gateway JWT. This adapter does not mint or validate the gateway's JWT.
- `oauth-client-credentials`, with `tokenUrl`, `clientIdEnv`, `clientSecretEnv`, optional `scope` and `audience`: OAuth `client_credentials` with `client_secret_post`. The token cache includes the full grant configuration and actual current environment values; renewal occurs before expiry. Servers requiring other client authentication methods need a gateway or externally supplied bearer token.
- `none`: local Ollama or a gateway that deliberately permits unauthenticated access.

The connection diagnostic checks configuration and environment presence only. It does not contact an API, exchange an OAuth token, verify a model, or prove credentials work. Live generation is required for those checks. Response bodies and CLI output are bounded to 4 MiB, and generation respects timeout/cancellation. Error messages omit upstream bodies and stderr, which may contain credentials.

The text-generation adapter does not execute API tool calls. Generated runtime implementations own the explicit tool loop. An API response containing only a tool call is an error here. JSON mode is provider-dependent; the caller must validate the actual result. Anthropic JSON generation uses instructions rather than a schema guarantee.

## Existing CLI subscriptions

`codex-cli`, `claude-code` and `grok-cli` start the installed, unmodified provider binary with `shell: false`. Set `auth.type: none`; authenticate using the provider's own CLI. This application never opens or extracts the provider's credential files. It preserves the process environment, so a provider's configured API credentials can affect billing: verify the active login in the provider CLI.

Use recent CLI versions. The adapters pass bounded prompt tasks through noninteractive JSON output. Codex uses its read-only sandbox, disables approval escalation and skips user configuration while retaining its own authentication. Claude disables tools and customizations using `--tools '' --safe-mode`. Grok disables built-in tools, denies tool execution, disables subagents/web access and limits the turn count. These adapters support builder/judge tasks and a local native runtime without application tools; they do not turn subscriptions into arbitrary framework API credentials. API output-token limits are enforced in requests; CLI output is byte/time bounded and the CLI controls its token budget.

No live subscription request is made by the automated provider tests. They use mock executables to test arguments, JSON envelopes, cancellation and errors. Provider policy or future CLI versions can change; run a deliberate live smoke test in your own account before relying on an integration.

On POSIX systems, cancellation and timeout terminate the CLI process group, including ordinary child processes, before returning a failure. Windows currently terminates the launcher process only; descendant-process cleanup needs a Windows job-object implementation before relying on the same guarantee there.

## Provider-specific subscription terms

Verified against current official documentation on September 23, 2026:

- Anthropic's [Agent SDK billing notice](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) says the announced June 15 change was paused: Agent SDK and `claude -p` usage still draw subscription limits. The announced monthly SDK credits are not available.
- [Claude authentication](https://code.claude.com/docs/en/authentication) documents user-owned CI with `claude setup-token` and `CLAUDE_CODE_OAUTH_TOKEN`. This is different from extracting an existing session token. In noninteractive mode an `ANTHROPIC_API_KEY` takes precedence and can result in API charges.
- [Claude legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) allows hosting the unmodified binary subject to commercial terms and each user authenticating themselves; it prohibits developers collecting/intermediating subscription credentials or reselling usage. [Agent SDK documentation](https://code.claude.com/docs/en/agent-sdk/overview) still requires prior approval for third-party subscription login/rate-limit offerings. A generic custom OAuth proxy is not covered by this adapter.
- xAI explicitly documents [headless scripts and ACP](https://docs.x.ai/build/cli/headless-scripting), [device-code login for remote environments](https://docs.x.ai/build/enterprise), and [subscription-backed Grok Build](https://x.ai/news/grok-build-cli). Its [Grok FAQ](https://docs.x.ai/grok/faq) includes API in a shared weekly usage breakdown. However, the [API-key quickstart](https://docs.x.ai/developers/quickstart) still requires Console credits: do not assume a normal API key consumes subscription allowance. This application uses the official CLI login for subscription access.

The local-only restriction on CLI runtime connections is an application capability limit, not a claim that providers forbid all personal remote/CI use. Exported cloud workloads should use a supported API connection and deployment-managed secrets.
