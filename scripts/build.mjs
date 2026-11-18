import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

mkdirSync(resolve(rootDir, 'dist'), { recursive: true });

const sharedOptions = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  logLevel: 'info',
};

await build({
  ...sharedOptions,
  entryPoints: [resolve(rootDir, 'src/index.ts')],
  outfile: resolve(rootDir, 'dist/index.js'),
});

await build({
  ...sharedOptions,
  entryPoints: [resolve(rootDir, 'src/app/server.ts')],
  outfile: resolve(rootDir, 'dist/server.js'),
});
