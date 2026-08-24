import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00344_harden_fnb_pos_pin_handover.sql",
  "utf8",
);
const route = readFileSync(
  "src/app/api/auth/pos-pin-switch/route.ts",
  "utf8",
);
const postflight = readFileSync(
  "docs/qc/sql/POSTFLIGHT-FNB-PIN-BAN-GIAO-READONLY.sql",
  "utf8",
);

describe("00344 - ban giao PIN POS FnB", () => {
  it("giu chu ky cu va chan cai dat sai khac fingerprint production", () => {
    expect(migration).toContain("public.verify_pos_pin(uuid,text,uuid)");
    expect(migration).toContain("public.list_pos_pin_users(uuid)");
    expect(migration).toContain("p_branch_id uuid default null");
    expect(migration).toContain("1f1bb9a2668e66bc105452239116f1bc");
    expect(migration).toContain("3473e36536c078fdd3de0fbf39b585de");
    expect(migration).toContain("FNB_PIN_HANDOVER_FINGERPRINT_CHANGED");
  });

  it("lay nguoi giao tu auth va bat ca A/B dung tenant, chi nhanh, quyen FnB", () => {
    expect(migration).toContain("v_actor uuid := auth.uid()");
    expect(migration).toContain("p.tenant_id = v_actor_profile.tenant_id");
    expect(migration).toContain("public.user_has_branch_access(v_actor, p_branch_id)");
    expect(migration).toContain("public.user_has_branch_access(v_target_profile.id, p_branch_id)");
    expect(migration).toContain("public.user_has_permission(v_actor, 'pos_fnb.send_kitchen')");
    expect(migration).toContain("public.user_has_permission(v_target_profile.id, 'pos_fnb.send_kitchen')");
    expect(migration).toContain("if p_user_id = v_actor then");
  });

  it("khoa dong PIN va ghi ca nguoi giao, nguoi nhan, chi nhanh, ca nguon", () => {
    expect(migration).toMatch(/from public\.profiles p[\s\S]*for update/);
    expect(migration).toContain("'pos_pin_handover'");
    expect(migration).toContain("'from_user_id', v_actor");
    expect(migration).toContain("'to_user_id', v_target_profile.id");
    expect(migration).toContain("'branch_id', p_branch_id");
    expect(migration).toContain("'source_shift_id', v_source_shift_id");
  });

  it("giu gio theo chi nhanh, khong co lenh chuyen chu ca hay tien quy", () => {
    expect(migration).not.toMatch(/update public\.shifts[\s\S]*cashier_id/i);
    expect(migration).not.toMatch(/update public\.cash_transactions/i);
    expect(migration).not.toMatch(/update public\.invoices/i);
  });

  it("chi authenticated goi duoc va reload schema sau commit", () => {
    expect(migration).toContain("revoke all on function public.verify_pos_pin(uuid, text, uuid) from public, anon;");
    expect(migration).toContain("grant execute on function public.verify_pos_pin(uuid, text, uuid) to authenticated;");
    expect(migration).toMatch(/commit;\s*notify pgrst, 'reload schema';/i);
  });

  it("co hau kiem chi doc, xac nhan guard va cam chuyen ca/quy ngam", () => {
    expect(postflight).toContain("K3_KHOA_VA_NHAT_KY");
    expect(postflight).toContain("K4_KHONG_CHUYEN_SO_QUY_HOAC_CA");
    expect(postflight).toContain("K5_QUYEN_GOI");
    expect(postflight).not.toMatch(/^\s*(insert|update|delete|alter|create|drop)\b/im);
  });
});

describe("API ban giao PIN", () => {
  it("bat buoc branch va khong tra chi tiet quyen noi bo cho client", () => {
    expect(route).toContain("!body.userId || !body.pin || !body.branchId");
    expect(route).toContain("UUID_RE.test(body.branchId)");
    expect(route).toContain("PIN_HANDOVER_DENIED");
    expect(route).toContain("Không thể bàn giao cho nhân viên này tại chi nhánh hiện tại.");
  });
});
