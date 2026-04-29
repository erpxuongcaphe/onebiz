# Smoke / QA CLI scripts

CLI tests + ops scripts cho project. Mục tiêu: Claude (AI) tự chạy mỗi
sprint để verify không regression — giảm phụ thuộc vào CEO test thủ công.

## Tổng quan 3 lớp

| Lớp | Lệnh | Mục đích | Tốc độ |
|---|---|---|---|
| 1 | `npm run test:smoke` | Vitest unit/integration mock | ~10s |
| 2 | `npm run check:tenant` | Static analysis tenant filter | ~1s |
| 2 | `npm run smoke:health` | HTTP probe production URL | ~3s |
| ALL | `npm run smoke` | Aggregator chạy tất cả | ~15s |

---

## `npm run smoke` — chạy hết

Khuyến nghị chạy trước mỗi commit. Aggregator fail-fast: dừng ngay nếu
step nào lỗi.

```bash
npm run smoke
# ━━━━━ TypeScript ━━━━━
# ✅ TypeScript (3200ms)
#
# ━━━━━ Smoke tests ━━━━━
# Test Files  3 passed (3)
# Tests       7 passed (7)
# ✅ Smoke tests (8500ms)
#
# ━━━━━ Tenant isolation ━━━━━
# Total services: 38
#   ✅ Clean: 22
#   ⚠️ Warning (partial): 0
#   ❌ Violation: 16
# ❌ Tenant isolation FAILED (1200ms)
```

---

## `npm run test:smoke` — Vitest smoke

Subset critical tests trong `src/__tests__/smoke/`. Catch các bug đã từng
phát hiện trong production:

- `client-singleton.test.ts` — verify `createClient()` return same instance
  (regression test cho lock contention bug)
- `tenant-id-dedup.test.ts` — verify in-flight promise dedup hoạt động
  (50 concurrent calls → 1 lần gọi `auth.getUser()`)
- `tier-resolve.test.ts` — service `resolveAppliedTier` flow OK

Add test mới: tạo file `*.test.ts` trong folder, vitest auto-discover.

---

## `npm run check:tenant` — Static analysis

Quét toàn bộ services trong `src/lib/services/supabase/`, đếm:
- Số queries `.from("table")`
- Số tenant references (`eq("tenant_id"...)`, `getCurrentTenantId()`, etc.)

Báo cáo:
- ✅ Clean — service có >= 50% query có tenant filter
- ⚠️ Warning — < 50% (cần audit)
- ❌ Violation — 0 tenant filter HOẶC hardcode `tenant_id: ""`

Exit 1 nếu có Violation. Warning không block (cần audit progressive).

---

## `npm run smoke:health` — HTTP probe

Ping production URL, kiểm tra:
- Page public 200 (`/`, `/dang-nhap`)
- Page auth 302 redirect tới login (server alive)

```bash
npm run smoke:health
npm run smoke:health -- --url=onebiz-staging.vercel.app  # custom URL
```

---

## Thêm test mới

### Smoke test (Vitest)

Chỉ thêm test khi đã debug thực tế bug đó. Mục đích là regression catch,
không phải coverage cho coverage.

```ts
// src/__tests__/smoke/<feature>.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ /* mock chain */ }),
  getCurrentTenantId: vi.fn().mockResolvedValue("tenant-test-1"),
}));

describe("Feature smoke", () => {
  it("does the thing", async () => {
    // ...
  });
});
```

### CLI ops script

Thêm file `scripts/<name>.mjs`, wire vào `package.json` scripts:

```json
"my-script": "node scripts/my-script.mjs"
```

---

## Pattern cho Claude tự chạy

Khi Claude làm sprint mới:
1. **Trước khi code**: `npm run smoke` để biết baseline
2. **Sau mỗi major change**: `npm run test:smoke` (10s, catch nhanh)
3. **Trước commit**: `npm run smoke` đầy đủ
4. **Sau Vercel deploy**: `npm run smoke:health -- --url=<vercel-url>`

Plus Claude có thể đọc output script qua `Bash` tool, không cần CEO login
giúp test mỗi sprint.

---

## Roadmap

- [x] Lớp 1: Vitest smoke
- [x] Lớp 2: CLI ops (health + tenant audit)
- [ ] Lớp 3 (later): Playwright E2E real browser khi cần test UX critical
- [ ] CI/CD: GitHub Actions chạy `npm run smoke` mỗi push
