import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { runAgent } from './agent.js';
import { SPEC } from './runtime.js';
const server = new Server({ name: SPEC.name, version: '0.1.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'invoke_agent', description: 'Run the configured agent. Review its scope and tools before granting access.', inputSchema: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'], additionalProperties: false } }] }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  if (request.params.name !== 'invoke_agent' || typeof request.params.arguments?.input !== 'string') throw new Error('Invalid tool call');
  try { return { content: [{ type: 'text', text: JSON.stringify(await runAgent(request.params.arguments.input)) }] }; }
  catch (error) { return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'Execution failed' }] }; }
});
await server.connect(new StdioServerTransport());
