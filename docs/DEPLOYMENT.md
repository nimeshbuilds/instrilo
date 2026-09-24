# Deployment contracts and evidence

Instrilo generates a platform contract in `generated/deployment-plan.json` and a project-specific runbook in `generated/DEPLOYMENT.md`. The runbook includes prerequisite tools/accounts, architecture, identity and secret configuration, build and registry steps, live invocation, logs, troubleshooting and removal of resources you own. Platform requirements were checked against official documentation on **2026-09-24**.

| Target | Container architecture | Network/authentication |
| --- | --- | --- |
| Local | Host | Loopback by default; JWT for remote access |
| Docker | Host Linux container architecture | Host loopback publication, application JWT |
| AWS AgentCore | `linux/arm64` | `0.0.0.0:8080`, `/ping`, `/invocations`; AgentCore IAM or JWT |
| Cloud Run | `linux/amd64` | Injected `PORT`, Cloud Run IAM plus application JWT |
| Azure Container Apps | `linux/amd64` | HTTPS ingress to 8080, application JWT, pre-created user-assigned identity |

The generated AWS adapter builds an ARM64 ECR image. Cloud Run and Azure build AMD64, including on Apple Silicon. Cloud scripts currently use Docker buildx; local deployment tests accept Docker or Podman. An engine running another architecture needs a native builder or configured emulation. Instrilo does not silently install privileged emulation handlers.

## Inspect and test

Use the source project containing `agent-studio.yaml`; regenerate artifacts after changing it. Generation does not deploy, authenticate to a cloud, or certify the result.

```bash
instrilo deployment platforms
instrilo deployment guide ./my-agent
instrilo deployment prerequisites ./my-agent --engine docker
instrilo deployment engine status docker
instrilo deployment test ./my-agent --engine docker
instrilo deployment test ./my-agent --engine docker --execute
instrilo deployment reports ./my-agent
```

The first test command is a plan. Explicit execution builds a fixture copy of the actual generated application, retaining its framework, Dockerfile stages, server and startup command. A deterministic local model and temporary identity replace live model/identity prerequisites in the test copy. JWT configurations exercise valid and denied requests. IAM configurations report that outer AWS IAM has not been tested. Tool endpoints are mocked without proving their business behavior; run the tool-specific tests and reviewed task evaluations separately.

Image/dependency building can download packages and base images. The test runtime uses an internal container network without public port publication or real credentials. The report records architecture, assertions, failures, skipped checks and limitations. JSON and Markdown evidence remains in `.instrilo/deployment-tests/RUN_ID/` in the source project. Passing local mocks does not validate cloud permissions, secret access, registry pulls, model entitlement, quotas, cost, latency or availability.

## Dependency help and cleanup

```bash
instrilo deployment engine install docker
instrilo deployment engine install docker --execute
instrilo deployment test ./my-agent --engine docker --execute --keep
instrilo deployment cleanup RUN_ID ./my-agent
instrilo deployment cleanup RUN_ID ./my-agent --execute
instrilo deployment engine cleanup docker
# Docker Desktop removal follows the manual instructions in this plan.
instrilo deployment engine cleanup podman
instrilo deployment engine cleanup podman --execute
# Optional whole-disk removal of the dedicated owned Podman VM:
instrilo deployment engine cleanup podman --remove-machine-data
instrilo deployment engine cleanup podman --remove-machine-data --execute
```

Installation and cleanup first show a platform-specific plan. Automated installation depends on the host and available package manager; the plan explains manual steps when needed. Start Docker Desktop or the Podman machine before testing. Automatic engine cleanup is available only for an eligible owned Podman installation/VM on macOS after workload checks. Docker Desktop removal follows reviewed manual instructions. Retained base images or other data block default empty-VM removal. The optional `--remove-machine-data` plan inventories rootless/rootful storage in the receipt-owned VM. Its execution removes the entire VM disk, including any unrelated work you later placed in that dedicated VM; inspect the inventory before opting in. The option does not authorize deletion of a pre-existing or foreign VM. Instrilo only removes installations it can establish it owns. Pre-existing engines and resources outside an explicitly selected owned VM remain intact. Run cleanup removes that run’s recorded resources, retains evidence and reports anything it could not remove. Never use global `system prune` as project cleanup.

Cloud resource deletion is separate. Follow the generated runbook using exact resource IDs, inventory what this deployment created and keep shared resources. Cloud commands incur costs only when the operator executes them; test cleanup does not delete cloud resources.

## Platform-specific implementation choices

AWS uses the HTTP container route, with scoped execution-role templates, secret ARN references, an explicit ARM64 build and validation before pushing. JWT requests use the HTTPS runtime endpoint; IAM calls use the signed AWS CLI. Runtime ID/status and caller identity must be verified in the real account. [AWS HTTP contract](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-http-protocol-contract.html), [IAM permissions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-permissions.html), [invocation CLI](https://docs.aws.amazon.com/cli/latest/reference/bedrock-agentcore/invoke-agent-runtime.html).

Cloud Run keeps platform IAM enabled and uses an independent runtime service account for Secret Manager. Callers send the Google ID token in `X-Serverless-Authorization` and the application JWT in `Authorization`. The generated script bounds concurrency and timeout. [Cloud Run contract](https://docs.cloud.google.com/run/docs/container-contract), [service authentication](https://docs.cloud.google.com/run/docs/authenticating/service-to-service), [secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets).

Azure uses a user-assigned identity prepared before deployment for registry pulls and Key Vault references. A system identity does not exist early enough for first-create Key Vault resolution. The canonical JSON configuration uses `environmentId`; a YAML review copy is generated, and the script renders a fresh YAML-compatible JSON document for `az containerapp create --yaml`. Registry hostname is discovered from Azure rather than assumed. [Container support](https://learn.microsoft.com/en-us/azure/container-apps/containers), [configuration schema](https://learn.microsoft.com/en-us/azure/container-apps/azure-resource-manager-api-spec), [identity image pulls](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity-image-pull), [Key Vault references](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets).

Check cloud documentation and actual region/account policy again before production. Source-checked contracts are dated evidence, not a guarantee that a platform will never change.
