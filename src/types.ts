/** Public contracts shared by the CLI, app, providers and generators. */
export type Language = 'python' | 'typescript';
export type Framework = 'native' | 'langgraph' | 'openai-agents' | 'crewai';
export type ProviderKind = 'openai' | 'anthropic' | 'xai' | 'gateway' | 'ollama' | 'codex-cli' | 'claude-code' | 'grok-cli' | 'demo';
export type Target = 'local' | 'docker' | 'aws-agentcore' | 'cloud-run' | 'azure-container-apps';
export type Host = 'codex' | 'claude-code' | 'claude-desktop' | 'chatgpt';
export type Role = 'builder' | 'runtime' | 'judge';
export interface Connection {
  kind: ProviderKind;
  model?: string;
  baseUrl?: string;
  auth: {
    type: 'none' | 'api-key' | 'bearer-env' | 'oauth-client-credentials';
    env?: string;
    tokenUrl?: string;
    clientIdEnv?: string;
    clientSecretEnv?: string;
    scope?: string;
    audience?: string;
  };
  timeoutMs?: number;
}
export interface ToolSpec {
  name: string;
  description: string;
  kind: 'http';
  url: string;
  method: 'GET' | 'POST';
  requiresApproval: boolean;
  requiredScopes: string[];
  authEnv?: string;
  inputSchema: Record<string, unknown>;
}
export interface ProjectSpec {
  schemaVersion: '1';
  name: string;
  description: string;
  language: Language;
  framework: Framework;
  guidanceDir: string;
  connections: Record<string, Connection>;
  roles: Record<Role, string>;
  agent: {
    systemPrompt: string;
    tools: ToolSpec[];
    limits: { maxSteps: number; timeoutMs: number; maxOutputTokens: number };
  };
  evaluation: { dataset: string; rubric: string; threshold: number };
  security: {
    inbound: { mode: 'none' | 'jwt'; issuer?: string; audience?: string; jwksUrl?: string; algorithms: string[] };
    requiredScopes: string[];
    tenantClaim?: string;
  };
  delivery: { target: Target; hosts: Host[]; region?: string; port: number };
}
export interface Issue { level: 'error' | 'warning' | 'info'; code: string; message: string; path?: string }
export interface GuidanceFile { path: string; content: string; sha256: string }
export interface GuidanceReport { root: string; files: GuidanceFile[]; combined: string; issues: Issue[]; missing: string[] }
export interface GuidanceAnswers {
  purpose: string; users: string; inputs: string; outputs: string; success: string;
  tools: string; boundaries: string; escalation: string; examples: string; operations: string;
}
export interface GenerateRequest {
  system: string; prompt: string; maxOutputTokens?: number; signal?: AbortSignal;
  cwd?: string; json?: boolean;
}
export interface GenerateResponse {
  text: string; model: string; provider: ProviderKind;
  usage?: { inputTokens: number; outputTokens: number }; durationMs: number;
}
export interface ProviderCapability {
  kind: ProviderKind; label: string; transport: 'api' | 'cli' | 'offline';
  structuredOutput: boolean; toolCalling: boolean; cloudRuntime: boolean; notes: string;
}
export interface Artifact { path: string; content: string; executable?: boolean }
export interface BuildResult { outputDir: string; files: string[]; issues: Issue[]; spec: ProjectSpec }
export interface EvalCase {
  id: string; input: string; expected?: string; contains?: string[]; excludes?: string[];
  requireJson?: boolean; source: 'reviewed' | 'synthetic'; split: 'development' | 'holdout';
}
export interface EvalResult {
  id: string; input: string; output: string; passed: boolean;
  caseHash?: string; trace?: unknown[];
  checks: { name: string; passed: boolean; detail: string }[];
  judge?: { score: number; rationale: string }; error?: string;
  durationMs: number; usage?: GenerateResponse['usage'];
}
export interface EvalReport {
  id: string; createdAt: string; project: string; mode: 'live' | 'demo';
  split: string; total: number; passed: number; passRate: number;
  reviewed: number; synthetic: number; results: EvalResult[];
  configHash: string; datasetHash?: string; judgeHash?: string; guidanceHash?: string; warnings: string[];
}
