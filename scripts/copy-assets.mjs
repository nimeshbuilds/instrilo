import { cp, mkdir } from 'node:fs/promises';
await mkdir('dist/web', { recursive: true });
await cp('src/web', 'dist/web', { recursive: true });
await cp('src/templates', 'dist/templates', { recursive: true });
