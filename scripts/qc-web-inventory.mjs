#!/usr/bin/env node

import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(SCRIPT_DIR, "..");
const APP_DIR = join(ROOT_DIR, "src", "app");
const NAV_FILE = join(ROOT_DIR, "src", "components", "shared", "nav-config.ts");
const OUTPUT_DIR = join(ROOT_DIR, "docs", "qc");
const WRITE_REPORT = process.argv.includes("--write");

const ACTION_TAGS = new Set([
  "button",
  "Button",
  "DropdownMenuItem",
  "ContextMenuItem",
  "AlertDialogAction",
  "DialogTrigger",
  "SheetTrigger",
  "form",
]);

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
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

function routeFromFile(path, api = false) {
  const base = api ? join(APP_DIR, "api") : APP_DIR;
  const segments = relative(base, dirname(path))
    .split(sep)
    .filter(Boolean)
    .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")));
  const routeSegments = api ? ["api", ...segments] : segments;
  return `/${routeSegments.join("/")}`.replace(/\/$/, "") || "/";
}

function surfaceFor(route) {
  if (route.startsWith("/mockup")) return "mockup";
  if (route.startsWith("/mkt-ai-audit")) return "mkt-audit-public";
  if (route.startsWith("/mkt")) return "mkt";
  if (route.startsWith("/pos")) return "pos";
  if (route.startsWith("/sop")) return "sop";
  if (route.startsWith("/manager")) return "manager";
  if (
    route.startsWith("/dang-nhap") ||
    route.startsWith("/quen-mat-khau") ||
    route.startsWith("/dat-lai-mat-khau")
  ) {
    return "auth";
  }
  return "erp";
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

function visibleLabel(node) {
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  const aria = attributeValue(getAttribute(opening, "aria-label"));
  if (aria) return aria;
  const title = attributeValue(getAttribute(opening, "title"));
  if (title) return title;
  if (!ts.isJsxElement(node)) return "";

  const parts = [];
  function collect(child) {
    if (ts.isJsxText(child)) {
      const value = child.getText().replace(/\s+/g, " ").trim();
      if (value) parts.push(value);
    } else if (ts.isJsxExpression(child)) {
      if (
        child.expression &&
        (ts.isStringLiteral(child.expression) ||
          ts.isNoSubstitutionTemplateLiteral(child.expression))
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

function scanActions(sourceFile) {
  const actions = [];
  function visit(node) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = opening.tagName.getText();
      const onClick = attributeValue(getAttribute(opening, "onClick"));
      const onSubmit = attributeValue(getAttribute(opening, "onSubmit"));
      const type = attributeValue(getAttribute(opening, "type"));
      if (ACTION_TAGS.has(tag) || onClick || onSubmit || type === "submit") {
        actions.push({
          line: sourceFile.getLineAndCharacterOfPosition(opening.getStart(sourceFile)).line + 1,
          tag,
          label: visibleLabel(node),
          handler: onClick || onSubmit || (type === "submit" ? "form-submit" : ""),
          disabled: attributeValue(getAttribute(opening, "disabled")),
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return actions;
}

function lineAt(content, index) {
  return content.slice(0, index).split("\n").length;
}

function scanDataCalls(content) {
  const calls = [];
  const tablePattern =
    /\.from\(\s*["']([^"']+)["']\s*\)([\s\S]{0,320}?)\.(select|insert|update|upsert|delete)\s*\(/g;
  const rpcPattern = /\.rpc\(\s*["']([^"']+)["']/g;
  const fetchPattern = /\bfetch\(\s*([`"'])(\/api\/[^`"']+)\1/g;

  for (const match of content.matchAll(tablePattern)) {
    calls.push({
      kind: "table",
      target: match[1],
      operation: match[3],
      line: lineAt(content, match.index ?? 0),
    });
  }
  for (const match of content.matchAll(rpcPattern)) {
    calls.push({
      kind: "rpc",
      target: match[1],
      operation: "execute",
      line: lineAt(content, match.index ?? 0),
    });
  }
  for (const match of content.matchAll(fetchPattern)) {
    calls.push({
      kind: "api",
      target: match[2],
      operation: "fetch",
      line: lineAt(content, match.index ?? 0),
    });
  }
  return calls.sort((a, b) => a.line - b.line);
}

function scanFile(path, route) {
  const content = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(
    path,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const dataCalls = scanDataCalls(content);
  return {
    route,
    surface: surfaceFor(route),
    file: toPosix(relative(ROOT_DIR, path)),
    lines: content.split("\n").length,
    clientComponent: /^\s*["']use client["'];/m.test(content),
    actions: scanActions(sourceFile),
    dataCalls,
    directWrites: dataCalls.filter(
      (call) => call.kind === "table" && call.operation !== "select",
    ),
    hasCatch: /\bcatch\s*(?:\(|\{)/.test(content),
    hasFinally: /\bfinally\s*\{/.test(content),
  };
}

function parseNavRoutes() {
  const content = readFileSync(NAV_FILE, "utf8");
  return [...content.matchAll(/\bhref:\s*["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((href) => href.startsWith("/"))
    .filter((href, index, all) => all.indexOf(href) === index)
    .sort();
}

function makeReport() {
  const appFiles = walk(APP_DIR);
  const pageFiles = appFiles.filter((path) => path.endsWith(`${sep}page.tsx`));
  const apiFiles = appFiles.filter(
    (path) => path.includes(`${sep}api${sep}`) && path.endsWith(`${sep}route.ts`),
  );
  const pages = pageFiles
    .map((path) => scanFile(path, routeFromFile(path)))
    .sort((a, b) => a.route.localeCompare(b.route));
  const apiRoutes = apiFiles
    .map((path) => scanFile(path, routeFromFile(path, true)))
    .sort((a, b) => a.route.localeCompare(b.route));
  const navRoutes = parseNavRoutes();
  const productionPages = pages.filter((page) => page.surface !== "mockup");
  const pageRoutes = new Set(pages.map((page) => page.route));
  const navWithoutPage = navRoutes.filter((route) => !pageRoutes.has(route));
  const directWrites = [...productionPages, ...apiRoutes].flatMap((entry) =>
    entry.directWrites.map((write) => ({ route: entry.route, file: entry.file, ...write })),
  );
  const actionsWithoutHandler = productionPages.flatMap((page) =>
    page.actions
      .filter(
        (action) =>
          !action.handler &&
          action.tag !== "DialogTrigger" &&
          action.tag !== "SheetTrigger" &&
          action.tag !== "AlertDialogAction",
      )
      .map((action) => ({ route: page.route, file: page.file, ...action })),
  );

  return {
    summary: {
      pages: pages.length,
      productionPages: productionPages.length,
      mockupPages: pages.length - productionPages.length,
      apiRoutes: apiRoutes.length,
      navRoutes: navRoutes.length,
      actions: productionPages.reduce((sum, page) => sum + page.actions.length, 0),
      directWrites: directWrites.length,
      actionsWithoutHandler: actionsWithoutHandler.length,
      navWithoutPage: navWithoutPage.length,
    },
    navRoutes,
    navWithoutPage,
    pages,
    apiRoutes,
    directWrites,
    actionsWithoutHandler,
  };
}

function markdown(report) {
  return [
    "# Ma trận kiểm kê web OneBiz",
    "",
    "> Báo cáo tĩnh sinh từ mã nguồn. Chưa phải kết quả UAT trên trình duyệt hoặc xác nhận dữ liệu production.",
    "",
    "## Tổng quan",
    "",
    `- Tổng trang: ${report.summary.pages}`,
    `- Trang production: ${report.summary.productionPages}`,
    `- Trang mockup: ${report.summary.mockupPages}`,
    `- API routes: ${report.summary.apiRoutes}`,
    `- Đường dẫn trong menu: ${report.summary.navRoutes}`,
    `- Thành phần thao tác phát hiện được: ${report.summary.actions}`,
    `- Lệnh ghi Supabase trực tiếp phát hiện được: ${report.summary.directWrites}`,
    `- Thành phần cần kiểm tra handler thủ công: ${report.summary.actionsWithoutHandler}`,
    "",
    "## Lệnh ghi trực tiếp cần rà soát",
    "",
    "| Route | Bảng | Lệnh | File:dòng |",
    "|---|---|---|---|",
    ...report.directWrites.map(
      (item) =>
        `| ${item.route} | \`${item.target}\` | ${item.operation} | \`${item.file}:${item.line}\` |`,
    ),
    "",
    "## Route menu chưa khớp trực tiếp với page",
    "",
    ...(report.navWithoutPage.length
      ? report.navWithoutPage.map((route) => `- \`${route}\``)
      : ["- Không có."]),
    "",
    "## Phạm vi trang production",
    "",
    "| Route | Nhóm | Nút/thao tác | Data calls | Ghi trực tiếp | Bắt lỗi |",
    "|---|---:|---:|---:|---:|---:|",
    ...report.pages
      .filter((page) => page.surface !== "mockup")
      .map(
        (page) =>
          `| ${page.route} | ${page.surface} | ${page.actions.length} | ${page.dataCalls.length} | ${page.directWrites.length} | ${page.hasCatch ? "Có" : "Chưa thấy"} |`,
      ),
    "",
    "## Giới hạn",
    "",
    "- Công cụ chỉ kiểm kê mã nguồn; handler truyền qua component và thao tác server-side cần rà thủ công.",
    "- Một lệnh ghi trực tiếp không mặc nhiên là lỗi; phải đối chiếu quyền, trạng thái và tính nguyên tử.",
    "- Kết quả cuối cùng phải được xác nhận bằng test API/RPC và UAT trên Chrome.",
    "",
  ].join("\n");
}

const report = makeReport();
if (WRITE_REPORT) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(
    join(OUTPUT_DIR, "WEB-QC-INVENTORY.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(join(OUTPUT_DIR, "WEB-QC-MATRIX.md"), markdown(report), "utf8");
}
console.log(JSON.stringify(report.summary, null, 2));
