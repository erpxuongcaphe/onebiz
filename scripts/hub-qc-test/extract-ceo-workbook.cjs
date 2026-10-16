// Mechanical source extraction only. Never connects to an API or database.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const x = require('xlsx');
const source = process.argv[2];
if (!source) throw Error('Provide the CEO source workbook path');
const buffer = fs.readFileSync(source);
const wb = x.read(buffer);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = x.utils.sheet_to_json(sheet, { header: 1, defval: null, range: { s: { r: 0, c: 0 }, e: x.utils.decode_range(sheet['!ref']).e } });
const data = rows.filter(row => Number.isInteger(row[1]) && row[1] >= 1 && row[1] <= 34)
  .map(row => ({ number: row[1], group: row[2], title: row[3], requirement: row[4], scope: row[5], frequency: row[6] === 'Daily' ? 'daily' : 'weekly', points: Number(String(row[7]).trim().replace('−', '-')) }));
if (data.length !== 34 || new Set(data.map(row => row.group)).size !== 6) throw Error('Unexpected CEO source structure');
const notes = rows.find(row => String(row[2] ?? '').startsWith('* Cách tính điểm:'))?.[2];
if (!notes || data.filter(row => row.points > 0).length !== 2) throw Error('Incomplete source');
const result = { fileName: path.basename(source), sha256: crypto.createHash('sha256').update(buffer).digest('hex'), sheet: wb.SheetNames[0], notes, rows: data };
fs.writeFileSync(path.resolve(__dirname, '../../src/lib/operations/ceo-workbook.json'), JSON.stringify(result, null, 2) + '\n');
console.log('Extracted 34 source rows, 6 groups, signed points and policy notes without changing source workbook');
