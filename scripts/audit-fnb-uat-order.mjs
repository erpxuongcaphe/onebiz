// Read-only post-payment audit for one FnB UAT order/invoice.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const envRoots = [process.cwd(), path.resolve(process.cwd(), "..", "..")];
for (const filename of [".env.local", ".env"]) {
  const file = envRoots
    .map((root) => path.join(root, filename))
    .find((candidate) => fs.existsSync(candidate));
  if (!file) continue;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith("#")) continue;
    const separator = value.indexOf("=");
    if (separator < 0) continue;
    const key = value.slice(0, separator).trim();
    let content = value.slice(separator + 1).trim();
    if (/^["'].*["']$/.test(content)) content = content.slice(1, -1);
    if (!process.env[key]) process.env[key] = content;
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Missing Supabase audit credentials.");

const invoiceCode = process.argv[2];
const orderNumber = process.argv[3];
if (!invoiceCode || !orderNumber) {
  throw new Error("Usage: node scripts/audit-fnb-uat-order.mjs <invoice-code> <order-number>");
}

const db = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function one(table, columns, build) {
  const { data, error } = await build(db.from(table).select(columns)).maybeSingle();
  if (error) throw new Error(`${table}: ${error.message}`);
  if (!data) throw new Error(`${table}: record not found`);
  return data;
}

async function many(table, columns, build) {
  const { data, error } = await build(db.from(table).select(columns));
  if (error) throw new Error(`${table}: ${error.message}`);
  return data ?? [];
}

const invoice = await one(
  "invoices",
  "id,tenant_id,branch_id,code,status,total,paid,debt,payment_method,source,shift_id,created_at",
  (q) => q.eq("code", invoiceCode),
);
const order = await one(
  "kitchen_orders",
  "id,tenant_id,branch_id,invoice_id,order_number,order_type,status,created_at,updated_at",
  (q) => q.eq("order_number", orderNumber),
);
const branch = await one("branches", "id,code,name", (q) => q.eq("id", invoice.branch_id));
const invoiceItems = await many(
  "invoice_items",
  "id,product_id,product_name,variant_id,unit,quantity,unit_price,total,unit_cost,note",
  (q) => q.eq("invoice_id", invoice.id).order("id"),
);
const kitchenItems = await many(
  "kitchen_order_items",
  "id,product_id,product_name,variant_id,variant_label,quantity,unit_price,note,modifier_selections,status,cancelled_qty",
  (q) => q.eq("kitchen_order_id", order.id).order("id"),
);
const movements = await many(
  "stock_movements",
  "id,tenant_id,branch_id,product_id,type,quantity,reference_type,reference_id,note,created_at",
  (q) => q.eq("reference_id", invoice.id).order("created_at").order("id"),
);
const cashTransactions = await many(
  "cash_transactions",
  "id,tenant_id,branch_id,type,category,amount,payment_method,reference_type,reference_id,status,shift_id,created_at",
  (q) => q.eq("reference_id", invoice.id).order("created_at").order("id"),
);
const auditEntries = await many(
  "audit_log",
  "id,tenant_id,user_id,action,entity_type,entity_id,old_data,new_data,created_at",
  (q) => q
    .eq("tenant_id", invoice.tenant_id)
    .in("action", ["void_paid_invoice", "cancel"])
    .gte("created_at", invoice.created_at)
    .order("created_at")
    .order("id"),
);
const materialIds = [...new Set(movements.map((row) => row.product_id))];
const materials = materialIds.length
  ? await many("products", "id,code,name,unit,channel,product_type", (q) => q.in("id", materialIds))
  : [];
const materialById = new Map(materials.map((row) => [row.id, row]));
const movementBranchIds = [...new Set(movements.map((row) => row.branch_id))];
const movementBranches = movementBranchIds.length
  ? await many("branches", "id,code,name", (q) => q.in("id", movementBranchIds))
  : [];
const branchStock = materialIds.length
  ? await many(
      "branch_stock",
      "product_id,branch_id,variant_id,quantity,reserved",
      (q) => q.eq("branch_id", invoice.branch_id).in("product_id", materialIds).is("variant_id", null),
    )
  : [];
const productLots = materialIds.length
  ? await many(
      "product_lots",
      "id,product_id,branch_id,current_qty,status",
      (q) => q
        .eq("branch_id", invoice.branch_id)
        .in("product_id", materialIds)
        .in("status", ["active", "expired"]),
    )
  : [];

const saleMovements = movements.filter(
  (row) => row.type === "out" && row.reference_type !== "invoice_void",
);
const voidMovements = movements.filter(
  (row) => row.type === "in" && row.reference_type === "invoice_void",
);
const quantityByProduct = (rows) => {
  const totals = new Map();
  for (const row of rows) {
    totals.set(row.product_id, (totals.get(row.product_id) ?? 0) + Number(row.quantity));
  }
  return totals;
};
const saleQuantityByProduct = quantityByProduct(saleMovements);
const voidQuantityByProduct = quantityByProduct(voidMovements);
const stockRestoredExactly = saleQuantityByProduct.size > 0
  && saleQuantityByProduct.size === voidQuantityByProduct.size
  && [...saleQuantityByProduct].every(
    ([productId, quantity]) => Math.abs(quantity - (voidQuantityByProduct.get(productId) ?? Number.NaN)) < 1e-9,
  );
const lotQuantityByProduct = quantityByProduct(productLots.map((row) => ({
  product_id: row.product_id,
  quantity: row.current_qty,
})));
const branchStockByProduct = quantityByProduct(branchStock);
const lotLedgerMatchesBranchStock = materialIds.length > 0
  && materialIds.every((productId) => {
    const stockQuantity = branchStockByProduct.get(productId) ?? 0;
    const lotQuantity = lotQuantityByProduct.get(productId) ?? 0;
    if (stockQuantity < -0.0001) return lotQuantity === 0;
    return Math.abs(stockQuantity - lotQuantity) <= 0.0001;
  });
const receipts = cashTransactions.filter(
  (row) => row.type === "receipt" && row.status === "completed",
);
const refunds = cashTransactions.filter(
  (row) => row.type === "payment"
    && row.status === "completed"
    && row.category === "Hoàn trả"
    && ["invoice", "invoice_void"].includes(row.reference_type),
);
const cancelAudit = auditEntries.find(
  (row) => row.entity_type === "invoice"
    && ["void_paid_invoice", "cancel"].includes(row.action)
    && (row.entity_id === invoice.id
      || row.new_data?.invoice_code === invoice.code
      || row.old_data?.code === invoice.code),
);
const commonChecks = {
  invoice_is_fnb: invoice.source === "fnb",
  order_links_invoice: order.invoice_id === invoice.id,
  same_tenant_and_branch: order.tenant_id === invoice.tenant_id && order.branch_id === invoice.branch_id,
  all_movements_in_invoice_branch: movements.length > 0 && movements.every((row) => row.branch_id === invoice.branch_id),
  all_movements_in_invoice_tenant: movements.length > 0 && movements.every((row) => row.tenant_id === invoice.tenant_id),
  no_retail_sale_movement: movements.every((row) => !["invoice", "sale", "pos_sale"].includes(row.reference_type)),
};
const completedChecks = {
  ...commonChecks,
  invoice_completed_and_paid: invoice.status === "completed" && Number(invoice.paid) === Number(invoice.total) && Number(invoice.debt) === 0,
  order_not_cancelled: order.status !== "cancelled",
  all_movements_are_sale_outputs: saleMovements.length > 0 && movements.length === saleMovements.length,
  cash_receipt_matches_invoice: receipts.length === 1
    && cashTransactions.length === 1
    && receipts[0].tenant_id === invoice.tenant_id
    && receipts[0].branch_id === invoice.branch_id
    && receipts[0].payment_method === invoice.payment_method
    && Number(receipts[0].amount) === Number(invoice.paid),
};
const cancelledChecks = {
  ...commonChecks,
  invoice_cancelled: invoice.status === "cancelled",
  kitchen_order_cancelled: order.status === "cancelled",
  stock_restored_exactly_by_material: stockRestoredExactly,
  lot_ledger_matches_branch_stock: lotLedgerMatchesBranchStock,
  cash_receipt_and_refund_are_paired: receipts.length === 1
    && refunds.length === 1
    && receipts[0].tenant_id === invoice.tenant_id
    && refunds[0].tenant_id === invoice.tenant_id
    && receipts[0].branch_id === invoice.branch_id
    && refunds[0].branch_id === invoice.branch_id
    && receipts[0].shift_id === invoice.shift_id
    && refunds[0].shift_id === invoice.shift_id
    && Number(receipts[0].amount) === Number(refunds[0].amount)
    && Number(refunds[0].amount) === Number(invoice.paid),
  cancellation_audit_has_reason: Boolean(
    cancelAudit
    && cancelAudit.tenant_id === invoice.tenant_id
    && (cancelAudit.new_data?.status === "cancelled" || cancelAudit.action === "void_paid_invoice")
    && typeof cancelAudit.new_data?.reason === "string"
    && cancelAudit.new_data.reason.trim().length >= 3,
  ),
};
const mode = invoice.status === "cancelled" ? "cancelled" : "completed";
const checks = mode === "cancelled" ? cancelledChecks : completedChecks;

console.log(JSON.stringify({
  invoice: {
    code: invoice.code,
    status: invoice.status,
    total: Number(invoice.total),
    paid: Number(invoice.paid),
    debt: Number(invoice.debt),
    payment_method: invoice.payment_method,
    source: invoice.source,
    branch: `${branch.code} - ${branch.name}`,
  },
  audit_mode: mode,
  order: {
    order_number: order.order_number,
    status: order.status,
    order_type: order.order_type,
    branch_matches_invoice: order.branch_id === invoice.branch_id,
  },
  invoice_items: invoiceItems.map((row) => ({
    product_name: row.product_name,
    quantity: Number(row.quantity),
    unit_price: Number(row.unit_price),
    total: Number(row.total),
    unit_cost: row.unit_cost == null ? null : Number(row.unit_cost),
    variant_id: row.variant_id,
    note: row.note,
  })),
  kitchen_items: kitchenItems.map((row) => ({
    product_name: row.product_name,
    variant_label: row.variant_label,
    quantity: Number(row.quantity),
    cancelled_qty: Number(row.cancelled_qty),
    status: row.status,
    note: row.note,
    modifier_selections: row.modifier_selections,
  })),
  stock_movements: movements.map((row) => {
    const material = materialById.get(row.product_id);
    return {
      material: material ? `${material.code} - ${material.name}` : row.product_id,
      material_unit: material?.unit ?? null,
      type: row.type,
      quantity: Number(row.quantity),
      reference_type: row.reference_type,
      branch_matches_invoice: row.branch_id === invoice.branch_id,
      note: row.note,
    };
  }),
  branch_stock_after: branchStock.map((row) => {
    const material = materialById.get(row.product_id);
    return {
      material: material ? `${material.code} - ${material.name}` : row.product_id,
      quantity: Number(row.quantity),
      reserved: Number(row.reserved),
      branch_matches_invoice: row.branch_id === invoice.branch_id,
    };
  }),
  active_lot_totals_after: materialIds.map((productId) => {
    const material = materialById.get(productId);
    return {
      material: material ? `${material.code} - ${material.name}` : productId,
      lot_quantity: lotQuantityByProduct.get(productId) ?? 0,
      branch_stock_quantity: branchStockByProduct.get(productId) ?? 0,
      matches: Math.abs(
        (lotQuantityByProduct.get(productId) ?? 0) - (branchStockByProduct.get(productId) ?? 0),
      ) <= 0.0001,
    };
  }),
  cash_transactions: cashTransactions.map((row) => ({
    type: row.type,
    category: row.category,
    amount: Number(row.amount),
    payment_method: row.payment_method,
    status: row.status,
    reference_type: row.reference_type,
    branch_matches_invoice: row.branch_id === invoice.branch_id,
    shift_matches_invoice: row.shift_id === invoice.shift_id,
  })),
  cancellation_audit: cancelAudit ? {
    action: cancelAudit.action,
    reason: cancelAudit.new_data?.reason ?? null,
    refund_method: cancelAudit.new_data?.refund_method ?? null,
    atomic_marker: cancelAudit.new_data?.atomic === true,
    tenant_matches_invoice: cancelAudit.tenant_id === invoice.tenant_id,
    created_at: cancelAudit.created_at,
  } : null,
  movement_branches: movementBranches.map((row) => `${row.code} - ${row.name}`),
  checks,
  passed: Object.values(checks).every(Boolean),
}, null, 2));
