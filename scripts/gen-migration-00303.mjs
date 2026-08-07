#!/usr/bin/env node
/**
 * Sinh migration 00303 (Giai đoạn 1 — nền tương thích topping) TỪ nguyên văn
 * 00251, chỉ thay đúng 4 khối. Không chép tay 780 dòng.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "supabase", "migrations");
const src = readFileSync(join(DIR, "00251_harden_fnb_send_kitchen.sql"), "utf8")
  .replace(/\r\n/g, "\n");                 // file gốc dùng CRLF
const lines = src.split("\n");

// TỰ TÌM BIÊN — không đoán số dòng (lần đầu đoán 824, thật ra 822).
const iDau = lines.findIndex((l) =>
  l.startsWith("create or replace function public.fnb_send_to_kitchen_atomic_v2("));
if (iDau < 0) throw new Error("Không tìm thấy đầu hàm — dừng.");
const iCuoi = lines.findIndex((l, i) => i > iDau && l.trim() === "$$;");
if (iCuoi < 0) throw new Error("Không tìm thấy cuối hàm — dừng.");

const HAM_GOC = lines.slice(iDau, iCuoi + 1).join("\n");
if (!HAM_GOC.startsWith("create or replace function public.fnb_send_to_kitchen_atomic_v2(")
    || !HAM_GOC.trimEnd().endsWith("$$;")) {
  throw new Error("Không cắt đúng hàm — dừng, không sinh file.");
}
console.log(`  Cắt hàm: dòng ${iDau + 1}..${iCuoi + 1}`);

function thay(text, tim, thayBang, nhan) {
  const n = text.split(tim).length - 1;
  if (n !== 1) throw new Error(`Khối "${nhan}" khớp ${n} lần (phải đúng 1) — dừng.`);
  return text.replace(tim, thayBang);
}

let ham = HAM_GOC;

// ── 1. Thêm biến khai báo ─────────────────────────────────────────────
ham = thay(ham,
  "  v_price_overrides jsonb := '[]'::jsonb;\nbegin",
  `  v_price_overrides jsonb := '[]'::jsonb;
  -- 00303 (Giai đoạn 1): phân luồng topping cũ/mới + ghi vết.
  v_topping_is_legacy boolean;
  v_topping_bom_id uuid;
  v_legacy_topping_codes text[] := '{}';
begin`,
  "khai báo biến");

// ── 2. Tra sản phẩm + PHÂN LUỒNG (thay điều kiện cứng NVL-TOP%) ───────
ham = thay(ham,
`      select p.id, p.name, p.sell_price
        into v_topping_product
        from public.products p
       where p.id = nullif(v_topping->>'productId', '')::uuid
         and p.tenant_id = v_tenant_id
         and p.is_active
         and p.code ilike 'NVL-TOP%';
      if not found then
        raise exception 'TOPPING_NOT_AVAILABLE' using errcode = 'P0001';
      end if;
`,
`      -- 00303: bỏ điều kiện cứng NVL-TOP% khỏi câu tra; phân luồng ở dưới.
      select p.id, p.name, p.sell_price, p.code, p.product_type, p.channel
        into v_topping_product
        from public.products p
       where p.id = nullif(v_topping->>'productId', '')::uuid
         and p.tenant_id = v_tenant_id
         and p.is_active;
      if not found then
        raise exception 'TOPPING_NOT_AVAILABLE' using errcode = 'P0001';
      end if;

      -- 00303 — PHAN LUONG TOPPING (Giai doan 1: nhan CA HAI, chua chan cu)
      --  * LUONG CU  : ma NVL-TOP% -> nhan tam, ghi vet legacy_topping.
      --  * LUONG MOI : SKU kenh fnb -> CHI nhan khi tim duoc BOM THAT dang
      --                ap dung cho chi nhanh. KHONG tin co products.has_bom:
      --                5 ma SKU-TOP dang has_bom=true nhung BOM toan cuc
      --                is_active=false -> co noi doi o moi chi nhanh khac.
      --  * Con lai   : tu choi.
      if v_topping_product.code ilike 'NVL-TOP%' then
        v_topping_is_legacy := true;
        v_topping_bom_id := null;
        v_legacy_topping_codes := v_legacy_topping_codes || v_topping_product.code;
      elsif v_topping_product.product_type = 'sku'
            and v_topping_product.channel = 'fnb' then
        v_topping_is_legacy := false;
        v_topping_bom_id := public.get_active_bom_for_branch(
          v_topping_product.id, p_branch_id, null
        );
        if v_topping_bom_id is null then
          raise exception 'TOPPING_BOM_MISSING:%', v_topping_product.name
            using errcode = 'P0001';
        end if;
      else
        raise exception 'TOPPING_NOT_ELIGIBLE:%', v_topping_product.name
          using errcode = 'P0001';
      end if;
`,
  "phân luồng topping");

// ── 3. Snapshot: ghi CẢ HAI khoá + isLegacy + bomId ───────────────────
ham = thay(ham,
`        jsonb_build_object(
          'productId', v_topping_product.id,
          'name', v_topping_product.name,
          'quantity', v_topping_qty,
          'price', v_topping_price
        )`,
`        jsonb_build_object(
          'productId', v_topping_product.id,
          -- 00303 TUONG THICH TAM THOI — KHONG PHAI THIET KE LAU DAI.
          -- Ham thanh toan dang doc 'product_id'; ghi them khoa nay de no
          -- lay duoc ma topping ma KHONG phai chep lai 20.106 ky tu ham tien.
          -- KE HOACH BO: sau khi Giai doan 2 hoan tat, migration Giai doan 2
          -- phai XOA dong 'product_id' nay.
          'product_id', v_topping_product.id,
          'name', v_topping_product.name,
          'quantity', v_topping_qty,
          'price', v_topping_price,
          -- Hai khoa duoi CHI DE GHI NHAN, CHUA DUOC DUNG de tru kho.
          -- Chung KHONG giai quyet tinh huong BOM bi tat sau khi gui bep —
          -- viec do thuoc Giai doan 2.
          'isLegacy', v_topping_is_legacy,
          'bomId', v_topping_bom_id
        )`,
  "snapshot topping");

// ── 4. Audit: MỘT dòng cho cả lần gửi, kèm danh sách mã ───────────────
ham = thay(ham,
`      v_item_batch_id
    );
  end loop;
`,
`      v_item_batch_id
    );
  end loop;

  -- 00303: ghi vet luong cu — DUNG MOT DONG cho moi lan gui (ke ca gui bo
  -- sung), kem danh sach ma. KHONG ghi tung topping de audit_log khong phinh.
  -- Dung de biet bao gio luong NVL-TOP% het phat sinh -> moi sang Giai doan 2.
  if array_length(v_legacy_topping_codes, 1) > 0 then
    insert into public.audit_log (
      tenant_id, user_id, action, entity_type, entity_id, new_data
    ) values (
      v_tenant_id, v_actor, 'legacy_topping', 'kitchen_order', v_order_id,
      jsonb_build_object(
        'ly_do', 'Topping con dung ma nguyen lieu NVL-TOP (luong cu)',
        'branch_id', p_branch_id,
        'ma_topping', to_jsonb(v_legacy_topping_codes),
        'so_luot', array_length(v_legacy_topping_codes, 1)
      )
    );
  end if;
`,
  "ghi vết legacy");

const VAN_TAY = "695f1b1bfd4cd967297d9b7e75345a4c";

const DAU = `-- ============================================================
-- 00303 — GIAI DOAN 1: NEN TUONG THICH TOPPING F&B
-- CEO chot 07/08/2026. Sinh tu dong tu 00251 (khong chep tay).
--
-- DAY CHI LA NEN. CHUA cho giao dien gui SKU-TPP chinh thuc.
--    Ly do: ham thanh toan hien tai van co the tru THANG ton SKU mon neu
--    BOM bi tat SAU khi da gui bep. Viec do thuoc GIAI DOAN 2.
--
-- LAM:
--   1. Bo dieu kien cung NVL-TOP% khoi cau tra topping; phan luong ro rang
--   2. Luong cu NVL-TOP% van nhan (dung tenant + dang bat)
--   3. Luong moi chi nhan SKU kenh fnb CO BOM THAT dang ap dung cho chi
--      nhanh (get_active_bom_for_branch), KHONG tin co products.has_bom
--   4. Snapshot ghi CA 'productId' lan 'product_id' (tuong thich tam thoi)
--      + 'isLegacy' + 'bomId' (chi ghi nhan, chua dung)
--   5. Ghi audit_log 'legacy_topping' — MOT dong moi lan gui
--
-- KHONG LAM:
--   x KHONG chan NVL-TOP%        x KHONG tat nhom tuy chon Topping
--   x KHONG dung ham thanh toan  x KHONG dung du lieu kinh doanh
--   x KHONG doi don vi ton kho
--
-- Gia topping van luon lay tu products.sell_price cua may chu; guard
-- TOPPING_PRICE_CHANGED giu nguyen — khong tin gia trinh duyet gui len.
--
-- KHOI PHUC: chay 00303_rollback_fnb_topping_compat_phase1.sql
-- ============================================================

begin;

-- ── CHOT VAN TAY: ban dang cai phai DUNG bang ban da preflight ─────────
-- Neu ai do da sua ham nay sau preflight, migration DUNG, khong ghi de.
do $guard$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname = 'fnb_send_to_kitchen_atomic_v2'
      and md5(pg_get_functiondef(p.oid)) = '${VAN_TAY}'
  ) then
    raise exception
      'DUNG — VAN TAY KHONG KHOP. fnb_send_to_kitchen_atomic_v2 dang cai KHAC ban da preflight (%). Chay lai preflight roi sinh lai 00303.',
      '${VAN_TAY}'
      using errcode = 'P0001';
  end if;
end
$guard$;

`;

const CUOI = `

commit;

-- ============================================================
-- SAU KHI CHAY — kiem nhanh (chi doc):
--
--   select md5(pg_get_functiondef(p.oid)) as van_tay_moi,
--          (pg_get_functiondef(p.oid) like '%TOPPING_BOM_MISSING%') as co_guard_bom,
--          (pg_get_functiondef(p.oid) like '%legacy_topping%')      as co_ghi_vet
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname='public' and p.prokind='f'
--     and p.proname='fnb_send_to_kitchen_atomic_v2';
--
--   -- Theo doi luong cu con phat sinh khong:
--   select date_trunc('day', created_at) as ngay, count(*) as so_lan_gui
--   from public.audit_log where action = 'legacy_topping'
--   group by 1 order by 1 desc;
-- ============================================================
`;

writeFileSync(join(DIR, "00303_fnb_topping_compat_phase1.sql"), DAU + ham + CUOI, "utf8");

// ── File khôi phục: nguyên văn hàm cũ, không sửa gì ───────────────────
const ROLLBACK = `-- ============================================================
-- KHOI PHUC 00303 — dua fnb_send_to_kitchen_atomic_v2 ve DUNG ban 00251.
-- Nguyen van, khong sua mot ky tu. Chay khi can quay lui Giai doan 1.
--
-- Sau khi chay, van tay phai tro lai: ${VAN_TAY}
-- ============================================================

begin;

${HAM_GOC}

commit;

-- Kiem sau khi khoi phuc:
--   select md5(pg_get_functiondef(p.oid)) = '${VAN_TAY}' as da_ve_ban_cu
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname='public' and p.prokind='f'
--     and p.proname='fnb_send_to_kitchen_atomic_v2';
`;
writeFileSync(join(DIR, "00303_rollback_fnb_topping_compat_phase1.sql"), ROLLBACK, "utf8");

console.log("Da sinh 2 file:");
console.log("  00303_fnb_topping_compat_phase1.sql");
console.log("  00303_rollback_fnb_topping_compat_phase1.sql");
console.log(`  Ham goc: ${HAM_GOC.length} ky tu -> ham moi: ${ham.length} ky tu`);
