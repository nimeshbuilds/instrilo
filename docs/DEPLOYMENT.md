# Deployment adapter design

The generator exports executable source and reviewable deployment artifacts. It never invokes a deployment command during generation. A cloud runtime and a chat application are separate destinations: the runtime hosts an API; host adapters make a local or remote tool available to a client.

| Target | Generated artifacts | Operator prerequisites |
| --- | --- | --- |
| Local | Python/TypeScript CLI and `/ping`, `/invocations` HTTP service | Runtime dependencies, provider login/key, reviewed guidance |
| Docker | Dockerfile, Compose, launch script | Docker, environment credentials, configured inbound JWT |
| AWS AgentCore | ARM64 image build/ECR script, runtime JSON, scoped IAM/trust scaffolds | AWS account/region, execution role, ECR permissions, Secrets Manager references, IAM or configured OIDC identity |
| Cloud Run | AMD64 image script, Secret Manager references | Artifact Registry repository, service account, Cloud Run IAM plus application JWT |
| Azure Container Apps | Container-app resource JSON, image deployment script | Environment/registry/identity, registry pull and Key Vault access, JWT identity provider |

Python frameworks are native, LangGraph, OpenAI Agents SDK and CrewAI. TypeScript supports native, LangGraph and OpenAI Agents SDK. Generating an unsupported language/provider/framework pairing raises an error. Native CLI session runtimes require local delivery and no HTTP tools. This is intentional: a local subscription-authenticated CLI is not a cloud API credential or a portable tool-calling transport.

Generated projects expose `python agent.py --input TEXT` or `npx tsx agent.ts --input TEXT`, printing `{output, trace, usage?}`. Usage is included only when the provider or SDK reports token counts. The evaluator invokes that entrypoint to exercise the selected framework. The output is a starting point, not a statement that cloud deployment or model quality has been validated.

The generated stdio MCP bridge runs in Codex, Claude Code or Claude Desktop after the operator merges a configuration fragment with an absolute project path. ChatGPT uses the generated mcp_http Python/TypeScript entrypoint as a remote HTTPS MCP server. It includes JWT enforcement, OAuth protected-resource metadata and a /mcp tool surface. Hosting, an external OAuth authorization service and ChatGPT connection/registration remain operator configuration. Dockerfile.mcp selects the remote entrypoint; ordinary deployment scripts select the REST entrypoint. `AGENTS.md`, `CLAUDE.md` and skills guide coding hosts; they are not hosting infrastructure.

## AWS contract and limitations

AgentCore HTTP containers currently require `linux/arm64`, `0.0.0.0:8080`, `POST /invocations`, `GET /ping` and an ECR image. The scaffold generates a container deployment rather than the separate CodeZip route. JWT mode configures an OIDC authorizer, allowed audience and Authorization forwarding, then the application independently verifies signatures/claims. IAM mode binds the application only behind AgentCore's authenticated API; never reuse its `PLATFORM_AUTH=aws-iam` bypass for an exposed standalone container.

Cloud Run uses `linux/amd64` and an injected `PORT`; an AgentCore ARM image is not a universal cloud artifact. Azure uses explicit ingress `targetPort`. Check region availability, architecture, current quotas, supported SDK/runtime versions, networking, secrets and IAM in the actual account. Commit the generated dependency lockfile before release and rebuild images as dependencies/base images are patched.

The AWS runtime resolves `ENV_NAME_SECRET_ARN` through Secrets Manager and the runtime role. GCP/Azure use platform secret injection. Secrets are excluded from Docker build context and artifacts. Client-credentials OAuth is supported for outbound model gateways; interactive delegated OAuth is a separate integration.

Cloud scripts initially scaffold create operations; a complete production release system additionally needs version promotion/rollback, durable state, concurrency/rate controls, observability, tenant-specific tool authorization and an audited approval service. Exact-call approval digests are enforced, but the starter is not a durable one-time approval ledger.

References checked during implementation:

- [AWS HTTP contract](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-http-protocol-contract.html)
- [AWS custom container deployment](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/getting-started-custom.html)
- [AWS IAM permissions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-permissions.html)
- [AWS inbound OAuth and token forwarding](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-oauth.html)
- [AWS direct CodeZip deployment](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-code-deploy.html)
- [Cloud Run container contract](https://docs.cloud.google.com/run/docs/container-contract)
- [Azure Container Apps ingress](https://learn.microsoft.com/en-us/azure/container-apps/ingress-how-to)
