/* Batch migrate light gray tokens to Stitch semantic tokens.
   Run: node scripts/migrate-gray.js */
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

// Light-mode mapping only — don't touch dark grays (600+) en masse
const replacements = [
  // Light backgrounds → Stitch surface tokens
  [/\bbg-gray-50\b/g, 'bg-surface-container-low'],
  [/\bbg-gray-100\b/g, 'bg-muted'],
  [/\bbg-gray-200\b/g, 'bg-muted'],
  [/\bhover:bg-gray-50\b/g, 'hover:bg-surface-container-low'],
  [/\bhover:bg-gray-100\b/g, 'hover:bg-muted'],
  [/\bhover:bg-gray-200\b/g, 'hover:bg-muted'],

  // Borders (light)
  [/\bborder-gray-100\b/g, 'border-border'],
  [/\bborder-gray-200\b/g, 'border-border'],
  [/\bborder-gray-300\b/g, 'border-border'],
  [/\bhover:border-gray-200\b/g, 'hover:border-border'],
  [/\bhover:border-gray-300\b/g, 'hover:border-border'],

  // Muted text
  [/\btext-gray-400\b/g, 'text-muted-foreground'],
  [/\btext-gray-500\b/g, 'text-muted-foreground'],
  [/\btext-gray-600\b/g, 'text-foreground'],
  [/\btext-gray-700\b/g, 'text-foreground'],

  // Hover text
  [/\bhover:text-gray-500\b/g, 'hover:text-muted-foreground'],
  [/\bhover:text-gray-600\b/g, 'hover:text-foreground'],
  [/\bhover:text-gray-700\b/g, 'hover:text-foreground'],
  [/\bhover:text-gray-900\b/g, 'hover:text-foreground'],
];

let totalFiles = 0;
let totalReplacements = 0;
let skipped = 0;
const kdsPath = path.join('pos', 'fnb', 'kds', 'page.tsx');

for (const full of allFiles) {
  // Skip KDS dark-theme page — it uses gray-700/800/900 on purpose
  if (full.endsWith(kdsPath)) {
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

console.log('\nTotal:', totalFiles, 'files,', totalReplacements, 'replacements. Skipped KDS dark theme:', skipped);
