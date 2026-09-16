import { describe, expect, it } from "vitest";
import type { KitchenOrderItem } from "@/lib/types/fnb";
import {
  DEFAULT_KDS_DISPLAY_PREFERENCES,
  prepareKdsItemGroups,
} from "@/app/pos/fnb/kds/kds-display";

function makeItem(
  id: string,
  overrides: Partial<KitchenOrderItem> = {},
): KitchenOrderItem {
  return {
    id,
    kitchenOrderId: "order-1",
    productId: "product-1",
    productName: "Hồng Trà Việt Quất",
    variantId: "size-m",
    variantLabel: "Size M",
    quantity: 1,
    unitPrice: 30_000,
    note: null,
    toppings: [],
    modifierSelections: [
      {
        groupId: "sugar",
        groupName: "Mức đường",
        rule: "single_required",
        options: [
          {
            optionId: "sugar-80",
            label: "80%",
            scaleFactor: 0.8,
            priceDelta: 0,
            linkedProductId: null,
          },
        ],
      },
    ],
    status: "pending",
    startedAt: null,
    completedAt: null,
    kitchenStationId: "bar",
    ...overrides,
  };
}

describe("KDS display preferences", () => {
  it("mặc định giữ nguyên thứ tự và từng dòng món như trước", () => {
    const items = [makeItem("2", { productName: "Trà đào" }), makeItem("1")];
    const groups = prepareKdsItemGroups(items, DEFAULT_KDS_DISPLAY_PREFERENCES);

    expect(groups.map((group) => group.representative.id)).toEqual(["2", "1"]);
    expect(groups).toHaveLength(2);
    expect(DEFAULT_KDS_DISPLAY_PREFERENCES.combineIdenticalItems).toBe(false);
  });

  it("chỉ gom các dòng giống hệt và cộng đúng số lượng", () => {
    const groups = prepareKdsItemGroups(
      [makeItem("1", { quantity: 2 }), makeItem("2", { quantity: 3 })],
      { combineIdenticalItems: true, itemSort: "entry" },
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((item) => item.id)).toEqual(["1", "2"]);
    expect(groups[0].quantity).toBe(5);
  });

  it.each([
    ["khác size", { variantId: "size-l", variantLabel: "Size L" }],
    ["khác ghi chú", { note: "Không dùng ống hút" }],
    ["khác trạng thái", { status: "preparing" as const }],
    [
      "khác mức đường",
      {
        modifierSelections: [
          {
            groupId: "sugar",
            groupName: "Mức đường",
            rule: "single_required" as const,
            options: [
              {
                optionId: "sugar-100",
                label: "100%",
                scaleFactor: 1,
                priceDelta: 0,
                linkedProductId: null,
              },
            ],
          },
        ],
      },
    ],
  ])("không gom khi %s", (_label, override) => {
    const groups = prepareKdsItemGroups(
      [makeItem("1"), makeItem("2", override)],
      { combineIdenticalItems: true, itemSort: "entry" },
    );

    expect(groups).toHaveLength(2);
  });

  it("sắp tên tiếng Việt ổn định khi quản trị bật A-Z", () => {
    const groups = prepareKdsItemGroups(
      [
        makeItem("1", { productName: "Xưởng Gu Việt" }),
        makeItem("2", { productName: "Hồng Trà Việt Quất" }),
        makeItem("3", { productName: "Hồng Trà Việt Quất", note: "Ít đá" }),
      ],
      { combineIdenticalItems: false, itemSort: "name" },
    );

    expect(groups.map((group) => group.representative.id)).toEqual(["2", "3", "1"]);
  });
});
