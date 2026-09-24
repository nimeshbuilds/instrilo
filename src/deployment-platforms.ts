import type { ProjectSpec, Target } from './types.js';

export interface DeploymentPlatform {
  target: Target;
  architecture: 'linux/arm64' | 'linux/amd64' | 'host';
  port: 8080;
  healthPath: '/ping';
  invokePath: '/invocations';
  prerequisites: string[];
  constraints: string[];
  references: { title: string; url: string }[];
  verifiedAt: string;
}

const verifiedAt = '2026-09-24';
const common = { port: 8080 as const, healthPath: '/ping' as const, invokePath: '/invocations' as const, verifiedAt };
const platforms: Record<Target, DeploymentPlatform> = {
  local: { ...common, target: 'local', architecture: 'host',
    prerequisites: ['Python 3.11–3.13 with uv, or Node.js 22+ with npm, for the selected language', 'Configured API environment variables or a supported local provider CLI session'],
    constraints: ['Unauthenticated HTTP binds loopback only; remote access requires application JWT.', 'Local CLI subscriptions cannot be copied into cloud deployments.', 'Port 8080 is the default; delivery.port or PORT can override local binding.'],
    references: [{ title: 'Python environments', url: 'https://docs.astral.sh/uv/guides/projects/' }, { title: 'Node.js releases', url: 'https://nodejs.org/en/about/previous-releases' }] },
  docker: { ...common, target: 'docker', architecture: 'host',
    prerequisites: ['Docker Engine/Desktop and Compose v2 for the generated deploy script', 'A running Linux container engine; Podman is an alternative for Instrilo deployment tests', 'Application JWT identity provider and private environment file'],
    constraints: ['Container listens on 0.0.0.0:8080; generated Compose publishes on host loopback only.', 'Application JWT remains required for /invocations.', 'macOS/Windows container engines require a Linux virtual machine; cross-architecture tests need compatible emulation.'],
    references: [{ title: 'Docker installation', url: 'https://docs.docker.com/engine/install/' }, { title: 'Docker multi-platform builds', url: 'https://docs.docker.com/build/building/multi-platform/' }, { title: 'Podman installation', url: 'https://podman.io/docs/installation' }] },
  'aws-agentcore': { ...common, target: 'aws-agentcore', architecture: 'linux/arm64',
    prerequisites: ['AWS CLI v2 with bedrock-agentcore and bedrock-agentcore-control commands; jq, Bash, Docker with buildx', 'Signed-in AWS operator, supported region, ECR repository and reviewed runtime execution role', 'Deployer permissions for ECR push, runtime creation and iam:PassRole on the execution role', 'Secrets Manager secret ARNs and reachable model/tool/JWKS endpoints'],
    constraints: ['HTTP container must be Linux ARM64, listen on 0.0.0.0:8080, and implement GET /ping and POST /invocations.', 'AWS IAM or configured JWT protects the service endpoint; PLATFORM_AUTH=aws-iam is valid only behind AgentCore IAM.', 'Generated route uses an ECR container, PUBLIC networking and HTTP JSON; it does not provision gateway, memory or remote MCP.', 'This adapter uses the project name as its ECR repository name: at least 2 characters, ending in a letter or digit.', 'Runtime session identifiers must be 33–256 characters. This agent accepts {"input":"..."}, not the documentation sample prompt field.'],
    references: [{ title: 'AgentCore HTTP container contract', url: 'https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-http-protocol-contract.html' }, { title: 'AgentCore IAM permissions', url: 'https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-permissions.html' }, { title: 'InvokeAgentRuntime CLI', url: 'https://docs.aws.amazon.com/cli/latest/reference/bedrock-agentcore/invoke-agent-runtime.html' }, { title: 'AgentCore JWT', url: 'https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-oauth.html' }, { title: 'ECR repository naming', url: 'https://docs.aws.amazon.com/AmazonECR/latest/APIReference/API_CreateRepository.html' }, { title: 'AWS CLI installation', url: 'https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html' }] },
  'cloud-run': { ...common, target: 'cloud-run', architecture: 'linux/amd64',
    prerequisites: ['Google Cloud CLI, jq, Bash, Docker with buildx', 'Billing-enabled project; Cloud Run, Artifact Registry and Secret Manager APIs', 'Docker Artifact Registry repository named agents in GCP_REGION', 'Runtime service account with secret access; deployer with deployment, repository push and service-account actAs rights'],
    constraints: ['Image must contain Linux x86_64/amd64; listen on 0.0.0.0 and the injected PORT (8080 here).', 'Cloud Run terminates TLS; container serves HTTP. Local filesystem is ephemeral.', 'Generated service requires Cloud Run IAM plus application JWT. Send Google ID token in X-Serverless-Authorization and application token in Authorization.', 'Do not rely on in-memory state across instances; align model deadlines with request timeout and bound concurrency.', 'Service names must contain fewer than 50 characters and end in a letter or digit.'],
    references: [{ title: 'Cloud Run container contract', url: 'https://docs.cloud.google.com/run/docs/container-contract' }, { title: 'Cloud Run service authentication', url: 'https://docs.cloud.google.com/run/docs/authenticating/service-to-service' }, { title: 'Cloud Run secrets', url: 'https://docs.cloud.google.com/run/docs/configuring/services/secrets' }, { title: 'Cloud Run service naming', url: 'https://docs.cloud.google.com/run/docs/reference/rpc/google.cloud.run.v2' }, { title: 'Google Cloud CLI installation', url: 'https://docs.cloud.google.com/sdk/docs/install' }] },
  'azure-container-apps': { ...common, target: 'azure-container-apps', architecture: 'linux/amd64',
    prerequisites: ['Azure CLI with containerapp extension, jq, Bash, Docker with buildx', 'Registered Microsoft.App and Microsoft.OperationalInsights providers, resource group and Container Apps environment', 'Azure Container Registry and pre-created user-assigned managed identity with AcrPull', 'Key Vault secret references and Key Vault Secrets User access for that identity; application JWT issuer'],
    constraints: ['Linux amd64 image; ingress targetPort 8080, HTTPS externally and HTTP inside the container.', 'Private registry pulls and Key Vault references use the pre-provisioned identity on the first revision.', 'ACR must allow ARM audience tokens for managed-identity image pulls; role assignments may take time to propagate.', 'The generated service has external ingress protected by application JWT; it does not automatically configure Azure Easy Auth.', 'The CLI guide requires an application name of 2–31 characters and have no consecutive hyphens. Registry names are globally unique alphanumeric names.'],
    references: [{ title: 'Container Apps container support', url: 'https://learn.microsoft.com/en-us/azure/container-apps/containers' }, { title: 'Container Apps configuration schema', url: 'https://learn.microsoft.com/en-us/azure/container-apps/azure-resource-manager-api-spec' }, { title: 'Managed identity image pulls', url: 'https://learn.microsoft.com/en-us/azure/container-apps/managed-identity-image-pull' }, { title: 'Container Apps secrets', url: 'https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets' }, { title: 'Container Apps CLI naming', url: 'https://learn.microsoft.com/en-us/cli/azure/containerapp' }, { title: 'Azure CLI installation', url: 'https://learn.microsoft.com/en-us/cli/azure/install-azure-cli' }] },
};

export function deploymentPlatform(target: Target): DeploymentPlatform {
  const platform = platforms[target];
  if (!platform) throw new Error(`Unsupported deployment target: ${String(target)}`);
  return structuredClone(platform);
}

export function deploymentPlatforms(): DeploymentPlatform[] { return Object.values(platforms).map(p => structuredClone(p)); }

function code(text: string): string { return '\n```bash\n' + text.trim() + '\n```\n'; }
const list = (items: string[]) => items.map(item => '- ' + item).join('\n');

export function deploymentGuide(spec: ProjectSpec, secretNames: string[]): string {
  const platform = deploymentPlatform(spec.delivery.target);
  const sections = [`# Deployment: ${spec.delivery.target}\n\nGenerated artifacts have not been deployed or tested. Platform documentation checked **${verifiedAt}**; recheck linked requirements before production changes. Commands below use Bash (on Windows, use WSL2). Replace every REPLACE value before execution. Cloud commands create billable resources when you execute them.`,
    `## Prerequisites\n\n${list(platform.prerequisites)}\n\n${spec.language === 'python' ? 'Generated source uses Python 3.11–3.13; the container uses Python 3.12 and uv.' : 'Generated source and container use Node.js 22+ and npm.'} Container dependency downloads need registry access. Keep application credentials in environment variables or a secret manager. Required names: ${secretNames.length ? secretNames.map(n => '`' + n + '`').join(', ') : 'none'}. The .env.example file is a template, not automatically loaded by the source runtime.`,
    `## Platform contract\n\n${list(platform.constraints)}\n\nGenerated HTTP interface: GET /ping returns 200; POST /invocations receives application/json with only {"input":"your task"}. Permissions come from verified identity, never the request body. Configure issuer, audience, JWKS URL, allowed algorithms, scopes and tenant claim in agent-studio.yaml **before building**. Rebuild after source configuration changes.`,
    testingGuide(),
    spec.delivery.target === 'aws-agentcore' ? awsGuide(spec, secretNames) : spec.delivery.target === 'cloud-run' ? cloudRunGuide(spec, secretNames) : spec.delivery.target === 'azure-container-apps' ? azureGuide(spec, secretNames) : localGuide(spec),
    '## Operational checks before serving users\n\nRun reviewed task evaluations, authorization denials, tool failure/timeouts and model budget tests. Confirm live secret access, registry pulls, identity/tenant isolation, network egress, region availability, quotas, cold starts and logs in your actual account. Mock results cannot prove cloud IAM, billing, model entitlement, performance or availability. Set cost alerts, retention and a rollback procedure. Store durable data outside container memory/filesystem. Redact prompts and tokens from retained logs.\n\nHosting and host integration are separate. The generated /invocations service is not an MCP endpoint. ChatGPT uses the separately generated authenticated mcp_http entrypoint and Dockerfile.mcp; see hosts/chatgpt.md if selected. Local coding/desktop hosts use the generated stdio bridge.',
    `## References\n\n${platform.references.map(r => '- [' + r.title + '](' + r.url + ')').join('\n')}\n`,
  ];
  return sections.join('\n\n');
}

function testingGuide(): string {
  return `## Test the deployment before provisioning\n\nRun these commands from your Instrilo source project (the directory containing agent-studio.yaml), not from generated/. Set PROJECT to that directory. A downloaded source export must retain the manifest and generated artifacts; the standalone generated application still supports its README contract tests.\n` + code(`PROJECT=/absolute/path/to/your-instrilo-project
instrilo deployment guide "$PROJECT"
instrilo deployment prerequisites "$PROJECT" --engine docker
instrilo deployment engine status docker
instrilo deployment test "$PROJECT" --engine docker
instrilo deployment test "$PROJECT" --engine docker --execute
instrilo deployment reports "$PROJECT"`) + `\nThe command without --execute previews the test plan. The execution builds/runs a temporary fixture copy for the selected architecture and reports the checks actually performed. The fixture retains the generated framework, server and Dockerfile startup. A local deterministic model and temporary JWT/JWKS identity isolate model usage. IAM mode does not validate outer AWS IAM, and mocked tool URLs do not prove tool business behavior. Read failures, skipped checks and limitations in the report; they are part of the evidence. JSON and Markdown reports remain under .instrilo/deployment-tests/RUN_ID/ in the source project. Runtime network egress is disabled; image/dependency building can still use the network. Dependency downloads may require network access even when model responses are mocked. Cross-architecture builds can fail if emulation is unavailable.\n\nDocker or Podman must have a reachable running Linux engine. On macOS/Windows, start its virtual machine/application. For reviewed installation help use:\n` + code(`instrilo deployment engine install docker
# Review the platform-specific installation plan before opting in:
instrilo deployment engine install docker --execute
# Substitute podman in the test command when using Podman.`) + `\nUse --keep with the test command only when you need its temporary resources for diagnosis. To remove a specific test run, first inspect the cleanup plan and then opt in:\n` + code(`instrilo deployment cleanup RUN_ID "$PROJECT"
instrilo deployment cleanup RUN_ID "$PROJECT" --execute
instrilo deployment engine cleanup docker
# Review Docker Desktop removal using the manual instructions in that plan.
# For an eligible, owned Podman installation/VM, review its plan first:
instrilo deployment engine cleanup podman
instrilo deployment engine cleanup podman --execute
# Optional full removal of the dedicated owned VM, including its disk data:
instrilo deployment engine cleanup podman --remove-machine-data
instrilo deployment engine cleanup podman --remove-machine-data --execute`) + `\nRun cleanup is scoped to resources owned by that run. Automatic dependency removal is limited to an eligible owned Podman installation/VM on macOS after workload checks. Docker Desktop removal and unsupported host/package-manager combinations use reviewed manual instructions. Pulled base images and build cache may remain and block default empty-VM removal. The optional --remove-machine-data plan inventories both rootless and rootful storage in the receipt-owned VM; execution deletes its entire disk, including any other work you placed there. Inspect that inventory before opting in. It does not authorize removal of a pre-existing or foreign VM. Pre-existing engines, unrelated containers/images/volumes, shared cloud resources and provider login credentials are not removed. Do not substitute global prune commands. The report records retained resources and any cleanup failure. Cloud deletion is a separate operator step below.\n`;
}

function localGuide(spec: ProjectSpec): string {
  if (spec.delivery.target === 'local') return '## Local execution\n\nInstall the selected language dependencies using README.md, then run the agent CLI and contract tests. For a CLI subscription runtime, run instrilo setup codex, instrilo setup claude or instrilo setup grok before invoking. The desktop/coding tool owns the login. No Dockerfile is generated for this local target; select docker and rebuild if you want container testing.\n' + code(spec.language === 'python' ? 'uv sync\nuv run python -m unittest discover -s tests\nuv run python server.py' : 'npm install\nnpm run check\nnpm test\nnpx tsx server.ts') + '\nFrom another terminal, GET http://127.0.0.1:' + spec.delivery.port + '/ping. For JWT mode, send an authorized application token to /invocations. Stop the foreground process with Ctrl-C. Remove only this project’s .venv or node_modules if you no longer need its dependencies.\n';
  return '## Docker deployment\n\nFrom generated/, create a private .env file from .env.example, populate the required names, and verify your configured JWT issuer is reachable from inside the container. The Compose binding remains loopback; publishing this behind a reverse proxy requires TLS and a reviewed network policy.\n' + code(`docker version
docker compose version
cp .env.example .env
chmod 600 .env
# Populate .env through your private editor/secret workflow, then:
bash deploy/docker.sh
docker compose ps
curl --fail http://127.0.0.1:${spec.delivery.port}/ping
docker compose logs --tail 100 agent`) + '\nPOST a task with Authorization: Bearer APP_TOKEN and Content-Type: application/json; expect {"output":...}. Missing/invalid tokens must fail. To stop only this deployment run docker compose down from generated/. Images and dependencies remain unless you remove the exact owned image. Never run system-wide prune as project cleanup.\n';
}

function awsGuide(spec: ProjectSpec, names: string[]): string {
  const roleName = spec.name.slice(0, 50) + '-runtime';
  return '## AWS AgentCore: step by step\n\n### 1. Check the operator and builder\n\nInstall AWS CLI v2 from the linked official installer and sign in using your organization’s SSO/profile flow. Configure an execution role separately from the deploying identity. The scripts target the commercial aws partition; adapt ARN/DNS suffixes before using another partition. Run the following from generated/:\n' + code(`export AWS_REGION=REPLACE_REGION
export AWS_PROFILE=REPLACE_PROFILE
aws sso login --profile "$AWS_PROFILE"
aws sts get-caller-identity
aws bedrock-agentcore-control create-agent-runtime --generate-cli-skeleton input >/dev/null
docker info >/dev/null
docker buildx inspect --bootstrap
jq --version`) + '\nThe buildx builder must advertise linux/arm64, including on x86 development machines. Docker Desktop usually supplies emulation; a native Linux host may need administrator-configured binfmt/QEMU or an ARM builder. Do not publish an amd64 image under an arm64-looking tag.\n\n### 2. Prepare ECR, execution identity and secrets\n\nCreate the repository explicitly. Replace all account/region/repository/secret placeholders in deploy/aws-iam-trust.json and deploy/aws-iam-policy.json; review the resulting scoped policy before creating the role. Add kms:Decrypt on the specific key if your secrets use a customer-managed KMS key.\n' + code(`aws ecr create-repository --repository-name ${spec.name} --region "$AWS_REGION"
# If this repository already exists, inspect and reuse it instead.
aws iam create-role --role-name ${roleName} --assume-role-policy-document file://deploy/aws-iam-trust.json
aws iam put-role-policy --role-name ${roleName} --policy-name InstriloRuntime --policy-document file://deploy/aws-iam-policy.json
export AGENTCORE_ROLE_ARN=$(aws iam get-role --role-name ${roleName} --query Role.Arn --output text)`) + `\n${names.length ? 'Create a Secrets Manager secret containing the raw string for each of ' + names.join(', ') + ' using a private secret-entry workflow. Set each NAME_SECRET_ARN in deploy/aws-runtime.json to its exact ARN; the runtime retrieves the value with its execution role.' : 'This configuration has no outgoing credential environment references.'} The deployer needs iam:PassRole for this role and appropriate ECR/runtime permissions; these are not granted by the execution-role policy. If JWT is selected, verify customJWTAuthorizer.discoveryUrl against your issuer’s actual discovery endpoint, configure its audience, and retain Authorization in requestHeaderAllowlist. For IAM mode, only the AgentCore service endpoint may invoke the unauthenticated inner container.\n\n### 3. Build, publish and create the runtime\n` + code(`bash deploy/aws-agentcore.sh
RUNTIME_ID=$(jq -r .agentRuntimeId .deployment/aws-result.json)
RUNTIME_ARN=$(jq -r .agentRuntimeArn .deployment/aws-result.json)
aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id "$RUNTIME_ID" --region "$AWS_REGION"`) + '\nThe script builds linux/arm64, publishes to ECR, and creates a new runtime; it is not an idempotent update command. Keep the result file with the resource ID. Recheck get-agent-runtime until status is READY; inspect failureReason if it fails. Allow IAM propagation before retrying. Review image digests and scan results before endpoint promotion.\n\n### 4. Invoke and inspect logs\n\nUse the branch matching your configured authorization mode. The application input key is input. For IAM, use a caller with bedrock-agentcore:InvokeAgentRuntime permission:\n' + code(`aws bedrock-agentcore invoke-agent-runtime --region "$AWS_REGION" \\
  --agent-runtime-arn "$RUNTIME_ARN" --qualifier DEFAULT \\
  --runtime-session-id instrilo-validation-session-0000000001 \\
  --content-type application/json --cli-binary-format raw-in-base64-out \\
  --payload '{"input":"Reply with a brief greeting."}' .deployment/invocation.json
cat .deployment/invocation.json`) + '\nFor JWT, obtain APP_TOKEN from your configured identity provider using its supported login/client flow and use HTTPS instead of the IAM CLI:\n' + code(`ENCODED_ARN=$(jq -rn --arg arn "$RUNTIME_ARN" '$arn|@uri')
curl --fail-with-body "https://bedrock-agentcore.$AWS_REGION.amazonaws.com/runtimes/$ENCODED_ARN/invocations?qualifier=DEFAULT" \\
  -H "Authorization: Bearer $APP_TOKEN" -H 'Content-Type: application/json' \\
  -H 'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id: instrilo-validation-session-0000000001' \\
  --data '{"input":"Reply with a brief greeting."}'
aws logs describe-log-groups --log-group-name-prefix /aws/bedrock-agentcore/runtimes/ --region "$AWS_REGION"
# Select this runtime's exact returned log group, then:
aws logs tail REPLACE_LOG_GROUP --since 10m --region "$AWS_REGION"`) + '\nAn architecture/exec-format failure means the pushed manifest is wrong; connection failure often means wrong host/port. A 403 can be caller IAM or JWT policy, and missing model output can be secret retrieval or egress. Health success alone does not prove model access.\n\n### 5. Remove only resources you created\n\nRecord ownership before deletion. Delete this runtime, then review its exact ECR image/repository, execution role policy/role, log group and secrets independently. Keep shared resources and retained evidence.\n' + code(`aws bedrock-agentcore-control delete-agent-runtime --agent-runtime-id "$RUNTIME_ID" --region "$AWS_REGION"
# Only for an exclusively owned repository, after reviewing its contents:
# aws ecr delete-repository --repository-name ${spec.name} --region "$AWS_REGION" --force
# aws iam delete-role-policy --role-name ${roleName} --policy-name InstriloRuntime
# aws iam delete-role --role-name ${roleName}`) + '\nUse the Secrets Manager recovery window for secret deletion. Instrilo’s local test cleanup does not execute these cloud deletions.\n';
}

function cloudRunGuide(spec: ProjectSpec, names: string[]): string {
  const accountName = spec.name.slice(0, 24).replace(/-+$/, '') + '-agent';
  return '## Cloud Run: step by step\n\n### 1. Prepare the project and registry\n\nInstall gcloud from its official installer. The deploying operator needs permission to enable services/create resources or must use resources an administrator already prepared. Run from generated/:\n' + code(`gcloud auth login
export GCP_PROJECT=REPLACE_PROJECT_ID
export GCP_REGION=REPLACE_REGION
export GCP_SERVICE_ACCOUNT=${accountName}@\"$GCP_PROJECT\".iam.gserviceaccount.com
gcloud config set project "$GCP_PROJECT"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com --project "$GCP_PROJECT"
gcloud artifacts repositories create agents --repository-format docker --location "$GCP_REGION" --project "$GCP_PROJECT"
gcloud iam service-accounts create ${accountName} --project "$GCP_PROJECT"
docker buildx inspect --bootstrap
jq --version`) + '\nIf resources already exist, inspect and reuse them rather than recreating. The builder must support linux/amd64 even on Apple Silicon. Grant the deployer repository write and service-account actAs permissions, plus Cloud Run deployment rights. The runtime identity is distinct from the caller identity.\n\n### 2. Configure secret and caller permissions\n' + (names.length ? `\nCreate Secret Manager entries for ${names.join(', ')} using a private secret-entry workflow. Replace deploy/gcp-secrets.json values with SECRET_NAME:VERSION (pin a numeric version for repeatability). Grant only the runtime identity access to each selected secret:\n` + code(`gcloud secrets add-iam-policy-binding REPLACE_SECRET_NAME --project "$GCP_PROJECT" \\
  --member "serviceAccount:$GCP_SERVICE_ACCOUNT" --role roles/secretmanager.secretAccessor`) : '\nThis configuration has no outgoing secret references.\n') + '\nApplication JWT configuration must match your real issuer, audience and JWKS. Obtain an application token with the required scopes/tenant through that issuer. It is separate from the Google IAM ID token.\n\n### 3. Build and deploy\n' + code(`bash deploy/cloud-run.sh
SERVICE_URL=$(gcloud run services describe ${spec.name} --region "$GCP_REGION" --project "$GCP_PROJECT" --format='value(status.url)')
gcloud run services describe ${spec.name} --region "$GCP_REGION" --project "$GCP_PROJECT"
export CALLER_SERVICE_ACCOUNT=REPLACE_CALLER_EMAIL
gcloud run services add-iam-policy-binding ${spec.name} --region "$GCP_REGION" --project "$GCP_PROJECT" \\
  --member "serviceAccount:$CALLER_SERVICE_ACCOUNT" --role roles/run.invoker`) + '\nThe generated service stays private to Cloud Run IAM. It limits concurrency to one per instance and sets a finite request timeout from the agent budget. Review scaling/cost settings for your workload; extending the cloud timeout does not extend the agent’s own deadline.\n\n### 4. Invoke and diagnose\n\nYour operator needs permission to impersonate the caller (for example a scoped Service Account Token Creator grant). Use a Google ID token whose audience is SERVICE_URL and an application JWT in the separate header:\n' + code(`GOOGLE_ID_TOKEN=$(gcloud auth print-identity-token --impersonate-service-account "$CALLER_SERVICE_ACCOUNT" --audiences "$SERVICE_URL")
curl --fail-with-body "$SERVICE_URL/invocations" \\
  -H "X-Serverless-Authorization: Bearer $GOOGLE_ID_TOKEN" \\
  -H "Authorization: Bearer $APP_TOKEN" -H 'Content-Type: application/json' \\
  --data '{"input":"Reply with a brief greeting."}'
gcloud run services logs read ${spec.name} --region "$GCP_REGION" --project "$GCP_PROJECT" --limit 50`) + '\nCloud 403 before application execution means check invoker rights/Google audience. Application 401 means check the application JWT. Startup/port failures mean check 0.0.0.0, PORT and architecture; failed secret mounts mean check the runtime identity and secret version.\n\n### 5. Remove owned resources\n' + code(`gcloud run services delete ${spec.name} --region "$GCP_REGION" --project "$GCP_PROJECT"
# Delete only this deployment's exact image digest after reviewing it:
# gcloud artifacts docker images delete REPLACE_IMAGE_AT_SHA256_DIGEST --project "$GCP_PROJECT"`) + '\nRemove dedicated service accounts, secret versions and IAM bindings only when unused. The agents repository can hold other applications and must not be deleted as generic cleanup.\n';
}

function azureGuide(spec: ProjectSpec, names: string[]): string {
  return '## Azure Container Apps: step by step\n\n### 1. Prepare the account, environment and registry\n\nInstall Azure CLI from its official installer. Run from generated/. Choose a globally unique alphanumeric registry name and your approved region/subscription:\n' + code(`az login
az account set --subscription REPLACE_SUBSCRIPTION_ID
az extension add --name containerapp --upgrade
az provider register --namespace Microsoft.App --wait
az provider register --namespace Microsoft.OperationalInsights --wait
export AZURE_RESOURCE_GROUP=REPLACE_RESOURCE_GROUP
export AZURE_REGION=REPLACE_REGION
export AZURE_REGISTRY=REPLACE_UNIQUE_REGISTRY
export AZURE_ENVIRONMENT=${spec.name}-env
az group create --name "$AZURE_RESOURCE_GROUP" --location "$AZURE_REGION"
az acr create --resource-group "$AZURE_RESOURCE_GROUP" --name "$AZURE_REGISTRY" --sku Basic
az containerapp env create --resource-group "$AZURE_RESOURCE_GROUP" --name "$AZURE_ENVIRONMENT" --location "$AZURE_REGION"
az identity create --resource-group "$AZURE_RESOURCE_GROUP" --name ${spec.name}-runtime
export AZURE_IDENTITY_ID=$(az identity show --resource-group "$AZURE_RESOURCE_GROUP" --name ${spec.name}-runtime --query id -o tsv)
IDENTITY_PRINCIPAL=$(az identity show --resource-group "$AZURE_RESOURCE_GROUP" --name ${spec.name}-runtime --query principalId -o tsv)
REGISTRY_ID=$(az acr show --resource-group "$AZURE_RESOURCE_GROUP" --name "$AZURE_REGISTRY" --query id -o tsv)
export AZURE_ENVIRONMENT_ID=$(az containerapp env show --resource-group "$AZURE_RESOURCE_GROUP" --name "$AZURE_ENVIRONMENT" --query id -o tsv)`) + '\nInspect existing resources before reusing them. The operator needs resource deployment rights, managed-identity assignment rights and permission to create role assignments (or administrator help with those assignments). Docker buildx must support linux/amd64.\n\n### 2. Authorize image pulls and secret access\n' + code(`az role assignment create --assignee-object-id "$IDENTITY_PRINCIPAL" --assignee-principal-type ServicePrincipal --scope "$REGISTRY_ID" --role AcrPull
az acr config authentication-as-arm show --registry "$AZURE_REGISTRY"
# If disabled and approved by your registry administrator:
# az acr config authentication-as-arm update --registry "$AZURE_REGISTRY" --status enabled`) + `\n${names.length ? 'Store raw values for ' + names.join(', ') + ' in Key Vault. Set each keyVaultUrl in deploy/azure-container-app.json to its HTTPS secret URL. For an RBAC vault, grant the runtime identity Key Vault Secrets User on the intended vault/secret scope; for access-policy vaults, configure equivalent get permissions.' : 'No Key Vault references are required by this configuration.'} Use a pre-created user-assigned identity so permissions exist before the first private image is pulled. Let RBAC propagate and confirm vault/registry network rules allow this environment. Registries using repository-scoped ABAC need their corresponding repository-read role rather than legacy AcrPull. The operator pushing images also needs the appropriate push role.\n\n### 3. Render and deploy\n\nThe canonical editable file is deploy/azure-container-app.json. The adjacent YAML is a review copy; deploy/azure.sh renders a fresh .deployment/azure-container-app.yaml using the canonical JSON plus environment variables. JSON is a valid YAML subset accepted by --yaml. The script resolves environmentId, identity references, image and location; it refuses remaining REPLACE placeholders.\n` + code(`bash deploy/azure.sh
az containerapp show --name ${spec.name} --resource-group "$AZURE_RESOURCE_GROUP" --query '{state:properties.provisioningState,revision:properties.latestReadyRevisionName}'
APP_FQDN=$(az containerapp show --name ${spec.name} --resource-group "$AZURE_RESOURCE_GROUP" --query properties.configuration.ingress.fqdn -o tsv)`) + '\nThe generated ingress is HTTPS externally, forwarding to port 8080, with JWT enforcement in the application. Configure IP restrictions or internal ingress before exposing sensitive services. Readiness/liveness use /ping; a healthy probe does not certify model/secret access.\n\n### 4. Invoke and diagnose\n' + code(`curl --fail-with-body "https://$APP_FQDN/invocations" \\
  -H "Authorization: Bearer $APP_TOKEN" -H 'Content-Type: application/json' \\
  --data '{"input":"Reply with a brief greeting."}'
az containerapp logs show --name ${spec.name} --resource-group "$AZURE_RESOURCE_GROUP" --type system --tail 50
az containerapp logs show --name ${spec.name} --resource-group "$AZURE_RESOURCE_GROUP" --type console --tail 50`) + '\nUse a token from the configured application issuer. Image pull failures mean check architecture, registry hostname, identity assignment, ARM audience setting and RBAC propagation. Secret-reference failure means check vault access/network restrictions. Application 401 means check issuer, audience, JWKS, expiry, scopes and tenant.\n\n### 5. Remove owned resources\n' + code(`az containerapp delete --name ${spec.name} --resource-group "$AZURE_RESOURCE_GROUP"
# Only if created exclusively for this app and now unused:
# az containerapp env delete --name "$AZURE_ENVIRONMENT" --resource-group "$AZURE_RESOURCE_GROUP"
# az identity delete --name ${spec.name}-runtime --resource-group "$AZURE_RESOURCE_GROUP"`) + '\nReview and delete exact owned image tags/digests, role assignments and secrets separately. Do not delete a resource group or registry that contains another application.\n';
}
