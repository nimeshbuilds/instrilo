/** Local coordinator protocol. Inert for ordinary HTTP/MCP/CLI execution. */
import { createInterface } from 'node:readline';
import type { Interface } from 'node:readline';

export const durableEnabled = process.env.INSTRILO_DURABLE_RUN === '1';
let sequence = 0;
let replies: AsyncIterator<string> | undefined;
let channel: Interface | undefined;
export function finishSession() { channel?.close(); }
export class DurablePause extends Error { constructor(public detail: unknown) { super('Run paused for local approval'); } }
async function exchange(message: unknown): Promise<any> {
  channel ??= createInterface({ input: process.stdin, terminal: false });
  replies ??= channel[Symbol.asyncIterator]();
  process.stdout.write('@@INSTRILO_RPC@@' + JSON.stringify(message) + '\n');
  const next = await replies.next();
  if (next.done) throw new Error('Durable coordinator disconnected; refusing live fallback');
  const response = JSON.parse(next.value);
  if (response.action === 'pause') throw new DurablePause(response);
  if (response.action === 'error') throw new Error(response.error || 'Durable coordinator rejected operation');
  return response;
}
export async function durableStep(kind: 'model' | 'tool', request: unknown, operation: () => Promise<any>): Promise<any> {
  if (!durableEnabled) return operation();
  const seq = sequence++;
  const before = await exchange({ phase: 'before', seq, kind, request });
  if (before.action === 'replay') return before.response;
  if (before.action !== 'execute' || typeof before.ticket !== 'string') throw new Error('Invalid coordinator dispatch');
  let response: any;
  try { response = await operation(); } catch (error) {
    if (error instanceof DurablePause) throw error;
    await exchange({ phase: 'failure', seq, ticket: before.ticket, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  await exchange({ phase: 'after', seq, ticket: before.ticket, response });
  return response;
}
