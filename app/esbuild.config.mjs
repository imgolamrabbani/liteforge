import * as esbuild from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';

const isWatch = process.argv.includes('--watch');

async function copyWasm() {
  const srcWasm = path.resolve('node_modules/sql.js/dist/sql-wasm.wasm');
  const dstDir = path.resolve('dist');
  const dstWasm = path.join(dstDir, 'sql-wasm.wasm');
  await fs.mkdir(dstDir, { recursive: true });
  await fs.copyFile(srcWasm, dstWasm);
}

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: false,
  minify: true,
  logLevel: 'info',
};

if (isWatch) {
  await copyWasm();
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('Watching LiteForge extension host...');
} else {
  await esbuild.build(buildOptions);
  await copyWasm();
}
