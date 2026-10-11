import type { Criterion } from "./contracts";

// Reference only: CEO approval of each standard determines the actual measurement rules.
export const referenceCriteria: ReadonlyArray<{
  group: string;
  criterion: Criterion;
}> = [
  ...[
    "Cây xanh",
    "Sàn",
    "Bàn",
    "Nhiệt độ",
    "Nhà vệ sinh",
    "Mùi",
    "Âm nhạc",
  ].map((title, index) => ({
    group: "Không gian",
    criterion: booleanCriterion(`space-${index + 1}`, title),
  })),
  ...[
    "Đúng công thức, kỹ thuật, trình bày và nhiệt độ",
    "Thiết bị, dụng cụ và ly sạch",
  ].map((title, index) => ({
    group: "Đồ uống",
    criterion: booleanCriterion(`drinks-${index + 1}`, title),
  })),
  {
    group: "Phục vụ",
    criterion: durationCriterion("service-greeting", "Chào khách", 0.5),
  },
  {
    group: "Phục vụ",
    criterion: durationCriterion("service-ice-tea", "Phục vụ trà đá", 1),
  },
  {
    group: "Phục vụ",
    criterion: durationCriterion(
      "service-drinks",
      "Thời gian phục vụ đồ uống — cà phê",
      3,
    ),
  },
  ...[
    "Ghi nhận khách quen",
    "Đồng phục",
    "Thái độ thân thiện",
    "Chủ động hỏi phản hồi",
    "Giới thiệu menu ưu tiên và upsell",
  ].map((title, index) => ({
    group: "Con người",
    criterion: booleanCriterion(`people-${index + 1}`, title),
  })),
  {
    group: "Hàng hóa và lao động",
    criterion: {
      ...booleanCriterion("goods-loss", "Kiểm soát hao hụt"),
      kind: "percent",
      operator: "lt",
      threshold: 0.7,
    },
  },
  {
    group: "Hàng hóa và lao động",
    criterion: booleanCriterion(
      "labor-schedule",
      "Xếp lịch theo dự báo doanh thu và nhu cầu phục vụ",
    ),
  },
];

function booleanCriterion(id: string, title: string): Criterion {
  return {
    id,
    title,
    kind: "boolean",
    operator: "eq",
    threshold: 1,
    samples: 1,
    critical: false,
    evidenceRequired: false,
  };
}
function durationCriterion(
  id: string,
  title: string,
  minutes: number,
): Criterion {
  return {
    ...booleanCriterion(id, title),
    kind: "duration",
    operator: "lte",
    threshold: minutes,
  };
}
