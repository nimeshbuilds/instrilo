import { readFileSync } from 'node:fs';

// This path is the same from src/ during development and dist/ after installation.
export const version: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
