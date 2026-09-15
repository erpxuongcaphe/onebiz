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

const checks = {
  invoice_is_fnb: invoice.source === "fnb",
  invoice_completed_and_paid: invoice.status === "completed" && Number(invoice.paid) === Number(invoice.total) && Number(invoice.debt) === 0,
  order_links_invoice: order.invoice_id === invoice.id,
  same_tenant_and_branch: order.tenant_id === invoice.tenant_id && order.branch_id === invoice.branch_id,
  all_movements_in_invoice_branch: movements.length > 0 && movements.every((row) => row.branch_id === invoice.branch_id),
  all_movements_are_out: movements.length > 0 && movements.every((row) => row.type === "out" && Number(row.quantity) >= 0),
  no_retail_sale_movement: movements.every((row) => !["invoice", "sale", "pos_sale"].includes(row.reference_type)),
  cash_receipt_matches_invoice: cashTransactions.length === 1
    && cashTransactions[0].tenant_id === invoice.tenant_id
    && cashTransactions[0].branch_id === invoice.branch_id
    && cashTransactions[0].type === "receipt"
    && cashTransactions[0].status === "completed"
    && cashTransactions[0].payment_method === invoice.payment_method
    && Number(cashTransactions[0].amount) === Number(invoice.paid),
};

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
  cash_transactions: cashTransactions.map((row) => ({
    type: row.type,
    category: row.category,
    amount: Number(row.amount),
    payment_method: row.payment_method,
    status: row.status,
    branch_matches_invoice: row.branch_id === invoice.branch_id,
    shift_matches_invoice: row.shift_id === invoice.shift_id,
  })),
  movement_branches: movementBranches.map((row) => `${row.code} - ${row.name}`),
  checks,
  passed: Object.values(checks).every(Boolean),
}, null, 2));
