import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it.each([
  ["khach-hang", "khách hàng", true],
  ["hang-hoa/nha-cung-cap", "nhà cung cấp", true],
  ["hang-hoa/ton-kho", "tồn kho", false],
  ["hang-hoa/kiem-kho", "kiểm kho", true],
  ["hang-hoa/nhap-hang", "nhập hàng", true],
])("names the mobile filter controls on %s", (path, label, date) => {
  const source = readFileSync(`src/app/(main)/${path}/page.tsx`, "utf8");
  expect(source).toContain(`aria-label="Mở bộ lọc ${label}"`);
  if (date) expect(source).toContain('aria-label={`Lọc theo thời gian: ${datePresetLabel}`}');
});
