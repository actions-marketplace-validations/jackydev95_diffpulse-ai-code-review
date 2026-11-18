import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

mkdirSync(resolve(rootDir, 'dist'), { recursive: true });

await build({
  entryPoints: [resolve(rootDir, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  outfile: resolve(rootDir, 'dist/index.js'),
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  logLevel: 'info',
});
