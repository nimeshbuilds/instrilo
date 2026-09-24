import { pathToFileURL } from 'node:url';
import { SPEC, context, runNative, type Context } from './runtime.js';

async function frameworkRun(input: string, ctx: Context): Promise<string> {
  // FRAMEWORK_IMPLEMENTATION
}
export async function runAgent(input: string, ctx = context()) {
  if (typeof input !== 'string' || !input.trim() || input.length > 100000) throw new Error('input must be a non-empty string of at most 100000 characters');
  const output = await frameworkRun(input, ctx);
  return { output, trace: ctx.trace, ...(ctx.usageKnown ? { usage: ctx.usage } : {}) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const index = process.argv.indexOf('--input');
  if (index < 0 || !process.argv[index + 1]) { console.error('Usage: npx tsx agent.ts --input TEXT'); process.exitCode = 1; }
  else try { console.log(JSON.stringify(await runAgent(process.argv[index + 1]))); }
  catch (error) { console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); process.exitCode = 1; }
}
