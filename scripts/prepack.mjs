import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { repository, run } from './release-utils.mjs';

// A clean build prevents a renamed or deleted runtime module entering a release.
await rm(join(repository, 'dist'), { recursive: true, force: true });
await run('npm', ['run', 'build'], { cwd: repository });
