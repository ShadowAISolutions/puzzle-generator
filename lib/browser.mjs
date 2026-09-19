// Launches a headless Chromium for the gate's render check.
//
// Two environments have to work: CI, where `npx playwright install chromium`
// puts the exact revision playwright expects where it expects it, and the
// build sandbox, which ships a pre-installed Chromium whose revision may not
// match the pinned playwright. So: try the normal launch, and on failure fall
// back to whatever chrome binary is actually on disk.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const CANDIDATE_ROOTS = [
  process.env.PLAYWRIGHT_BROWSERS_PATH,
  '/opt/pw-browsers',
].filter(Boolean);

export function findChromiumBinary() {
  if (process.env.PUZZLE_CHROMIUM_PATH) return process.env.PUZZLE_CHROMIUM_PATH;
  for (const root of CANDIDATE_ROOTS) {
    let entries;
    try { entries = fs.readdirSync(root); } catch { continue; }
    const dirs = entries
      .filter((e) => /^chromium(_headless_shell)?-\d+$/.test(e))
      .sort((a, b) => Number(b.match(/\d+$/)[0]) - Number(a.match(/\d+$/)[0]));
    for (const d of dirs) {
      for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) {
        const p = path.join(root, d, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return null;
}

export async function launchBrowser() {
  try {
    return await chromium.launch({ args: ['--disable-gpu'] });
  } catch (err) {
    const bin = findChromiumBinary();
    if (!bin) throw err;
    return await chromium.launch({ executablePath: bin, args: ['--disable-gpu'] });
  }
}
