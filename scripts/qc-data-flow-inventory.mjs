#!/usr/bin/env node

import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(SCRIPT_DIR, "..");
const SRC_DIR = join(ROOT_DIR, "src");
const OUTPUT_DIR = join(ROOT_DIR, "docs", "qc");
const WRITE_REPORT = process.argv.includes("--write");

const WRITE_OPERATIONS = new Set(["insert", "update", "upsert", "delete"]);
const HIGH_RISK_TABLES = new Set([
  "invoices",
  "invoice_items",
  "sales_returns",
  "return_items",
  "purchase_orders",
  "purchase_order_items",
  "stock_movements",
  "branch_stock",
  "cash_transactions",
  "audit_log",
  "profiles",
  "tenants",
  "branches",
  "stock_transfers",
  "stock_transfer_items",
  "inventory_checks",
  "inventory_check_items",
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

function lineAt(content, index) {
  return content.slice(0, index).split("\n").length;
}

function executionSurface(file) {
  if (file.startsWith("src/app/api/")) return "server-route";
  if (file.startsWith("src/app/") && file.includes("/mockup/")) return "mockup";
  if (file.startsWith("src/app/")) return "page";
  if (file.startsWith("src/components/")) return "component";
  if (file.startsWith("src/lib/services/")) return "service";
  if (file.startsWith("src/lib/")) return "library";
  return "other";
}

function scanFile(path) {
  const content = readFileSync(path, "utf8");
  const file = toPosix(relative(ROOT_DIR, path));
  const calls = [];
  const tablePattern =
    /\.from\(\s*["']([^"']+)["']\s*\)([\s\S]{0,420}?)\.(select|insert|update|upsert|delete)\s*(?:<[^>]+>)?\s*\(/g;
  const rpcPattern = /\.rpc\(\s*["']([^"']+)["']/g;
  const fetchPattern = /\bfetch\(\s*([`"'])(\/api\/[^`"']+)\1/g;

  for (const match of content.matchAll(tablePattern)) {
    calls.push({
      file,
      line: lineAt(content, match.index ?? 0),
      surface: executionSurface(file),
      kind: "table",
      target: match[1],
      operation: match[3],
      write: WRITE_OPERATIONS.has(match[3]),
      highRisk: HIGH_RISK_TABLES.has(match[1]),
    });
  }
  for (const match of content.matchAll(rpcPattern)) {
    calls.push({
      file,
      line: lineAt(content, match.index ?? 0),
      surface: executionSurface(file),
      kind: "rpc",
      target: match[1],
      operation: "execute",
      write: true,
      highRisk: /checkout|stock|invoice|payment|cash|return|purchase|transfer|void/i.test(
        match[1],
      ),
    });
  }
  for (const match of content.matchAll(fetchPattern)) {
    calls.push({
      file,
      line: lineAt(content, match.index ?? 0),
      surface: executionSurface(file),
      kind: "api",
      target: match[2],
      operation: "fetch",
      write: false,
      highRisk: false,
    });
  }

  return {
    file,
    surface: executionSurface(file),
    calls: calls.sort((a, b) => a.line - b.line),
    hasUseClient: /^\s*["']use client["'];/m.test(content),
    hasTry: /\btry\s*\{/.test(content),
    hasCatch: /\bcatch\s*(?:\(|\{)/.test(content),
    hasFinally: /\bfinally\s*\{/.test(content),
  };
}

function makeReport() {
  const files = walk(SRC_DIR)
    .filter((path) => [".ts", ".tsx"].includes(extname(path)))
    .map(scanFile)
    .filter((entry) => entry.surface !== "mockup")
    .sort((a, b) => a.file.localeCompare(b.file));
  const calls = files.flatMap((entry) => entry.calls);
  const writes = calls.filter((call) => call.write && call.kind !== "api");
  const clientWrites = writes.filter((call) =>
    ["page", "component", "service"].includes(call.surface),
  );
  const highRiskWrites = writes.filter((call) => call.highRisk);
  const filesWithCallsWithoutCatch = files
    .filter((entry) => entry.calls.length > 0 && !entry.hasCatch)
    .map((entry) => ({
      file: entry.file,
      surface: entry.surface,
      calls: entry.calls.length,
    }));

  return {
    summary: {
      sourceFiles: files.length,
      dataCalls: calls.length,
      tableCalls: calls.filter((call) => call.kind === "table").length,
      rpcCalls: calls.filter((call) => call.kind === "rpc").length,
      apiFetches: calls.filter((call) => call.kind === "api").length,
      writes: writes.length,
      clientOrServiceWrites: clientWrites.length,
      highRiskWrites: highRiskWrites.length,
      filesWithCallsWithoutCatch: filesWithCallsWithoutCatch.length,
    },
    calls,
    writes,
    clientWrites,
    highRiskWrites,
    filesWithCallsWithoutCatch,
  };
}

function markdown(report) {
  return [
    "# Bản đồ điểm truy cập dữ liệu OneBiz",
    "",
    "> Kiểm kê tĩnh toàn bộ mã nguồn `src`. Chưa xác nhận policy hoặc dữ liệu sống trên Supabase.",
    "",
    "## Tổng quan",
    "",
    `- File mã nguồn đã quét: ${report.summary.sourceFiles}`,
    `- Điểm truy cập dữ liệu: ${report.summary.dataCalls}`,
    `- Truy vấn bảng: ${report.summary.tableCalls}`,
    `- Gọi RPC: ${report.summary.rpcCalls}`,
    `- Gọi API từ frontend: ${report.summary.apiFetches}`,
    `- Điểm có khả năng ghi dữ liệu: ${report.summary.writes}`,
    `- Điểm ghi từ page/component/service: ${report.summary.clientOrServiceWrites}`,
    `- Điểm ghi vào dữ liệu nhạy cảm: ${report.summary.highRiskWrites}`,
    "",
    "## Ghi dữ liệu nhạy cảm",
    "",
    "| Nơi chạy | Loại | Đích | Lệnh | File:dòng |",
    "|---|---|---|---|---|",
    ...report.highRiskWrites.map(
      (item) =>
        `| ${item.surface} | ${item.kind} | \`${item.target}\` | ${item.operation} | \`${item.file}:${item.line}\` |`,
    ),
    "",
    "## Ghi trực tiếp từ page, component hoặc service",
    "",
    "| Nơi chạy | Loại | Đích | Lệnh | File:dòng |",
    "|---|---|---|---|---|",
    ...report.clientWrites.map(
      (item) =>
        `| ${item.surface} | ${item.kind} | \`${item.target}\` | ${item.operation} | \`${item.file}:${item.line}\` |`,
    ),
    "",
    "## File có truy cập dữ liệu nhưng chưa thấy catch",
    "",
    "| Nơi chạy | Số điểm gọi | File |",
    "|---|---:|---|",
    ...report.filesWithCallsWithoutCatch.map(
      (item) => `| ${item.surface} | ${item.calls} | \`${item.file}\` |`,
    ),
    "",
    "## Cách sử dụng kết quả",
    "",
    "- Mỗi điểm ghi nhạy cảm phải được đối chiếu quyền, tenant, chi nhánh và trạng thái chứng từ.",
    "- RPC phải được kiểm tra owner, `SECURITY DEFINER`, `search_path`, quyền EXECUTE và audit log.",
    "- Danh sách `chưa thấy catch` là tín hiệu rà soát, không mặc nhiên là lỗi.",
    "",
  ].join("\n");
}

const report = makeReport();
if (WRITE_REPORT) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(
    join(OUTPUT_DIR, "DATA-FLOW-INVENTORY.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(join(OUTPUT_DIR, "DATA-FLOW-MAP.md"), markdown(report), "utf8");
}
console.log(JSON.stringify(report.summary, null, 2));
