/** Forward CLI termination to bounded operations and keep the process alive until cleanup finishes. */
export async function withCliCancellation<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  try { return await operation(controller.signal); }
  finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
}
