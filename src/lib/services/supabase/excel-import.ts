/**
 * Bulk Excel Import Services
 *
 * Nhận validRows từ ImportExcelDialog → insert batch vào DB.
 * Mỗi function trả về ImportBatchResult với per-row error tracking.
 *
 * Nguyên tắc:
 *  - Insert từng row trong try/catch để lỗi 1 row không block các row khác.
 *  - rowIndex trong result = vị trí 1-indexed trong validRows (KHÔNG phải
 *    Excel row — vì parser đã strip ra).
 *  - Message lỗi bằng tiếng Việt, bao gồm lỗi DB constraint (duplicate code,
 *    FK violation) được dịch sang message thân thiện.
 */

import type {
  CashTransactionImportRow,
  CustomerImportRow,
  DebtOpeningImportRow,
  InitialStockImportRow,
  InternalSaleImportRow,
  ProductImportRow,
  PurchaseOrderImportRow,
  SupplierImportRow,
} from "@/lib/excel/schemas";
import type { ImportBatchResult } from "@/lib/excel";
import { getClient, getCurrentContext, getCurrentTenantId } from "./base";
import { applyManualStockMovement } from "./stock-adjustments";
import { createInternalSale } from "./internal-sales";

/** Chạy executor cho từng row, collect error per-row. */
async function runBulk<TRow>(
  rows: TRow[],
  executor: (row: TRow) => Promise<void>
): Promise<ImportBatchResult> {
  const errors: Array<{ rowIndex: number; message: string }> = [];
  let successCount = 0;
  for (let i = 0; i < rows.length; i++) {
    try {
      await executor(rows[i]);
      successCount++;
    } catch (e) {
      errors.push({
        rowIndex: i + 1,
        message: toVietnameseError(e),
      });
    }
  }
  return {
    successCount,
    failureCount: errors.length,
    errors,
  };
}

/** Chuyển error DB → message tiếng Việt ngắn gọn. */
function toVietnameseError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const lower = msg.toLowerCase();
  if (lower.includes("duplicate key") || lower.includes("23505")) {
    return "Mã đã tồn tại trong hệ thống";
  }
  if (lower.includes("foreign key") || lower.includes("23503")) {
    return "Dữ liệu tham chiếu không tồn tại (VD: mã nhóm / mã chi nhánh sai)";
  }
  if (lower.includes("not null") || lower.includes("23502")) {
    return "Thiếu trường bắt buộc";
  }
  return msg;
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export async function bulkImportProducts(
  rows: ProductImportRow[]
): Promise<ImportBatchResult> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Preload category code → id để resolve categoryCode
  const { data: cats } = await supabase
    .from("categories")
    .select("id, code")
    .not("code", "is", null);
  const catMap = new Map<string, string>();
  for (const c of cats ?? []) {
    if (c.code) catMap.set(c.code, c.id);
  }

  return runBulk(rows, async (row) => {
    let categoryId: string | null = null;
    if (row.categoryCode) {
      const found = catMap.get(row.categoryCode);
      if (!found) {
        throw new Error(`Mã nhóm hàng "${row.categoryCode}" chưa tồn tại`);
      }
      categoryId = found;
    }

    const { error } = await supabase.from("products").insert({
      tenant_id: tenantId,
      code: row.code,
      name: row.name,
      product_type: row.productType,
      channel: row.productType === "sku" ? (row.channel ?? null) : null,
      category_id: categoryId,
      unit: row.unit,
      sell_price: row.sellPrice,
      cost_price: row.costPrice,
      stock: row.stock ?? 0,
      min_stock: row.minStock ?? 0,
      max_stock: row.maxStock ?? 1000,
      vat_rate: row.vatRate ?? 0,
      barcode: row.barcode ?? null,
      group_code: row.groupCode ?? null,
      purchase_unit: row.purchaseUnit ?? null,
      stock_unit: row.stockUnit ?? null,
      sell_unit: row.sellUnit ?? null,
      description: row.description ?? null,
      allow_sale: row.allowSale ?? true,
      is_active: row.isActive ?? true,
    });
    if (error) throw new Error(error.message);
  });
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export async function bulkImportCustomers(
  rows: CustomerImportRow[]
): Promise<ImportBatchResult> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // customer_groups không có cột code — map theo name
  const { data: groups } = await supabase
    .from("customer_groups")
    .select("id, name");
  const groupMap = new Map<string, string>();
  for (const g of groups ?? []) {
    groupMap.set(g.name, g.id);
  }

  return runBulk(rows, async (row) => {
    let groupId: string | null = null;
    if (row.groupCode) {
      // Thử match cả name và code (một số hệ thống dùng code, một số dùng tên)
      const found = groupMap.get(row.groupCode);
      if (!found) {
        throw new Error(`Nhóm KH "${row.groupCode}" chưa tồn tại (phải là TÊN nhóm đã tạo)`);
      }
      groupId = found;
    }

    const { error } = await supabase.from("customers").insert({
      tenant_id: tenantId,
      code: row.code,
      name: row.name,
      phone: row.phone ?? null,
      email: row.email ?? null,
      address: row.address ?? null,
      customer_type: row.customerType,
      gender: row.gender ?? null,
      group_id: groupId,
      is_active: row.isActive ?? true,
    });
    if (error) throw new Error(error.message);
  });
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export async function bulkImportSuppliers(
  rows: SupplierImportRow[]
): Promise<ImportBatchResult> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  return runBulk(rows, async (row) => {
    const { error } = await supabase.from("suppliers").insert({
      tenant_id: tenantId,
      code: row.code,
      name: row.name,
      phone: row.phone ?? null,
      email: row.email ?? null,
      address: row.address ?? null,
      tax_code: row.taxCode ?? null,
      is_active: row.isActive ?? true,
    });
    if (error) throw new Error(error.message);
  });
}

// ---------------------------------------------------------------------------
// Cash transactions
//
// NOTE: DB `cash_transactions` dùng `created_at` auto (không cho set ngày
// tuỳ chọn). Ngày trong Excel được prepend vào `note` để user vẫn đọc được
// timeline gốc. Nếu cần ghi đúng ngày, chạy migration thêm cột `date`.
// ---------------------------------------------------------------------------

export async function bulkImportCashTransactions(
  rows: CashTransactionImportRow[]
): Promise<ImportBatchResult> {
  const supabase = getClient();
  const ctx = await getCurrentContext();

  const { data: branches } = await supabase.from("branches").select("id, code");
  const branchMap = new Map<string, string>();
  for (const b of branches ?? []) {
    if (b.code) branchMap.set(b.code, b.id);
  }

  return runBulk(rows, async (row) => {
    let branchId = ctx.branchId;
    if (row.branchCode) {
      const found = branchMap.get(row.branchCode);
      if (!found) {
        throw new Error(`Mã chi nhánh "${row.branchCode}" chưa tồn tại`);
      }
      branchId = found;
    }

    // Prepend ngày vào note để không mất thông tin
    const dateStr = formatDateShort(row.date);
    const noteWithDate = row.note
      ? `[${dateStr}] ${row.note}`
      : `[${dateStr}] (import Excel)`;

    const { error } = await supabase.from("cash_transactions").insert({
      tenant_id: ctx.tenantId,
      branch_id: branchId,
      code: row.code,
      type: row.type,
      category: row.category,
      amount: row.amount,
      counterparty: row.counterparty ?? null,
      payment_method: row.paymentMethod ?? "cash",
      note: noteWithDate,
      created_by: ctx.userId,
    });
    if (error) throw new Error(error.message);
  });
}

function formatDateShort(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// ---------------------------------------------------------------------------
// Debt opening balance
//
// Ghi vào cột `debt` của customers/suppliers (cột hiện có).
// Kèm audit_log để trace lại thay đổi.
// ---------------------------------------------------------------------------

export async function bulkImportDebtOpening(
  rows: DebtOpeningImportRow[]
): Promise<ImportBatchResult> {
  const supabase = getClient();
  const ctx = await getCurrentContext();

  const [custRes, suppRes] = await Promise.all([
    supabase.from("customers").select("id, code"),
    supabase.from("suppliers").select("id, code"),
  ]);
  const custMap = new Map<string, string>();
  for (const c of custRes.data ?? []) custMap.set(c.code, c.id);
  const suppMap = new Map<string, string>();
  for (const s of suppRes.data ?? []) suppMap.set(s.code, s.id);

  return runBulk(rows, async (row) => {
    if (row.partyType === "customer") {
      const id = custMap.get(row.partyCode);
      if (!id) throw new Error(`Mã KH "${row.partyCode}" chưa tồn tại`);
      const { error } = await supabase
        .from("customers")
        .update({ debt: row.openingDebt })
        .eq("id", id);
      if (error) throw new Error(error.message);

      await supabase.from("audit_log").insert({
        tenant_id: ctx.tenantId,
        user_id: ctx.userId,
        action: "opening_debt_import",
        entity_type: "customer",
        entity_id: id,
        new_data: {
          partyCode: row.partyCode,
          openingDate: row.openingDate.toISOString(),
          openingDebt: row.openingDebt,
          note: row.note ?? null,
        },
      });
    } else {
      const id = suppMap.get(row.partyCode);
      if (!id) throw new Error(`Mã NCC "${row.partyCode}" chưa tồn tại`);
      const { error } = await supabase
        .from("suppliers")
        .update({ debt: row.openingDebt })
        .eq("id", id);
      if (error) throw new Error(error.message);

      await supabase.from("audit_log").insert({
        tenant_id: ctx.tenantId,
        user_id: ctx.userId,
        action: "opening_debt_import",
        entity_type: "supplier",
        entity_id: id,
        new_data: {
          partyCode: row.partyCode,
          openingDate: row.openingDate.toISOString(),
          openingDebt: row.openingDebt,
          note: row.note ?? null,
        },
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Initial stock
//
// Dùng applyManualStockMovement với type='in' để cộng thêm tồn kho.
// Caveat: nếu product đã có stock sẵn, import sẽ CỘNG DỒN (không reset).
// ---------------------------------------------------------------------------

export async function bulkImportInitialStock(
  rows: InitialStockImportRow[]
): Promise<ImportBatchResult> {
  const supabase = getClient();
  const ctx = await getCurrentContext();

  const [prodRes, branchRes] = await Promise.all([
    supabase.from("products").select("id, code"),
    supabase.from("branches").select("id, code"),
  ]);
  const prodMap = new Map<string, string>();
  for (const p of prodRes.data ?? []) prodMap.set(p.code, p.id);
  const branchMap = new Map<string, string>();
  for (const b of branchRes.data ?? []) {
    if (b.code) branchMap.set(b.code, b.id);
  }

  return runBulk(rows, async (row) => {
    const productId = prodMap.get(row.productCode);
    if (!productId) throw new Error(`Mã SP "${row.productCode}" chưa tồn tại`);

    const branchId = branchMap.get(row.branchCode);
    if (!branchId)
      throw new Error(`Mã chi nhánh "${row.branchCode}" chưa tồn tại`);

    // Insert stock movement qua helper để chốt products.stock + branch_stock
    await applyManualStockMovement(
      [
        {
          productId,
          quantity: row.quantity,
          type: "in",
          referenceType: "initial_stock_import",
          note:
            row.note ?? `Tồn kho ban đầu (import Excel) — giá vốn ${row.costPrice}`,
        },
      ],
      { tenantId: ctx.tenantId, branchId, createdBy: ctx.userId }
    );
  });
}

// ---------------------------------------------------------------------------
// Purchase orders (đơn nhập hàng)
//
// Group rows theo mã đơn → mỗi group = 1 header + nhiều items.
// Insert purchase_orders header (status='draft') + purchase_order_items.
// User vào trang Đặt hàng nhập để confirm → nhận hàng.
// ---------------------------------------------------------------------------

interface ProductMini {
  id: string;
  name: string;
  unit: string | null;
}

export async function bulkImportPurchaseOrders(
  rows: PurchaseOrderImportRow[]
): Promise<ImportBatchResult> {
  const supabase = getClient();
  const ctx = await getCurrentContext();

  // Preload maps
  const [suppRes, branchRes, prodRes] = await Promise.all([
    supabase.from("suppliers").select("id, code, name"),
    supabase.from("branches").select("id, code"),
    supabase.from("products").select("id, code, name, unit"),
  ]);
  const suppMap = new Map<string, { id: string; name: string }>();
  for (const s of suppRes.data ?? []) suppMap.set(s.code, { id: s.id, name: s.name });
  const branchMap = new Map<string, string>();
  for (const b of branchRes.data ?? []) {
    if (b.code) branchMap.set(b.code, b.id);
  }
  const prodMap = new Map<string, ProductMini>();
  for (const p of prodRes.data ?? []) {
    prodMap.set(p.code, { id: p.id, name: p.name, unit: p.unit ?? null });
  }

  // Group theo mã đơn
  const groups = new Map<string, PurchaseOrderImportRow[]>();
  for (const r of rows) {
    const arr = groups.get(r.code);
    if (arr) arr.push(r);
    else groups.set(r.code, [r]);
  }

  const errors: Array<{ rowIndex: number; message: string }> = [];
  let successCount = 0;
  let groupIdx = 0;

  for (const [code, groupRows] of groups) {
    groupIdx++;
    try {
      const first = groupRows[0];
      const supplier = suppMap.get(first.supplierCode);
      if (!supplier) {
        throw new Error(`Mã NCC "${first.supplierCode}" chưa tồn tại`);
      }
      let branchId = ctx.branchId;
      if (first.branchCode) {
        const bid = branchMap.get(first.branchCode);
        if (!bid) throw new Error(`Mã chi nhánh "${first.branchCode}" chưa tồn tại`);
        branchId = bid;
      }

      // Build items + tính totals
      const items = groupRows.map((r) => {
        const prod = prodMap.get(r.productCode);
        if (!prod) {
          throw new Error(`Mã SP "${r.productCode}" chưa tồn tại (đơn "${code}")`);
        }
        const quantity = r.quantity;
        const unitPrice = r.unitPrice;
        const discount = r.discount ?? 0;
        const vatRate = r.vatRate ?? 0;
        const gross = quantity * unitPrice - discount;
        const vatAmount = Math.round((gross * vatRate) / 100);
        const total = gross + vatAmount;
        return {
          product_id: prod.id,
          product_name: prod.name,
          unit: prod.unit ?? "Cái",
          quantity,
          received_quantity: 0,
          unit_price: unitPrice,
          discount,
          total: gross,
          vat_rate: vatRate,
          vat_amount: vatAmount,
          _lineTotalWithVat: total,
        };
      });

      const subtotal = items.reduce((s, it) => s + it.total, 0);
      const taxAmount = items.reduce((s, it) => s + it.vat_amount, 0);
      const total = subtotal + taxAmount;

      // Insert header
      const { data: poInserted, error: poErr } = await supabase
        .from("purchase_orders")
        .insert({
          tenant_id: ctx.tenantId,
          branch_id: branchId,
          code,
          supplier_id: supplier.id,
          supplier_name: supplier.name,
          status: "draft",
          subtotal,
          discount_amount: 0,
          tax_amount: taxAmount,
          total,
          paid: 0,
          debt: total,
          note: first.note ?? null,
          created_by: ctx.userId,
        })
        .select("id")
        .single();
      if (poErr) throw new Error(poErr.message);

      // Insert items
      const itemsInsert = items.map((it) => ({
        purchase_order_id: poInserted.id,
        product_id: it.product_id,
        product_name: it.product_name,
        unit: it.unit,
        quantity: it.quantity,
        received_quantity: 0,
        unit_price: it.unit_price,
        discount: it.discount,
        total: it.total,
        vat_rate: it.vat_rate,
        vat_amount: it.vat_amount,
      }));
      const { error: itemsErr } = await supabase
        .from("purchase_order_items")
        .insert(itemsInsert);
      if (itemsErr) {
        // Rollback header nếu items fail
        await supabase.from("purchase_orders").delete().eq("id", poInserted.id);
        throw new Error(itemsErr.message);
      }

      successCount++;
    } catch (e) {
      errors.push({
        rowIndex: groupIdx,
        message: `Đơn "${code}": ${toVietnameseError(e)}`,
      });
    }
  }

  return {
    successCount,
    failureCount: errors.length,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Internal sales (đơn bán nội bộ)
//
// Group rows theo mã đơn → gọi createInternalSale() cho mỗi group.
// Service tự generate code mới (mã trong Excel CHỈ DÙNG ĐỂ GROUP rows).
// ---------------------------------------------------------------------------

export async function bulkImportInternalSales(
  rows: InternalSaleImportRow[]
): Promise<ImportBatchResult> {
  const supabase = getClient();

  const [branchRes, prodRes] = await Promise.all([
    supabase.from("branches").select("id, code"),
    supabase.from("products").select("id, code, name, unit"),
  ]);
  const branchMap = new Map<string, string>();
  for (const b of branchRes.data ?? []) {
    if (b.code) branchMap.set(b.code, b.id);
  }
  const prodMap = new Map<string, ProductMini & { code: string }>();
  for (const p of prodRes.data ?? []) {
    prodMap.set(p.code, {
      id: p.id,
      code: p.code,
      name: p.name,
      unit: p.unit ?? null,
    });
  }

  const groups = new Map<string, InternalSaleImportRow[]>();
  for (const r of rows) {
    const arr = groups.get(r.code);
    if (arr) arr.push(r);
    else groups.set(r.code, [r]);
  }

  const errors: Array<{ rowIndex: number; message: string }> = [];
  let successCount = 0;
  let groupIdx = 0;

  for (const [code, groupRows] of groups) {
    groupIdx++;
    try {
      const first = groupRows[0];
      const fromBranchId = branchMap.get(first.fromBranchCode);
      if (!fromBranchId) {
        throw new Error(`Chi nhánh bán "${first.fromBranchCode}" chưa tồn tại`);
      }
      const toBranchId = branchMap.get(first.toBranchCode);
      if (!toBranchId) {
        throw new Error(`Chi nhánh mua "${first.toBranchCode}" chưa tồn tại`);
      }

      const items = groupRows.map((r) => {
        const prod = prodMap.get(r.productCode);
        if (!prod) {
          throw new Error(`Mã SP "${r.productCode}" chưa tồn tại (đơn "${code}")`);
        }
        return {
          productId: prod.id,
          productCode: prod.code,
          productName: prod.name,
          unit: prod.unit ?? "cái",
          quantity: r.quantity,
          unitPrice: r.unitPrice,
          vatRate: r.vatRate ?? 0,
        };
      });

      await createInternalSale({
        fromBranchId,
        toBranchId,
        items,
        note: first.note ? `[Excel ${code}] ${first.note}` : `[Excel ${code}]`,
        paymentMethod: first.paymentMethod ?? "debt",
      });

      successCount++;
    } catch (e) {
      errors.push({
        rowIndex: groupIdx,
        message: `Đơn "${code}": ${toVietnameseError(e)}`,
      });
    }
  }

  return {
    successCount,
    failureCount: errors.length,
    errors,
  };
}
