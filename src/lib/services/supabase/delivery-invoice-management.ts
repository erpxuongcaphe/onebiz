import { z } from "zod";
import { getClient, handleError } from "./base";
const money = z.number().finite().nullable();
const timestamp = z.string().datetime({ offset: true });
const rowSchema = z.object({
  id: z.string().uuid(), orderNumber: z.string(), branchId: z.string().uuid(), branchName: z.string(),
  staffId: z.string().uuid().nullable(), staffName: z.string(), createdAt: timestamp,
  assignedAt: timestamp.nullable(), completedAt: timestamp.nullable(), orderStatus: z.string(),
  invoiceId: z.string().uuid().nullable(), invoiceCode: z.string().nullable(), invoiceStatus: z.string().nullable(),
  customerName: z.string().nullable(), paymentMethod: z.string().nullable(),
  invoiceTotal: money, invoicePaid: money, invoiceDebt: money, deliveryFee: money,
  deliveryTier: z.string().nullable(), durationSeconds: z.number().finite().nonnegative().nullable(),
  deliveryStatus: z.enum(["cancelled", "completed", "assigned", "unassigned"]),
});
export type DeliveryInvoiceRow = z.infer<typeof rowSchema>;
const schema = z.object({ items: z.array(rowSchema), total: z.number().int().nonnegative(), canViewMoney: z.boolean(), dateBasis: z.literal("createdAt"), paymentBasis: z.literal("invoice") });
export type DeliveryInvoiceReport = z.infer<typeof schema>;
export async function getDeliveryInvoiceManagement(branchId: string | undefined, range: { from: string; to: string }): Promise<DeliveryInvoiceReport> {
  const { data, error } = await getClient().rpc("get_delivery_invoice_management_v1" as never, { p_branch_id: branchId ?? null, p_from: range.from, p_to: range.to } as never);
  if (error) handleError(error, "getDeliveryInvoiceManagement");
  const report = schema.parse(data);
  if (report.total !== report.items.length || new Set(report.items.map(row => row.id)).size !== report.total ||
    (branchId && report.items.some(row => row.branchId !== branchId)) ||
    (!report.canViewMoney && report.items.some(row => row.invoiceTotal !== null || row.invoicePaid !== null || row.invoiceDebt !== null || row.deliveryFee !== null || row.paymentMethod !== null))) {
    throw new Error("Nguồn giao hàng chưa khớp phạm vi hoặc quyền. Vui lòng tải lại.");
  }
  return report;
}
