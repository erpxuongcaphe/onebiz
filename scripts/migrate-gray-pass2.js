/* Pass 2: text-gray-800/900 → text-foreground (main body text)
   Skip KDS dark theme + cai-dat/giao-dien theme preview tiles */
const fs = require('fs');
const path = require('path');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
      walk(full, out);
    } else if (/\.(tsx|ts)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const allFiles = walk(path.join(__dirname, '..', 'src'));

// Intentional dark-theme files — skip
const skipList = [
  path.join('pos', 'fnb', 'kds', 'page.tsx'),
  path.join('cai-dat', 'giao-dien', 'page.tsx'),
];

const replacements = [
  [/\btext-gray-800\b/g, 'text-foreground'],
  [/\btext-gray-900\b/g, 'text-foreground'],
];

let totalFiles = 0;
let totalReplacements = 0;
let skipped = 0;

for (const full of allFiles) {
  const shouldSkip = skipList.some(s => full.endsWith(s));
  if (shouldSkip) {
    skipped++;
    continue;
  }
  let content = fs.readFileSync(full, 'utf8');
  const original = content;
  let fileChanges = 0;
  for (const [pattern, replacement] of replacements) {
    const matches = content.match(pattern);
    if (matches) {
      fileChanges += matches.length;
      content = content.replace(pattern, replacement);
    }
  }
  if (fileChanges > 0 && content !== original) {
    fs.writeFileSync(full, content, 'utf8');
    const rel = path.relative(path.join(__dirname, '..'), full);
    console.log('OK', rel, '-', fileChanges);
    totalFiles++;
    totalReplacements += fileChanges;
  }
}

console.log('\nTotal:', totalFiles, 'files,', totalReplacements, 'replacements. Skipped dark theme:', skipped);
