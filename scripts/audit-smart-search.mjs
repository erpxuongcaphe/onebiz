import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// Source inventory, not an assertion of runtime coverage. Search SQL/RPC independently.
const rows = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { if (entry.name !== '__tests__') walk(file); continue; }
    if (!/\.tsx?$/.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = node => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(source);
        const attributes = node.attributes.getText(source);
        let kind;
        if (tag === 'SearchableSelect') kind = 'shared-smart-picker';
        else if (tag === 'SelectFilter') kind = 'shared-smart-filter';
        else if (tag === 'select' || tag === 'Select') kind = 'select-review-static-or-entity';
        else if (/^(Input|input|SearchInput|SearchBar)$/.test(tag) && /[Tt]ìm|[Ss]earch|type="search"/.test(attributes)) kind = 'search-review-client-or-server';
        if (kind) rows.push({file:file.replaceAll('\\','/'),line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,tag,kind,attributes:attributes.replace(/\s+/g,' ').slice(0,400)});
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}
walk('src/app'); walk('src/components');
const summary = rows.reduce((counts,row)=>({...counts,[row.kind]:(counts[row.kind]??0)+1}),{});
const report = { generatedAt:new Date().toISOString(), note:'Static inventory only. A shared picker affects its callers; server filtering needs a separate RLS/pagination audit. Fixed statuses/date choices need no fuzzy search.',summary,controls:rows };
if (process.argv[2]) fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2));
console.log(JSON.stringify(summary,null,2));
