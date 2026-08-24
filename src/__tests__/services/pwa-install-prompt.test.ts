import { describe, expect, it } from "vitest";
import { anGoiYcaiDatPwa } from "@/components/shared/pwa-install-prompt";

describe("anGoiYcaiDatPwa", () => {
  it.each(["/pos", "/pos/fnb", "/pos/fnb/ban-hang"]) (
    "không hiển thị banner cài ứng dụng trên bề mặt thu ngân: %s",
    (pathname) => {
      expect(anGoiYcaiDatPwa(pathname)).toBe(true);
    },
  );

  it("vẫn cho phép gợi ý cài ứng dụng trên màn quản trị", () => {
    expect(anGoiYcaiDatPwa("/hang-hoa/tuy-chon-fnb")).toBe(false);
  });
});
