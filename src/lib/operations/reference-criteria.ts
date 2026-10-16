import type { Criterion } from "./contracts";
import workbook from "./ceo-workbook.json";

// Verbatim CEO source. Stable row numbers keep distinct same-name tasks separate.
export const referenceCriteria = workbook.rows.map((row) => ({
  group: row.group, workTitle: row.title, frequency: row.frequency, points: row.points,
  criterion: { id: `ceo-ws-${String(row.number).padStart(3, "0")}`, title: row.requirement,
    kind: "boolean", operator: "eq", threshold: 1, samples: 1,
    critical: false, evidenceRequired: false } satisfies Criterion,
}));
