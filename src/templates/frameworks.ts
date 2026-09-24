import type { Framework, Language } from '../types.js';

export function frameworkCode(framework: Framework, language: Language): string {
  if (framework === 'native') return language === 'python' ? 'return await run_native(text, ctx)' : 'return runNative(input, ctx);';
  if (language === 'python' && framework === 'langgraph') return `from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from runtime import SYSTEM, model_step, apply_tools
class State(TypedDict):
    messages: list
    steps: int
async def model_node(state):
    if state["steps"] >= SPEC["agent"]["limits"]["maxSteps"]: raise RuntimeError("Agent step budget exhausted")
    msg = await model_step(state["messages"], ctx)
    ctx["trace"].append({"event": "langgraph.model", "step": state["steps"] + 1})
    return {"messages": state["messages"] + [msg], "steps": state["steps"] + 1}
async def tool_node(state):
    return {"messages": state["messages"] + await apply_tools(state["messages"][-1], ctx)}
builder = StateGraph(State)
builder.add_node("model", model_node)
builder.add_node("tools", tool_node)
builder.add_edge(START, "model")
builder.add_conditional_edges("model", lambda s: "tools" if s["messages"][-1].get("tool_calls") else END)
builder.add_edge("tools", "model")
graph = builder.compile()
result = await graph.ainvoke({"messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": text}], "steps": 0}, {"recursion_limit": SPEC["agent"]["limits"]["maxSteps"] * 2 + 2})
return result["messages"][-1].get("content") or ""`;
  if (language === 'typescript' && framework === 'langgraph') return `const { StateGraph, Annotation, START, END } = await import('@langchain/langgraph');
const { SYSTEM, modelStep, applyTools } = await import('./runtime.js');
const State = Annotation.Root({ messages: Annotation<any[]>(), steps: Annotation<number>() });
const graph = new StateGraph(State)
  .addNode('model', async state => {
    if (state.steps >= SPEC.agent.limits.maxSteps) throw new Error('Agent step budget exhausted');
    const message = await modelStep(state.messages, ctx);
    ctx.trace.push({ event: 'langgraph.model', step: state.steps + 1 });
    return { messages: [...state.messages, message], steps: state.steps + 1 };
  })
  .addNode('tools', async state => ({ messages: [...state.messages, ...await applyTools(state.messages.at(-1), ctx)] }))
  .addEdge(START, 'model')
  .addConditionalEdges('model', state => state.messages.at(-1)?.tool_calls?.length ? 'tools' : END)
  .addEdge('tools', 'model').compile();
const result = await graph.invoke({ messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: input }], steps: 0 }, { recursionLimit: SPEC.agent.limits.maxSteps * 2 + 2, signal: ctx.signal });
return String(result.messages.at(-1)?.content ?? '');`;
  if (language === 'python' && framework === 'openai-agents') return `from agents import Agent, Runner, FunctionTool, ModelSettings, OpenAIChatCompletionsModel, RunConfig
from openai import AsyncOpenAI
from runtime import SYSTEM, CONNECTION, base_url, token, execute_tool
key = await token(ctx)
client = AsyncOpenAI(api_key=key or "unused", base_url=base_url(), timeout=remaining(ctx), max_retries=0)
tools = []
for definition in SPEC["agent"]["tools"]:
    async def invoke_tool(_sdk_ctx, raw, definition=definition):
        return json.dumps(await execute_tool(definition["name"], json.loads(raw), ctx))
    tools.append(FunctionTool(name=definition["name"], description=definition["description"], params_json_schema=definition["inputSchema"], on_invoke_tool=invoke_tool, strict_json_schema=False))
agent = Agent(name=SPEC["name"], instructions=SYSTEM, model=OpenAIChatCompletionsModel(model=CONNECTION["model"], openai_client=client), model_settings=ModelSettings(max_tokens=SPEC["agent"]["limits"]["maxOutputTokens"], parallel_tool_calls=False), tools=tools)
result = await Runner.run(agent, text, max_turns=SPEC["agent"]["limits"]["maxSteps"], run_config=RunConfig(tracing_disabled=True))
ctx["trace"].append({"event": "openai-agents.completed", "items": len(result.new_items)})
ctx["usage_known"] = True
usage = result.context_wrapper.usage
ctx["usage"]["inputTokens"] += usage.input_tokens
ctx["usage"]["outputTokens"] += usage.output_tokens
await client.close()
return str(result.final_output)`;
  if (language === 'typescript' && framework === 'openai-agents') return `const { Agent, Runner, OpenAIProvider, tool } = await import('@openai/agents');
const { SYSTEM, CONNECTION, baseUrl, token, executeTool } = await import('./runtime.js');
const provider = new OpenAIProvider({ apiKey: (await token(ctx)) || 'unused', baseURL: baseUrl(), useResponses: false });
const agent = new Agent({ name: SPEC.name, instructions: SYSTEM, model: CONNECTION.model,
  modelSettings: { maxTokens: SPEC.agent.limits.maxOutputTokens, parallelToolCalls: false },
  tools: SPEC.agent.tools.map((t: any) => tool({ name: t.name, description: t.description, parameters: t.inputSchema, strict: false, execute: async (args: unknown) => JSON.stringify(await executeTool(t.name, args, ctx)) })) });
const runner = new Runner({ modelProvider: provider, tracingDisabled: true });
const result = await runner.run(agent, input, { maxTurns: SPEC.agent.limits.maxSteps, signal: ctx.signal });
ctx.trace.push({ event: 'openai-agents.completed', items: result.newItems.length });
ctx.usageKnown = true;
ctx.usage.inputTokens += result.state.usage.inputTokens;
ctx.usage.outputTokens += result.state.usage.outputTokens;
return String(result.finalOutput ?? '');`;
  if (language === 'python' && framework === 'crewai') return `from crewai import Agent, Task, Crew, LLM, Process
from crewai.tools import BaseTool
from pydantic import BaseModel, Field, PrivateAttr
from runtime import SYSTEM, CONNECTION, base_url, token, execute_tool
class HttpInput(BaseModel):
    arguments: dict = Field(description="Tool arguments matching the JSON Schema in the description")
class HttpTool(BaseTool):
    name: str
    description: str
    args_schema: type[BaseModel] = HttpInput
    _definition: dict = PrivateAttr()
    def _run(self, arguments: dict):
        return json.dumps(asyncio.run(execute_tool(self._definition["name"], arguments, ctx)))
tools = []
for definition in SPEC["agent"]["tools"]:
    tool = HttpTool(name=definition["name"], description=definition["description"] + " Input JSON Schema: " + json.dumps(definition["inputSchema"]))
    tool._definition = definition
    tools.append(tool)
llm = LLM(model="openai/" + CONNECTION["model"], api_key=(await token(ctx)), base_url=base_url(), max_tokens=SPEC["agent"]["limits"]["maxOutputTokens"], timeout=remaining(ctx))
agent = Agent(role=SPEC["name"], goal=SPEC["description"], backstory=SYSTEM, llm=llm, tools=tools, allow_delegation=False, max_iter=SPEC["agent"]["limits"]["maxSteps"], max_execution_time=max(1, int(remaining(ctx))), verbose=False, cache=False)
task = Task(description="Handle this user input using the configured instructions and approved tools:\\n" + text, expected_output="A useful, accurate response respecting the provided instructions and tool restrictions.", agent=agent)
crew = Crew(agents=[agent], tasks=[task], process=Process.sequential, verbose=False, tracing=False)
result = await asyncio.to_thread(crew.kickoff)
ctx["trace"].append({"event": "crewai.completed"})
if result.token_usage:
    ctx["usage_known"] = True
    ctx["usage"]["inputTokens"] += result.token_usage.prompt_tokens
    ctx["usage"]["outputTokens"] += result.token_usage.completion_tokens
return result.raw`;
  throw new Error(`Unsupported framework/language: ${framework}/${language}`);
}
