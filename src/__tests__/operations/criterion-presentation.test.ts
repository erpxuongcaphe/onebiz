import { describe, expect, it } from "vitest";
import { compareCriteriaBySource, criterionGroup, criterionSourceNumber, criterionTitle } from "@/lib/operations/criterion-presentation";

describe("criterion labels shared by Working Standard and QC", () => {
  it("keeps source numbers without treating arbitrary codes as Excel numbers", () => {
    expect(criterionSourceNumber("WS-00000000000000000000000000000000-0019")).toBe(19);
    expect(criterionSourceNumber("WS-0020")).toBe(20);
    expect(criterionSourceNumber("CUSTOM-0019")).toBeNull();
    expect(criterionTitle({ code: "CUSTOM-0019", title: "Kiểm tra riêng" })).toBe("Kiểm tra riêng");
  });
  it("orders the two distinct raw-material criteria by source number, not title", () => {
    const items = [{ code: "WS-0020", title: "Nguyên liệu" }, { code: "WS-0019", title: "Nguyên liệu" }];
    expect([...items].sort(compareCriteriaBySource).map(criterionTitle)).toEqual(["19. Nguyên liệu", "20. Nguyên liệu"]);
    expect(items[0].code).toBe("WS-0020");
  });
  it("puts custom criteria after the source workbook without hiding them", () => {
    expect([{ title: "Mục riêng" }, { code: "WS-0034", title: "Xuất sử dụng hàng hóa" }].sort(compareCriteriaBySource).map(criterionTitle))
      .toEqual(["34. Xuất sử dụng hàng hóa", "Mục riêng"]);
  });
  it("uses the historical group label before a renamed current group", () => {
    expect(criterionGroup({ category: "group:one", group_title: "Nhóm ở thời điểm áp dụng" }, [{ id: "one", title: "Tên mới" }]))
      .toBe("Nhóm ở thời điểm áp dụng");
    expect(criterionGroup({ category: "group:one" }, [{ id: "one", title: "Không gian và trải nghiệm" }])).toBe("Không gian và trải nghiệm");
    expect(criterionGroup({ category: "group:missing" }, [])).toBe("Chưa phân nhóm");
  });
});
