import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useRevalidateOnFocus } from "@/lib/hooks/use-revalidate-on-focus";

const backgroundRefreshPages = [
  "src/app/(main)/so-quy/page.tsx",
  "src/app/(main)/khach-hang/page.tsx",
  "src/app/(main)/hang-hoa/page.tsx",
  "src/app/(main)/hang-hoa/ton-kho/page.tsx",
  "src/app/(main)/hang-hoa/nhom/page.tsx",
  "src/app/(main)/hang-hoa/nha-cung-cap/page.tsx",
  "src/app/(main)/hang-hoa/lich-su-kho/page.tsx",
  "src/app/(main)/don-hang/dat-hang/page.tsx",
];

describe("focus revalidation keeps page context", () => {
  it("marks focus-triggered refreshes as background work", () => {
    const callback = vi.fn();
    renderHook(() => useRevalidateOnFocus(callback));

    act(() => window.dispatchEvent(new Event("focus")));

    expect(callback).toHaveBeenCalledWith({ background: true });
  });

  it.each(backgroundRefreshPages)(
    "%s keeps populated content visible during focus refresh",
    (file) => {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");

      expect(source).toMatch(
        /const fetchData = useCallback\(\s*async \(\{ background = false \}/,
      );
      expect(source).toContain("if (!background) setLoading(true);");
    },
  );

  it("passes the background context through the sales-order KPI refresh", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/(main)/don-hang/dat-hang/page.tsx"),
      "utf8",
    );

    expect(source).toContain("await fetchData(context);");
  });
});
