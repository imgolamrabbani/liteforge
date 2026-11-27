#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.resolve(__dirname, '..');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const jobs = [
  { html: 'icon.html', out: 'icon.png', width: 256, height: 256, transparent: true },
  { html: 'banner.html', out: 'banner.png', width: 1280, height: 640, transparent: false },
  { html: 'screenshot-1.html', out: 'screenshot-1-grid.png', width: 1280, height: 800, transparent: false },
  { html: 'screenshot-2.html', out: 'screenshot-2-erd-edit.png', width: 1280, height: 800, transparent: false },
  { html: 'screenshot-3.html', out: 'screenshot-3-diff-dump.png', width: 1280, height: 800, transparent: false },
];

for (const job of jobs) {
  const inputUrl = `file://${path.join(__dirname, job.html)}`;
  const outputPath = path.join(assetsDir, job.out);
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${job.width},${job.height}`,
    `--screenshot=${outputPath}`,
  ];
  if (job.transparent) {
    args.push('--default-background-color=00000000');
  }
  args.push(inputUrl);

  execFileSync(chromePath, args, { stdio: 'inherit' });
  console.log(`Rendered ${job.out} (${job.width}x${job.height})`);
}
