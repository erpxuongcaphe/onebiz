#!/usr/bin/env node

import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(SCRIPT_DIR, "..");
const SRC_DIR = join(ROOT_DIR, "src");
const OUTPUT_DIR = join(ROOT_DIR, "docs", "qc");
const WRITE_REPORT = process.argv.includes("--write");

const KNOWN_ACTION_TAGS = new Set([
  "button",
  "Button",
  "DropdownMenuItem",
  "ContextMenuItem",
  "MenubarItem",
  "CommandItem",
  "AlertDialogAction",
  "DialogTrigger",
  "SheetTrigger",
  "form",
]);

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    if (entry === "__tests__") continue;
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

function toPosix(path) {
  return path.split(sep).join("/");
}

function getAttribute(node, name) {
  return (node.attributes?.properties ?? []).find(
    (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText() === name,
  );
}

function attributeValue(attribute) {
  if (!attribute?.initializer) return attribute ? "true" : "";
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text.trim();
  if (ts.isJsxExpression(attribute.initializer)) {
    return attribute.initializer.expression?.getText().trim() ?? "";
  }
  return attribute.initializer.getText().trim();
}

function labelOf(node) {
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  const aria = attributeValue(getAttribute(opening, "aria-label"));
  if (aria) return aria;
  const title = attributeValue(getAttribute(opening, "title"));
  if (title) return title;
  if (!ts.isJsxElement(node)) return "";

  const parts = [];
  function collect(child) {
    if (ts.isJsxText(child)) {
      const text = child.getText().replace(/\s+/g, " ").trim();
      if (text) parts.push(text);
    } else if (ts.isJsxExpression(child) && child.expression) {
      if (
        ts.isStringLiteral(child.expression) ||
        ts.isNoSubstitutionTemplateLiteral(child.expression)
      ) {
        parts.push(child.expression.text.trim());
      }
    } else if (ts.isJsxElement(child)) {
      child.children.forEach(collect);
    }
  }
  node.children.forEach(collect);
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 120);
}

function surfaceFor(file) {
  if (file.includes("/mockup/")) return "mockup";
  if (file.startsWith("src/app/mkt/") || file.startsWith("src/components/mkt/")) return "mkt";
  if (file.startsWith("src/app/pos/") || file.startsWith("src/components/pos/")) return "pos";
  if (file.startsWith("src/app/")) return "page";
  if (file.startsWith("src/components/")) return "component";
  return "other";
}

function scanFile(path) {
  const file = toPosix(relative(ROOT_DIR, path));
  const content = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(
    path,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const actions = [];

  function visit(node) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = opening.tagName.getText();
      const onClick = attributeValue(getAttribute(opening, "onClick"));
      const onSubmit = attributeValue(getAttribute(opening, "onSubmit"));
      const onSelect = attributeValue(getAttribute(opening, "onSelect"));
      const type = attributeValue(getAttribute(opening, "type"));
      const handler = onClick || onSubmit || onSelect || (type === "submit" ? "form-submit" : "");
      const isAction = KNOWN_ACTION_TAGS.has(tag) || Boolean(handler);

      if (isAction) {
        const disabled = attributeValue(getAttribute(opening, "disabled"));
        actions.push({
          file,
          surface: surfaceFor(file),
          line: sourceFile.getLineAndCharacterOfPosition(opening.getStart(sourceFile)).line + 1,
          tag,
          label: labelOf(node),
          handler,
          disabled,
          needsManualCheck:
            !handler &&
            !["DialogTrigger", "SheetTrigger", "AlertDialogAction"].includes(tag),
          suspiciousHandler:
            /=>\s*\{\s*\}/.test(handler) ||
            handler === "undefined" ||
            /console\.(log|warn|error)/.test(handler),
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return actions;
}

function makeReport() {
  const actions = walk(SRC_DIR)
    .filter((path) => extname(path) === ".tsx")
    .flatMap(scanFile)
    .filter((action) => action.surface !== "mockup")
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const manual = actions.filter((action) => action.needsManualCheck);
  const suspicious = actions.filter((action) => action.suspiciousHandler);
  const unlabeled = actions.filter((action) => !action.label);
  const withoutDisabled = actions.filter(
    (action) =>
      action.handler &&
      !action.disabled &&
      !["DialogTrigger", "SheetTrigger"].includes(action.tag),
  );

  return {
    summary: {
      actions: actions.length,
      needsManualCheck: manual.length,
      suspiciousHandlers: suspicious.length,
      unlabeledActions: unlabeled.length,
      actionsWithoutDisabledGuard: withoutDisabled.length,
    },
    actions,
    manual,
    suspicious,
    unlabeled,
    withoutDisabled,
  };
}

function markdown(report) {
  return [
    "# Ma trận nút và hành động OneBiz",
    "",
    "> Kiểm kê tĩnh JSX. Kết quả cần được đối chiếu bằng UAT vì handler có thể nằm trong component cha hoặc thư viện UI.",
    "",
    "## Tổng quan",
    "",
    `- Nút/hành động phát hiện được: ${report.summary.actions}`,
    `- Cần kiểm tra handler thủ công: ${report.summary.needsManualCheck}`,
    `- Handler đáng ngờ: ${report.summary.suspiciousHandlers}`,
    `- Hành động chưa có nhãn đọc được: ${report.summary.unlabeledActions}`,
    `- Hành động chưa thấy khóa bằng disabled: ${report.summary.actionsWithoutDisabledGuard}`,
    "",
    "## Handler đáng ngờ",
    "",
    "| Nhóm | Thành phần | Nhãn | Handler | File:dòng |",
    "|---|---|---|---|---|",
    ...report.suspicious.map(
      (item) =>
        `| ${item.surface} | ${item.tag} | ${item.label || "(không nhãn)"} | \`${item.handler}\` | \`${item.file}:${item.line}\` |`,
    ),
    "",
    "## Cần kiểm tra handler thủ công",
    "",
    "| Nhóm | Thành phần | Nhãn | File:dòng |",
    "|---|---|---|---|",
    ...report.manual.map(
      (item) =>
        `| ${item.surface} | ${item.tag} | ${item.label || "(không nhãn)"} | \`${item.file}:${item.line}\` |`,
    ),
    "",
    "## Hành động chưa đọc được nhãn",
    "",
    "| Nhóm | Thành phần | Handler | File:dòng |",
    "|---|---|---|---|",
    ...report.unlabeled.map(
      (item) =>
        `| ${item.surface} | ${item.tag} | \`${item.handler || "(trigger)"}\` | \`${item.file}:${item.line}\` |`,
    ),
    "",
    "## Lưu ý nghiệm thu",
    "",
    "- Không có `disabled` chưa chắc là lỗi; phải kiểm tra handler có chống bấm lặp và trạng thái đang xử lý hay không.",
    "- Nút biểu tượng phải có `aria-label` hoặc tooltip rõ nghĩa.",
    "- Mọi nút ghi dữ liệu phải có phản hồi thành công, lỗi và cập nhật dữ liệu sau thao tác.",
    "",
  ].join("\n");
}

const report = makeReport();
if (WRITE_REPORT) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(
    join(OUTPUT_DIR, "BUTTON-ACTION-INVENTORY.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(join(OUTPUT_DIR, "BUTTON-ACTION-MATRIX.md"), markdown(report), "utf8");
}
console.log(JSON.stringify(report.summary, null, 2));
