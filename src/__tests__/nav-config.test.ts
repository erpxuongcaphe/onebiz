/**
 * Tests cho isHrefActive — "longest match wins" pattern.
 *
 * Bug từng có: pathname=/hang-hoa/nhom với href=/hang-hoa → cả 2 cùng
 * active vì pathname.startsWith("/hang-hoa/"). User confused thấy 2
 * sidebar item bôi blue cùng lúc.
 */

import { describe, it, expect } from "vitest";
import { isHrefActive, isGroupActive, sidebarNavGroups } from "@/components/shared/nav-config";

describe("isHrefActive — longest match wins", () => {
  it("exact match always active", () => {
    expect(isHrefActive("/hang-hoa", "/hang-hoa")).toBe(true);
    expect(isHrefActive("/hang-hoa/nhom", "/hang-hoa/nhom")).toBe(true);
  });

  it("home / matches only exact /", () => {
    expect(isHrefActive("/", "/")).toBe(true);
    expect(isHrefActive("/hang-hoa", "/")).toBe(false);
    expect(isHrefActive("/anywhere/else", "/")).toBe(false);
  });

  it("BUG FIX: /hang-hoa is NOT active when on /hang-hoa/nhom (longer match exists)", () => {
    // /hang-hoa/nhom có item riêng (Nhóm hàng) → đó mới là active item.
    // /hang-hoa (Danh sách hàng) chỉ active khi pathname đúng = /hang-hoa.
    expect(isHrefActive("/hang-hoa/nhom", "/hang-hoa")).toBe(false);
    expect(isHrefActive("/hang-hoa/ton-kho", "/hang-hoa")).toBe(false);
    expect(isHrefActive("/hang-hoa/kiem-kho", "/hang-hoa")).toBe(false);
  });

  it("/hang-hoa exact: only Danh sách hàng active", () => {
    expect(isHrefActive("/hang-hoa", "/hang-hoa")).toBe(true);
    expect(isHrefActive("/hang-hoa", "/hang-hoa/nhom")).toBe(false);
    expect(isHrefActive("/hang-hoa", "/hang-hoa/ton-kho")).toBe(false);
  });

  it("nested subroute: longest match wins", () => {
    // /hang-hoa/san-xuat có nav item, /san-xuat dashboard cũng có.
    // Khi pathname=/hang-hoa/san-xuat → /hang-hoa NOT active, only san-xuat.
    expect(isHrefActive("/hang-hoa/san-xuat", "/hang-hoa")).toBe(false);
    expect(isHrefActive("/hang-hoa/san-xuat", "/hang-hoa/san-xuat")).toBe(true);
  });

  it("non-prefix paths return false", () => {
    expect(isHrefActive("/khach-hang", "/hang-hoa")).toBe(false);
    expect(isHrefActive("/hang-hoa-xyz", "/hang-hoa")).toBe(false); // not /hang-hoa/...
  });

  it("isGroupActive: nhóm Hàng hóa active khi user ở /hang-hoa/nhom", () => {
    const hangHoaGroup = sidebarNavGroups.find((g) => g.label === "Hàng hóa");
    expect(hangHoaGroup).toBeDefined();
    if (!hangHoaGroup) return;
    expect(isGroupActive("/hang-hoa/nhom", hangHoaGroup)).toBe(true);
    expect(isGroupActive("/hang-hoa/ton-kho", hangHoaGroup)).toBe(true);
    expect(isGroupActive("/khach-hang", hangHoaGroup)).toBe(false);
  });
});
