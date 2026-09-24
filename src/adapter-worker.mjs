import { pathToFileURL } from 'node:url';
try {
  let text = '';
  for await (const chunk of process.stdin) { text += chunk; if (Buffer.byteLength(text) > 2_000_000) throw new Error('Adapter input exceeds 2 MB'); }
  // Keep ordinary diagnostics out of the machine response channel.
  console.log = console.info = console.debug = (...args) => console.error(...args);
  const adapter = await import(pathToFileURL(process.argv[2]).href);
  if (typeof adapter.default !== 'function') throw new Error('Adapter must export default async function(request)');
  const result = await adapter.default(JSON.parse(text));
  process.stdout.write(JSON.stringify({ ok: true, result }));
} catch (error) {
  let message = String(error?.message || error);
  const secrets = Object.entries(process.env).filter(([key,value]) => value && !['PATH','NODE_ENV','INSTRILO_ADAPTER_FIXTURE'].includes(key)).map(([,value]) => value).sort((a,b) => b.length-a.length);
  for (const secret of secrets) message = message.split(secret).join('[REDACTED]');
  process.stdout.write(JSON.stringify({ ok: false, error: message.slice(0, 2000) })); process.exitCode = 1;
}
