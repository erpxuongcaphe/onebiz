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
  BOMImportRow,
  CashTransactionImportRow,
  CategoryImportRow,
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

type RowWithExcelIndex = { __excelRowIndex?: number };

function excelRowIndex(row: unknown, fallback: number): number {
  const index = (row as RowWithExcelIndex | null)?.__excelRowIndex;
  return typeof index === "number" && Number.isFinite(index) ? index : fallback;
}

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
        rowIndex: excelRowIndex(rows[i], i + 1),
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
    .eq("tenant_id", tenantId)
    .not("code", "is", null);
  const catMap = new Map<string, string>();
  for (const c of cats ?? []) {
    if (c.code) catMap.set(c.code, c.id);
  }

  // Day 20/05/2026 (CEO BOM decouple Phase 4): Preload Mã BOM trong tenant
  // để verify khi user nhập cột "Mã BOM" trong Excel SP. Set lookup O(1).
  const { data: bomRows } = await supabase
    .from("bom")
    .select("code")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .not("code", "is", null);
  const existingBomCodes = new Set<string>(
    (bomRows ?? []).map((b) => (b as { code: string }).code),
  );

  return runBulk(rows, async (row) => {
    if ((row.stock ?? 0) > 0) {
      throw new Error("File hàng hóa không ghi tồn kho; dùng mẫu Tồn kho đầu kỳ hoặc phiếu nhập");
    }

    let categoryId: string | null = null;
    if (row.categoryCode) {
      const found = catMap.get(row.categoryCode);
      if (!found) {
        throw new Error(`Mã nhóm hàng "${row.categoryCode}" chưa tồn tại`);
      }
      categoryId = found;
    }

    // Day 19/05/2026 (CEO Phương án D): Excel chỉ còn 1 cột "Đơn vị tính".
    // Service auto-fill 4 cột DB (unit, purchase_unit, stock_unit, sell_unit)
    // = unit chính để nhất quán + không break code đang đọc 3 cột phụ.
    const finalUnit = row.unit?.trim() || "Cái";

    // Day 20/05/2026 (CEO BOM Phase 4): verify Mã BOM trước khi insert SP.
    // Yêu cầu: BOM phải tồn tại trong hệ thống (active). Set is_active flag.
    let bomCode: string | null = null;
    let bomHasFlag = false;
    if (row.bomCode && row.bomCode.trim() && row.productType === "sku") {
      const trimmed = row.bomCode.trim();
      if (!existingBomCodes.has(trimmed)) {
        throw new Error(
          `Mã BOM "${trimmed}" chưa tồn tại trong hệ thống. Tạo BOM ở /hang-hoa/cong-thuc trước khi import SKU này.`,
        );
      }
      bomCode = trimmed;
      bomHasFlag = true;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: inserted, error } = await (
      supabase.from("products").insert as any
    )({
      tenant_id: tenantId,
      code: row.code,
      name: row.name,
      product_type: row.productType,
      channel: row.productType === "sku" ? (row.channel ?? null) : null,
      category_id: categoryId,
      unit: finalUnit,
      sell_price: row.sellPrice,
      cost_price: row.costPrice,
      stock: 0,
      min_stock: row.minStock ?? 0,
      max_stock: row.maxStock ?? 1000,
      vat_rate: row.vatRate ?? 0,
      barcode: row.barcode ?? null,
      group_code: row.groupCode ?? null,
      purchase_unit: finalUnit,
      stock_unit: finalUnit,
      sell_unit: finalUnit,
      description: row.description ?? null,
      allow_sale: row.allowSale ?? true,
      is_active: row.isActive ?? true,
      // Day 20/05/2026 (CEO BOM): link SKU với BOM qua code
      bom_code: bomCode,
      has_bom: bomHasFlag,
    })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    // Day 19/05/2026 (CEO UOM Smart Hybrid): khai báo quy đổi đơn vị
    // nếu Excel có "Đóng gói" + "Hệ số quy đổi". Validate đã đảm bảo cặp.
    if (
      inserted?.id &&
      row.bulkUnit?.trim() &&
      typeof row.bulkFactor === "number" &&
      row.bulkFactor > 0
    ) {
      const { error: convError } = await supabase
        .from("uom_conversions")
        .insert({
          tenant_id: tenantId,
          product_id: inserted.id,
          from_unit: row.bulkUnit.trim(),
          to_unit: finalUnit,
          factor: row.bulkFactor,
          is_active: true,
        });
      if (convError) {
        // Không rollback product — chỉ log warning. UOM conversion là optional
        // metadata. User có thể thêm sau qua tab "ĐVT quy đổi".
        console.warn(
          `[bulkImportProducts] Quy đổi cho ${row.code} không lưu được: ${convError.message}`,
        );
      }
    }
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
    .select("id, name")
    .eq("tenant_id", tenantId);
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

    // Day 17/05 + 18/05: auto-compose address từ 6 fields (số nhà + đường
    // tách rời) → join thành address text fallback.
    const houseAndStreet = [row.houseNumber, row.street]
      .filter((s) => s && s.trim().length > 0)
      .join(" ");
    const composed = [
      houseAndStreet,
      row.quarter,
      row.ward,
      row.province,
      row.country,
    ]
      .filter((s) => s && s.trim().length > 0)
      .join(", ");

    const { error } = await supabase.from("customers").insert({
      tenant_id: tenantId,
      code: row.code,
      name: row.name,
      phone: row.phone ?? null,
      email: row.email ?? null,
      address: composed || row.address || null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      house_number: row.houseNumber ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      street: row.street ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      quarter: row.quarter ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ward: row.ward ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      province: row.province ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      country: row.country ?? null,
      // Day 18/05/2026: MST cho KH doanh nghiệp
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tax_code: row.taxCode ?? null,
      customer_type: row.customerType,
      gender: row.gender ?? null,
      group_id: groupId,
      is_active: row.isActive ?? true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
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
    // Day 17/05 + 18/05: auto-compose address từ 6 fields (số nhà + đường tách)
    const houseAndStreet = [row.houseNumber, row.street]
      .filter((s) => s && s.trim().length > 0)
      .join(" ");
    const composed = [
      houseAndStreet,
      row.quarter,
      row.ward,
      row.province,
      row.country,
    ]
      .filter((s) => s && s.trim().length > 0)
      .join(", ");

    const { error } = await supabase.from("suppliers").insert({
      tenant_id: tenantId,
      code: row.code,
      name: row.name,
      phone: row.phone ?? null,
      email: row.email ?? null,
      address: composed || row.address || null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      house_number: row.houseNumber ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      street: row.street ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      quarter: row.quarter ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ward: row.ward ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      province: row.province ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      country: row.country ?? null,
      tax_code: row.taxCode ?? null,
      note: row.note ?? null,
      is_active: row.isActive ?? true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
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

  const { data: branches } = await supabase
    .from("branches")
    .select("id, code")
    .eq("tenant_id", ctx.tenantId);
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
    supabase.from("customers").select("id, code").eq("tenant_id", ctx.tenantId),
    supabase.from("suppliers").select("id, code").eq("tenant_id", ctx.tenantId),
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
        .eq("tenant_id", ctx.tenantId)
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
        .eq("tenant_id", ctx.tenantId)
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
    supabase.from("products").select("id, code").eq("tenant_id", ctx.tenantId),
    supabase.from("branches").select("id, code").eq("tenant_id", ctx.tenantId),
  ]);
  const prodMap = new Map<string, string>();
  for (const p of prodRes.data ?? []) prodMap.set(p.code, p.id);
  const branchMap = new Map<string, string>();
  for (const b of branchRes.data ?? []) {
    if (b.code) branchMap.set(b.code, b.id);
  }

  // CEO 28/05/2026: GHI ĐÈ thay vì cộng dồn (idempotent).
  // Trước đây type:'in' → mỗi lần import CỘNG THÊM vào tồn cũ → nhập lại =
  // nhân đôi. Và KHÔNG cập nhật giá vốn (lệch với ý đồ schema "giá vốn TB
  // ban đầu"). Giờ: SET tồn = số trong file (tính delta so với hiện tại) +
  // cập nhật giá vốn. Nhập lại bao nhiêu lần cũng cho ra đúng giá trị file
  // → đúng nghĩa "tồn đầu kỳ" + cho phép "làm lại từ đầu".
  const stockRes = await supabase
    .from("branch_stock")
    .select("product_id, branch_id, quantity")
    .eq("tenant_id", ctx.tenantId);
  const curStock = new Map<string, number>();
  for (const s of stockRes.data ?? []) {
    curStock.set(`${s.product_id}:${s.branch_id}`, Number(s.quantity ?? 0));
  }

  return runBulk(rows, async (row) => {
    const productId = prodMap.get(row.productCode);
    if (!productId) throw new Error(`Mã SP "${row.productCode}" chưa tồn tại`);

    const branchId = branchMap.get(row.branchCode);
    if (!branchId)
      throw new Error(`Mã chi nhánh "${row.branchCode}" chưa tồn tại`);

    // GHI ĐÈ: set tồn = số trong file qua delta = file − hiện tại.
    const current = curStock.get(`${productId}:${branchId}`) ?? 0;
    const delta = row.quantity - current;
    if (Math.abs(delta) > 1e-9) {
      await applyManualStockMovement(
        [
          {
            productId,
            quantity: Math.abs(delta),
            type: delta > 0 ? "in" : "out",
            referenceType: "initial_stock_reset",
            note:
              row.note ??
              `Nhập lại tồn đầu kỳ (ghi đè) — giá vốn ${row.costPrice}`,
          },
        ],
        { tenantId: ctx.tenantId, branchId, createdBy: ctx.userId }
      );
    }

    // Cập nhật giá vốn (giá vốn trung bình ban đầu) theo file.
    if (typeof row.costPrice === "number" && row.costPrice >= 0) {
      const { error: costErr } = await supabase
        .from("products")
        .update({ cost_price: row.costPrice })
        .eq("id", productId)
        .eq("tenant_id", ctx.tenantId);
      if (costErr) throw costErr;
    }
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
    supabase.from("suppliers").select("id, code, name").eq("tenant_id", ctx.tenantId),
    supabase.from("branches").select("id, code").eq("tenant_id", ctx.tenantId),
    supabase.from("products").select("id, code, name, unit").eq("tenant_id", ctx.tenantId),
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
        rowIndex: excelRowIndex(groupRows[0], groupIdx),
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
  const ctx = await getCurrentContext();

  const [branchRes, prodRes] = await Promise.all([
    supabase.from("branches").select("id, code").eq("tenant_id", ctx.tenantId),
    supabase.from("products").select("id, code, name, unit").eq("tenant_id", ctx.tenantId),
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
        rowIndex: excelRowIndex(groupRows[0], groupIdx),
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
// BOMs (Công thức sản xuất) — CEO 20/05/2026 Phase 3
//
// File Excel BOM = 1 sheet phẳng (denormalized). Mỗi row = 1 NVL của 1 BOM.
// Master info (bomCode + bomName + branchCode) lặp lại ở các row cùng 1 BOM.
//
// Logic import:
//   1. Group rows theo bomCode
//   2. Mỗi group → tạo 1 BOM master (lấy master info từ row đầu) +
//      tạo N bom_items
//   3. Validate:
//      - Mã NVL phải tồn tại trong tenant
//      - Mã chi nhánh (nếu có) phải tồn tại
//      - Master info (bomName, branchCode) consistent trong cùng group
//      - Mã BOM unique trong tenant (DB enforce)
//   4. Atomic per BOM — 1 BOM lỗi không block BOM khác
//
// Standalone BOM: product_id = NULL. SKU gắn BOM sau qua products.bom_code.
// ---------------------------------------------------------------------------

export async function bulkImportBOMs(
  rows: BOMImportRow[],
): Promise<ImportBatchResult> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const errors: ImportBatchResult["errors"] = [];
  let successCount = 0;

  // Preload: materials by code + branches by code
  const { data: products } = await supabase
    .from("products")
    .select("id, code, unit")
    .eq("tenant_id", tenantId);
  const materialMap = new Map<string, { id: string; unit: string }>();
  for (const p of products ?? []) {
    if (p.code) {
      materialMap.set(p.code, {
        id: p.id as string,
        unit: (p as { unit?: string }).unit ?? "",
      });
    }
  }

  const { data: branches } = await supabase
    .from("branches")
    .select("id, code")
    .eq("tenant_id", tenantId);
  const branchMap = new Map<string, string>();
  for (const b of branches ?? []) {
    if (b.code) branchMap.set(b.code, b.id as string);
  }

  // Group rows by bomCode (preserve order)
  const groups = new Map<string, BOMImportRow[]>();
  const groupOrder: string[] = [];
  for (const row of rows) {
    const key = row.bomCode?.trim();
    if (!key) continue;
    if (!groups.has(key)) {
      groups.set(key, []);
      groupOrder.push(key);
    }
    groups.get(key)!.push(row);
  }

  for (let groupIdx = 0; groupIdx < groupOrder.length; groupIdx++) {
    const code = groupOrder[groupIdx];
    const groupRows = groups.get(code)!;
    const first = groupRows[0];
    const firstRowIndex = excelRowIndex(first, groupIdx);

    try {
      // Validate master consistency trong cùng group
      const inconsistent = groupRows.find(
        (r) =>
          (r.bomName ?? "").trim() !== (first.bomName ?? "").trim() ||
          (r.branchCode ?? "").trim() !== (first.branchCode ?? "").trim(),
      );
      if (inconsistent) {
        throw new Error(
          `Các row cùng Mã BOM "${code}" phải có cùng "Tên BOM" và "Mã chi nhánh"`,
        );
      }

      // Resolve branch
      let branchId: string | null = null;
      if (first.branchCode && first.branchCode.trim()) {
        const found = branchMap.get(first.branchCode.trim());
        if (!found) {
          throw new Error(`Mã chi nhánh "${first.branchCode}" chưa tồn tại`);
        }
        branchId = found;
      }

      // Validate material codes
      const itemsResolved = groupRows.map((r) => {
        const mat = materialMap.get(r.materialCode);
        if (!mat) {
          throw new Error(
            `Mã NVL "${r.materialCode}" chưa tồn tại trong hệ thống`,
          );
        }
        return {
          materialId: mat.id,
          quantity: r.quantity,
          unit: r.unit?.trim() || mat.unit || "cái",
          note: r.note ?? null,
        };
      });

      // Insert BOM header (product_id = NULL — standalone)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: bomInserted, error: bomErr } = await (
        supabase.from("bom").insert as any
      )({
        tenant_id: tenantId,
        product_id: null,
        variant_id: null,
        branch_id: branchId,
        code: code,
        name: first.bomName,
        version: 1,
        is_active: true,
        batch_size: 1,
        yield_qty: first.yieldQty ?? 1,
        yield_unit: first.yieldUnit?.trim() || "cái",
        note: null,
      })
        .select("id")
        .single();

      if (bomErr) {
        if (bomErr.message?.includes("idx_bom_code_branch_unique")) {
          throw new Error(`Mã BOM "${code}" đã tồn tại trong tenant`);
        }
        throw bomErr;
      }

      const bomId = (bomInserted as { id: string } | null)?.id;
      if (!bomId) {
        throw new Error("Không lấy được ID BOM sau khi tạo");
      }

      // Insert bom_items
      const itemsPayload = itemsResolved.map((it, idx) => ({
        bom_id: bomId,
        material_id: it.materialId,
        quantity: it.quantity,
        unit: it.unit,
        waste_percent: 0,
        sort_order: idx,
        note: it.note,
      }));

      const { error: itemsErr } = await supabase
        .from("bom_items")
        .insert(itemsPayload);

      if (itemsErr) {
        // Rollback BOM master để không có BOM trống
        await supabase.from("bom").delete().eq("id", bomId);
        throw itemsErr;
      }

      successCount++;
    } catch (e) {
      errors.push({
        rowIndex: firstRowIndex,
        message: `BOM "${code}": ${toVietnameseError(e)}`,
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
// Categories — CEO 22/05/2026 (V3)
// ---------------------------------------------------------------------------

/**
 * Bulk import nhóm hàng (categories). Upsert theo (scope, code):
 *   - Mã trùng + cùng scope → cập nhật name + channel
 *   - Mã mới → tạo nhóm mới
 *
 * Validate:
 *   - SKU bắt buộc channel (đã check ở schema validateRow)
 *   - NVL không được có channel (đã check ở schema)
 *   - Code không strip prefix (RPC next_group_code dedupe khi sinh mã SP)
 */
export async function bulkImportCategories(
  rows: CategoryImportRow[],
): Promise<ImportBatchResult> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Preload existing categories per scope để biết upsert vs insert
  const { data: existing } = await supabase
    .from("categories")
    .select("id, code, scope")
    .eq("tenant_id", tenantId)
    .in("scope", ["nvl", "sku"]);

  const keyToId = new Map<string, string>();
  for (const c of existing ?? []) {
    if (c.code && c.scope) {
      keyToId.set(`${c.scope}|${(c.code as string).toUpperCase()}`, c.id as string);
    }
  }

  return runBulk(rows, async (row) => {
    const code = row.code.trim().toUpperCase();
    const key = `${row.scope}|${code}`;
    const existingId = keyToId.get(key);

    const payload: Record<string, unknown> = {
      tenant_id: tenantId,
      name: row.name.trim(),
      code,
      scope: row.scope,
      channel: row.scope === "sku" ? (row.channel ?? null) : null,
      sort_order: row.sortOrder ?? 0,
    };

    if (existingId) {
      // Update: chỉ cần name + channel + sort_order
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from("categories").update as any)({
        name: payload.name,
        channel: payload.channel,
        sort_order: payload.sort_order,
      })
        .eq("id", existingId)
        .eq("tenant_id", tenantId);
      if (error) throw error;
    } else {
      // Insert mới
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error, data } = await (supabase.from("categories").insert as any)(payload)
        .select("id")
        .single();
      if (error) throw error;
      // Cache để các row sau cùng key không insert trùng
      if (data?.id) keyToId.set(key, data.id);
    }
  });
}
