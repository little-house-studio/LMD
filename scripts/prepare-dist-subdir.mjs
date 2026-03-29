import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const distDir = path.join(root, 'dist');
const nestedDir = path.join(distDir, 'LTHS_MD');

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function rewriteNestedIndex(html) {
  return html
    .replace(/(["'])\.\/assets\//g, '$1../assets/')
    .replace(/(["'])\.\/safe\.html/g, '$1safe.html');
}

async function main() {
  await ensureDir(nestedDir);

  const [indexHtml, safeHtml] = await Promise.all([
    fs.readFile(path.join(distDir, 'index.html'), 'utf8'),
    fs.readFile(path.join(root, 'safe.html'), 'utf8'),
  ]);

  await Promise.all([
    fs.writeFile(path.join(nestedDir, 'index.html'), rewriteNestedIndex(indexHtml), 'utf8'),
    fs.writeFile(path.join(nestedDir, 'safe.html'), safeHtml, 'utf8'),
  ]);
}

main().catch((error) => {
  console.error('[prepare-dist-subdir] failed:', error);
  process.exitCode = 1;
});
