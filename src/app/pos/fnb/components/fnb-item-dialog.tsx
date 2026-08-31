"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { FnbCartTopping, ModifierSelectionPayload } from "@/lib/types/fnb";
import { Icon } from "@/components/ui/icon";
import type {
  ModifierGroup,
  ModifierOption,
} from "@/lib/services/supabase/modifier-groups";

// ── Types ──

interface Variant { id: string; label: string; sell_price: number; is_default?: boolean }
interface Topping { id: string; name: string; price: number }
interface Product { id: string; name: string; sell_price: number }

/**
 * CEO 01/06/2026 — Sprint 2.2e:
 * Dynamic modifier groups load từ DB (Mức đường, Mức đá, Topping, Size...).
 * Backward compat: nếu không có dynamic groups → fallback hardcoded R7
 * (SWEETNESS_OPTIONS + ICE_OPTIONS) để cashier không bị mất UX cũ.
 */
export interface DynamicModifierData {
  groups: ModifierGroup[];
  /** Map<groupId, options[]> — preload toàn bộ options của các groups */
  optionsByGroup: Map<string, ModifierOption[]>;
  /**
   * 06/08/2026 — PHÂN BIỆT "món không có tuỳ chọn" với "tải KHÔNG được".
   *
   * Trước đây lỗi mạng bị nuốt thành `groups: []` rồi CÒN ĐƯỢC CACHE
   * (page.tsx:837-841 cũ) → món đó vĩnh viễn không hỏi Đường/Đá/Topping
   * trong cả phiên: bếp pha sai + không thu tiền topping. Tệ hơn nữa, khi
   * món không có size thì code còn `quickAdd()` thẳng vào giỏ.
   *
   * `failed: true` ⇒ dialog hiện lỗi + nút Thử lại, KHÔNG cho xác nhận,
   * và tầng gọi KHÔNG được cache.
   */
  failed?: boolean;
}

export interface FnbItemConfirmPayload {
  productId: string;
  productName: string;
  variantId?: string;
  variantLabel?: string;
  quantity: number;
  unitPrice: number;
  toppings: FnbCartTopping[];
  /**
   * CEO 01/06/2026 — Sprint 2.3a: snapshot dynamic modifier choices.
   * Optional — chỉ có khi SP đang dùng dynamic modifier groups.
   */
  modifierSelections?: ModifierSelectionPayload[];
  note?: string;
}

/**
 * Phase 1A.2: payload pre-fill khi cashier bấm "Sửa" trên 1 dòng giỏ.
 * Dialog sẽ tự parse `note` để khôi phục mức đường/đá vào pill, phần
 * còn lại đẩy vào textarea ghi chú tự do.
 */
export interface FnbItemInitialSelection {
  variantId?: string;
  quantity?: number;
  toppings?: Array<{ id: string; quantity: number }>;
  note?: string;
  /** Sprint 2.3a: prefill dynamic modifier choices khi sửa line cũ. */
  modifierSelections?: ModifierSelectionPayload[];
}

interface FnbItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
  variants?: Variant[];
  /** True khi đang fetch variants (cache miss). Hiện skeleton thay vì empty. */
  variantsLoading?: boolean;
  toppings?: Topping[];
  onConfirm: (payload: FnbItemConfirmPayload) => void;
  /**
   * Phase 1A.2: nếu set → mở dialog ở chế độ "Sửa" với giá trị pre-fill.
   * Undefined → chế độ thêm mới (defaults).
   */
  initialSelection?: FnbItemInitialSelection;
  /** Phase 1A.2: nhãn nút confirm. Default "Thêm vào đơn". */
  confirmLabel?: string;
  /**
   * CEO 01/06/2026 — Sprint 2.2e: dynamic modifier groups + options.
   * Nếu có → ẩn hardcoded sweetness/ice, render dynamic.
   * Nếu không → giữ hardcoded fallback.
   */
  dynamicModifiers?: DynamicModifierData;
  /**
   * 06/08/2026: gọi khi cashier bấm "Thử lại" lúc tải tuỳ chọn hỏng.
   * Bắt buộc có để nút Thử lại hiện — không có thì chỉ báo lỗi.
   */
  onRetryModifiers?: () => void | Promise<void>;
}

// ── Component ──

// R7: Modifier preset cho cà phê — sweetness + ice level. Build vào note
// để bếp đọc nhanh thay vì khách "viết tay". Mặc định "Bình thường" cho cả 2.
const SWEETNESS_OPTIONS = ["Không đường", "30%", "50%", "70%", "100%"] as const;
const ICE_OPTIONS = ["Không đá", "Ít đá", "Vừa đá", "Nhiều đá"] as const;

/**
 * Quy cách thật (`product_variants`) là nguồn duy nhất cho cỡ, giá và BOM.
 * Nhóm modifier `Size` là cấu hình cũ; nếu render cả hai, thu ngân có thể
 * chọn Size M ở quy cách nhưng Size L ở modifier, tạo một dòng bán mâu thuẫn.
 */
function isLegacySizeModifierGroup(group: ModifierGroup): boolean {
  return group.name.trim().toLocaleLowerCase("vi") === "size";
}

/**
 * 07/08 (CEO chốt) — VÙNG CHẠM CĂN THEO LOẠI CON TRỎ, KHÔNG THEO BỀ RỘNG.
 *
 * Bề rộng màn KHÔNG cho biết có phải thiết bị chạm hay không. Máy tính bảng
 * nằm ngang là 1024px — căn theo bề rộng thì nó bị xếp vào "desktop" và nhận
 * nút 36px, đúng cái thiết bị cần 44px nhất. Mà quán mình máy tính bảng là
 * thiết bị chính.
 *
 * `pointer-coarse` = trình duyệt tự khai báo đang dùng NGÓN TAY → 44px.
 * Còn lại (chuột) → 36px cho gọn. Thuần CSS, không đo bằng JS nên xoay máy
 * không remount, lựa chọn không mất.
 */
const CHIP = "min-h-9 pointer-coarse:min-h-11 px-3.5 py-1.5 rounded-full border " +
  "text-[13px] font-medium transition-colors";

/**
 * 07/08 — Ô của MỘT nhóm ngắn trong khu lựa chọn chính.
 *
 * Vì sao KHÔNG dùng lưới chia đều: đo trên bản xem trước thấy "Mức đường"
 * (5 lựa chọn) bị ép trong ô 318px nên "100%" rớt xuống dòng hai, trong khi
 * ô thứ ba bên phải bỏ trống. Chia đều 3 cột chỉ là bản khác của đúng lỗi
 * "chỗ thừa chỗ chật".
 *
 * `flex-auto` = bề rộng khởi điểm bằng ĐÚNG nội dung, rồi mới chia phần dư.
 * Nhóm 5 lựa chọn tự rộng hơn nhóm 4 lựa chọn; hết chỗ thì tự xuống dòng.
 * Điện thoại (dưới sm) thì mỗi nhóm một dòng.
 */
const O_NHOM = "min-w-0 w-full sm:w-auto sm:flex-auto sm:min-w-[15rem] space-y-1.5";
const NUT_TRON = "size-9 pointer-coarse:size-11 shrink-0 rounded-full border border-border " +
  "flex items-center justify-center text-muted-foreground " +
  "hover:bg-surface-container-high hover:text-foreground transition-colors";

/**
 * Phase 1A.2: parse composed note ngược lại sweetness/ice/free.
 * Format khi confirm: `${ice}, ${sweet} đường — ${free}` (mỗi phần optional).
 * Nếu không match modifier nào → trả nguyên note làm free-text.
 */
function parseStoredNote(note: string): { ice: string; sweet: string; free: string } {
  if (!note) return { ice: "", sweet: "", free: "" };
  const dashIdx = note.indexOf(" — ");
  const modPart = dashIdx >= 0 ? note.slice(0, dashIdx) : note;
  const freePart = dashIdx >= 0 ? note.slice(dashIdx + 3).trim() : "";

  let ice = "";
  let sweet = "";
  const remaining: string[] = [];
  const tokens = modPart.split(",").map((s) => s.trim()).filter(Boolean);
  for (const tok of tokens) {
    if ((ICE_OPTIONS as readonly string[]).includes(tok)) {
      ice = tok;
    } else if (tok.endsWith(" đường")) {
      const sw = tok.slice(0, -" đường".length).trim();
      if ((SWEETNESS_OPTIONS as readonly string[]).includes(sw)) {
        sweet = sw;
      } else {
        remaining.push(tok);
      }
    } else {
      remaining.push(tok);
    }
  }
  // Không nhận diện được modifier nào → coi toàn bộ là free-text.
  if (!ice && !sweet) {
    return { ice: "", sweet: "", free: note };
  }
  const free = [remaining.join(", "), freePart].filter(Boolean).join(" — ");
  return { ice, sweet, free };
}

/**
 * 06/08/2026 — PR-B: nhãn của một nhóm tuỳ chọn, BA trạng thái rõ ràng
 * (CEO chốt): còn thiếu (bắt buộc mà chưa chọn) · đã chọn (hiện luôn lựa
 * chọn hiện tại) · chưa chọn (nhóm không bắt buộc).
 *
 * Tên nhóm dài thì XUỐNG DÒNG, không cắt. Trên điện thoại nhóm thu gọn
 * được nhưng nhãn vẫn phải nói đang chọn gì — nếu không, thu gọn xong là
 * mất dấu vết.
 */
function NhanNhomTuyChon({
  ten,
  nhanQuyTac,
  thongBaoThieu,
  conThieu,
  daChonNhan,
  thuGonDuoc,
  dangThuGon,
  onToggleThuGon,
}: {
  ten: string;
  nhanQuyTac: string;
  thongBaoThieu?: string;
  conThieu: boolean;
  daChonNhan: string;
  thuGonDuoc: boolean;
  dangThuGon: boolean;
  onToggleThuGon: () => void;
}) {
  const noiDung = (
    <>
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium break-words">{ten}</span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-normal whitespace-nowrap",
            conThieu
              ? "bg-status-error/15 text-status-error font-medium"
              : "bg-surface-container-high text-muted-foreground",
          )}
        >
          {conThieu ? (thongBaoThieu ?? "Chưa chọn — bắt buộc") : nhanQuyTac}
        </span>
      </span>
      {/* Đã chọn gì — luôn hiện, kể cả khi nhóm đang thu gọn. */}
      {daChonNhan && (
        <span className="block text-xs text-muted-foreground break-words">
          Đang chọn: <span className="text-foreground">{daChonNhan}</span>
        </span>
      )}
    </>
  );

  if (!thuGonDuoc) {
    return <div className="space-y-1">{noiDung}</div>;
  }
  return (
    <button
      type="button"
      onClick={onToggleThuGon}
      aria-expanded={!dangThuGon}
      className="flex min-h-11 w-full items-start justify-between gap-2 text-left"
    >
      <span className="min-w-0 space-y-1">{noiDung}</span>
      <Icon
        name={dangThuGon ? "expand_more" : "expand_less"}
        size={18}
        className="mt-0.5 shrink-0 text-muted-foreground"
      />
    </button>
  );
}

export function FnbItemDialog({
  open, onOpenChange, product, variants, variantsLoading, toppings, onConfirm,
  initialSelection, confirmLabel, dynamicModifiers, onRetryModifiers,
}: FnbItemDialogProps) {
  const [selectedVariant, setSelectedVariant] = useState<Variant | null>(null);
  const [quantity, setQuantity] = useState(1);
  // R6: Topping qty stepper — Map<id, qty> thay vì Set<id> chỉ check/uncheck.
  // Khách quen "thêm 2 trân châu" giờ tap stepper +/- thay vì add 2 line riêng.
  const [toppingQtys, setToppingQtys] = useState<Map<string, number>>(new Map());
  const [note, setNote] = useState("");
  // R7: Modifier preset (sweetness + ice). Empty = không nói gì (mặc định pha bình thường).
  const [sweetness, setSweetness] = useState<string>("");
  const [iceLevel, setIceLevel] = useState<string>("");

  // CEO 01/06/2026 — Sprint 2.2e: Dynamic modifier choices.
  // Map<groupId, Set<optionId>> — multi rule cho nhiều options, single rule
  // sẽ tự kiểm tra trước khi add (clear set rồi add option mới).
  const [dynamicChoices, setDynamicChoices] = useState<Map<string, Set<string>>>(
    new Map(),
  );

  const coQuyCach = (variants?.length ?? 0) > 0;
  const effectiveModifierGroups = useMemo(
    () =>
      (dynamicModifiers?.groups ?? []).filter(
        (group) => !coQuyCach || !isLegacySizeModifierGroup(group),
      ),
    [coQuyCach, dynamicModifiers],
  );
  const hasDynamicModifiers = effectiveModifierGroups.length > 0;
  // Có cấu hình động nhưng toàn bộ chỉ là nhóm Size cũ thì cũng không được
  // rơi về bộ Đường/Đá hardcoded. Cấu hình động đã là nguồn dữ liệu của món.
  const hasConfiguredDynamicModifiers =
    (dynamicModifiers?.groups.length ?? 0) > 0;

  // 06/08 — 3 trạng thái tải tuỳ chọn. `undefined` = đang tải (tầng cha
  // chưa set); `failed` = tải hỏng. Cả hai đều KHÔNG cho xác nhận: lúc đó
  // chưa biết món có phải hỏi Đường/Đá/Topping hay không, thêm vào giỏ là
  // liều (bếp pha sai + không thu tiền topping).
  const modifiersLoading = dynamicModifiers === undefined;
  const modifiersFailed = dynamicModifiers?.failed === true;

  // Khoá bấm đúp HAI LỚP (CEO chốt): ref khoá TỨC THÌ trong cùng nhịp bấm,
  // state chỉ để hiện trạng thái. `setState` không đổi giá trị ngay nên chỉ
  // dựa vào state thì 2 cú bấm liền vẫn lọt cả hai.
  const submitLockRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  // 06/08 — PR-B: nhóm nào đang thu gọn. Nội dung nhóm thu gọn vẫn NẰM
  // NGUYÊN trong cây React (chỉ ẩn bằng CSS) nên lựa chọn không mất; đây
  // cũng là lý do KHÔNG đo bề rộng bằng JS rồi render nhánh khác nhau —
  // mỗi lần xoay máy là mất sạch lựa chọn.
  const [nhomThuGon, setNhomThuGon] = useState<Set<string>>(new Set());
  const toggleThuGon = useCallback((groupId: string) => {
    setNhomThuGon((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  /**
   * CEO 16/08/2026 (mục C) — KHOÁ NỘI DUNG của bộ tuỳ chọn.
   *
   * Trước đây effect khởi tạo bên dưới để thẳng `dynamicModifiers` trong danh
   * sách phụ thuộc. Nhưng `pos/fnb/page.tsx` dựng prop đó bằng object literal
   * MỚI mỗi lần render, nên POS render lại vì bất cứ lý do gì (đồng hồ, trạng
   * thái kết nối, hàng đợi đồng bộ, realtime bàn) là toàn bộ Size / đường /
   * đá / topping / ghi chú người bán vừa chọn bị xoá sạch giữa lúc bán.
   *
   * Khoá này chỉ đổi khi DANH SÁCH nhóm / lựa chọn thật sự khác, nên khởi tạo
   * vẫn chạy đúng lúc cần (mở popup, đổi món, tuỳ chọn tải xong) mà không
   * chạy oan khi cha chỉ dựng lại object y hệt.
   */
  const khoaTuyChon = useMemo(() => {
    if (!dynamicModifiers) return "chua-co";
    const phanNhom = effectiveModifierGroups
      .map((g) => {
        const opts = dynamicModifiers.optionsByGroup.get(g.id) ?? [];
        return `${g.id}:${opts.map((o) => o.id).join("+")}`;
      })
      .join("|");
    return `${dynamicModifiers.failed ? "loi" : "ok"}#${phanNhom}`;
  }, [dynamicModifiers, effectiveModifierGroups]);

  useEffect(() => {
    if (open) {
      // Phase 1A.2: pre-fill từ initialSelection (chế độ Sửa). Nếu undefined
      // thì rơi về defaults (chế độ thêm mới — y nguyên hành vi cũ).
      let initVariant: Variant | null = null;
      if (initialSelection?.variantId) {
        initVariant = variants?.find((v) => v.id === initialSelection.variantId) ?? null;
      }
      // Guard Size: chọn đúng quy cách được đánh dấu mặc định. Trước đây lấy
      // phần tử đầu danh sách — sai khi thứ tự đổi, và mặc định M không được
      // tôn trọng. Không có cái nào đánh dấu thì để TRỐNG, buộc người bán chọn.
      if (!initVariant) {
        initVariant = variants?.find((v) => v.is_default) ?? null;
      }
      setSelectedVariant(initVariant);

      setQuantity(Math.max(1, initialSelection?.quantity ?? 1));

      if (initialSelection?.toppings && initialSelection.toppings.length > 0) {
        const m = new Map<string, number>();
        for (const t of initialSelection.toppings) {
          if (t.quantity > 0) m.set(t.id, Math.min(t.quantity, 10));
        }
        setToppingQtys(m);
      } else {
        setToppingQtys(new Map());
      }

      const parsed = parseStoredNote(initialSelection?.note ?? "");
      setNote(parsed.free);
      setSweetness(parsed.sweet);
      setIceLevel(parsed.ice);

      // CEO 01/06/2026 — Sprint 2.2e + 2.3a: reset dynamic choices.
      // Ưu tiên prefill từ initialSelection.modifierSelections (chế độ Sửa),
      // fallback default options của mỗi group (chế độ Thêm mới).
      if (dynamicModifiers && effectiveModifierGroups.length > 0) {
        const initChoices = new Map<string, Set<string>>();
        const savedByGroup = new Map<string, Set<string>>();
        if (initialSelection?.modifierSelections) {
          for (const sel of initialSelection.modifierSelections) {
            savedByGroup.set(
              sel.groupId,
              new Set(sel.options.map((o) => o.optionId)),
            );
          }
        }
        /**
         * 07/08 — TỰ VỆ khi dữ liệu nhóm "Chọn 1" có NHIỀU mặc định.
         *
         * Thấy tận mắt trên bản xem trước: nhóm "Mức đường — Chọn 1" sáng
         * cùng lúc "Không đường" VÀ "100%". Đây là lỗi cấu hình dữ liệu (CEO
         * đã biết), nhưng KHÔNG được để nó thành lỗi tiền: mỗi lựa chọn có
         * phụ thu riêng, giữ cả hai là cộng phụ thu HAI LẦN cho một nhóm chỉ
         * được chọn một.
         *
         * `toggleDynamicChoice` đã ép chọn-một khi NGƯỜI DÙNG bấm; chỗ này
         * ép nốt lúc NẠP. Giữ theo thứ tự hiển thị để đoán được: cái đứng
         * trước thắng. Nhóm chọn-nhiều giữ nguyên.
         */
        const epChonMot = (g: ModifierGroup, ids: Set<string>) => {
          if (g.rule === "multi" || ids.size <= 1) return ids;
          const opts = dynamicModifiers.optionsByGroup.get(g.id) ?? [];
          const dau = opts.find((o) => ids.has(o.id));
          return new Set(dau ? [dau.id] : []);
        };
        for (const g of effectiveModifierGroups) {
          const saved = savedByGroup.get(g.id);
          if (saved && saved.size > 0) {
            initChoices.set(g.id, epChonMot(g, saved));
            continue;
          }
          // No saved → use defaults (only for "add new" mode)
          if (!initialSelection?.modifierSelections) {
            const opts = dynamicModifiers.optionsByGroup.get(g.id) ?? [];
            const defaults = opts.filter((o) => o.isDefault).map((o) => o.id);
            if (defaults.length > 0) {
              initChoices.set(g.id, epChonMot(g, new Set(defaults)));
            }
          }
        }
        setDynamicChoices(initChoices);
      } else {
        setDynamicChoices(new Map());
      }
      // Mở lại popup thì mọi nhóm đều bung — không để nhân viên mở món sau
      // mà nhóm vẫn thu gọn theo món trước.
      setNhomThuGon(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- xem khoaTuyChon
  }, [open, variants, initialSelection, khoaTuyChon]);

  // CEO 01/06/2026 — Sprint 2.2e: toggle 1 option theo rule của group.
  function toggleDynamicChoice(
    group: ModifierGroup,
    optionId: string,
  ) {
    setDynamicChoices((prev) => {
      const next = new Map(prev);
      const current = new Set(next.get(group.id) ?? []);
      if (current.has(optionId)) {
        // Click lại → toggle off (trừ khi single_required + đang chỉ có 1)
        if (group.rule === "single_required" && current.size === 1) {
          return prev; // không cho bỏ chọn nếu bắt buộc
        }
        current.delete(optionId);
      } else {
        if (
          group.rule === "multi" &&
          group.maxSelect !== null &&
          current.size >= group.maxSelect
        ) {
          return prev;
        }
        // Single rule → clear hết, add 1 cái mới
        if (group.rule === "single" || group.rule === "single_required") {
          current.clear();
        }
        current.add(optionId);
      }
      if (current.size === 0) next.delete(group.id);
      else next.set(group.id, current);
      return next;
    });
  }

  const setToppingQty = useCallback((id: string, qty: number) => {
    setToppingQtys((prev) => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(id);
      else next.set(id, Math.min(qty, 10)); // cap 10/topping/line tránh nhập sai
      return next;
    });
  }, []);

  const unitPrice = selectedVariant?.sell_price ?? product?.sell_price ?? 0;
  const toppingTotal = useMemo(() => {
    if (!toppings) return 0;
    return toppings.reduce((s, t) => {
      const q = toppingQtys.get(t.id) ?? 0;
      return s + t.price * q;
    }, 0);
  }, [toppings, toppingQtys]);

  // CEO 01/06/2026 — Sprint 2.2e: cộng dồn phí từ dynamic modifier options.
  // Vd Trân châu +7k, Size L +5k được include vào unit price.
  const dynamicModifierExtra = useMemo(() => {
    if (!dynamicModifiers) return 0;
    let total = 0;
    for (const [groupId, optionIds] of dynamicChoices.entries()) {
      const opts = dynamicModifiers.optionsByGroup.get(groupId) ?? [];
      for (const optId of optionIds) {
        const opt = opts.find((o) => o.id === optId);
        if (opt) total += opt.priceDelta;
      }
    }
    return total;
  }, [dynamicChoices, dynamicModifiers]);

  const lineTotal = (unitPrice + toppingTotal + dynamicModifierExtra) * quantity;

  // CEO 11/06/2026 (P0-9 audit): validate single_required khi confirm.
  // Trước đây quán đặt "Mức đường - bắt buộc 1" mà cashier không pick →
  // snapshot rỗng → bếp pha mặc định → khách phàn nàn "không đúng mức yêu cầu".
  const invalidModifierGroupIds = useMemo(() => {
    if (!hasDynamicModifiers || !dynamicModifiers) return new Set<string>();
    const missing = new Set<string>();
    for (const g of effectiveModifierGroups) {
      // Group có options? (nếu group rỗng coi như N/A)
      const opts = dynamicModifiers.optionsByGroup.get(g.id) ?? [];
      if (opts.length === 0) continue;
      const choices = dynamicChoices.get(g.id);
      const selectedCount = choices?.size ?? 0;
      if (g.rule === "single_required" && selectedCount === 0) missing.add(g.id);
      if (
        g.rule === "multi" &&
        (selectedCount < g.minSelect ||
          (g.maxSelect !== null && selectedCount > g.maxSelect))
      ) {
        missing.add(g.id);
      }
    }
    return missing;
  }, [hasDynamicModifiers, dynamicModifiers, dynamicChoices, effectiveModifierGroups]);

  /** Giữ đúng thứ tự liên kết do người quản lý đặt. */
  const nhomDaSapXep = useMemo(() => {
    if (!dynamicModifiers) return [] as ModifierGroup[];
    const soLuaChon = (g: ModifierGroup) =>
      dynamicModifiers.optionsByGroup.get(g.id)?.length ?? 0;
    return [...effectiveModifierGroups]
      .filter((g) => soLuaChon(g) > 0)
      .sort(
        (a, b) =>
          (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
          a.name.localeCompare(b.name, "vi"),
      );
  }, [dynamicModifiers, effectiveModifierGroups]);

  // 06/08: thêm 2 điều kiện — chưa tải xong hoặc tải hỏng thì KHÔNG cho
  // xác nhận (không biết món có tuỳ chọn hay không thì đừng đoán).
  // Guard Size (3 tầng — tầng giao diện):
  //  · món có quy cách đang bật thì BẮT BUỘC chọn cỡ, không mặc định bừa;
  //  · giá của dòng phải > 0 — bán 0đ do quên nhập giá là mất tiền thật.
  const thieuQuyCach = coQuyCach && !selectedVariant;
  const giaKhongHopLe = !variantsLoading && !thieuQuyCach && unitPrice <= 0;

  const canConfirm =
    invalidModifierGroupIds.size === 0 && !modifiersLoading && !modifiersFailed
    && !thieuQuyCach && !giaKhongHopLe;

  const lyDoChan = thieuQuyCach
    ? "Vui lòng chọn cỡ trước khi thêm món."
    : giaKhongHopLe
      ? "Món này chưa có giá bán. Báo quản lý nhập giá rồi bán lại."
      : null;

  const handleConfirm = () => {
    // Lớp 1 — khoá tức thì: chặn cú bấm thứ 2 trong CÙNG nhịp render.
    if (submitLockRef.current) return;
    if (!product) return;
    if (!canConfirm) return; // P0-9 guard + chưa sẵn sàng tuỳ chọn
    submitLockRef.current = true;
    setSubmitting(true); // Lớp 2 — chỉ để hiện trạng thái cho người dùng
    const cartToppings: FnbCartTopping[] = (toppings ?? [])
      .filter((t) => (toppingQtys.get(t.id) ?? 0) > 0)
      .map((t) => ({
        productId: t.id,
        name: t.name,
        quantity: toppingQtys.get(t.id) ?? 1,
        price: t.price,
      }));

    // Build composite note: modifier presets + free-text. Bếp đọc 1 dòng:
    // vd "Ít đá, 70% đường — không cay nhé"
    const modifierTags: string[] = [];

    // CEO 01/06/2026 — Sprint 2.2e: dynamic choices ghi đè hardcoded sweetness/ice.
    if (hasDynamicModifiers && dynamicModifiers) {
      for (const g of effectiveModifierGroups) {
        const choices = dynamicChoices.get(g.id);
        if (!choices || choices.size === 0) continue;
        const opts = dynamicModifiers.optionsByGroup.get(g.id) ?? [];
        const labels = opts
          .filter((o) => choices.has(o.id))
          .map((o) => o.label);
        if (labels.length > 0) {
          modifierTags.push(`${g.name}: ${labels.join("/")}`);
        }
      }
    } else {
      // Backward compat: hardcoded R7
      if (iceLevel) modifierTags.push(iceLevel);
      if (sweetness) modifierTags.push(sweetness + " đường");
    }

    const trimmedNote = note.trim();
    const composedNote = [
      modifierTags.join(", "),
      trimmedNote,
    ]
      .filter(Boolean)
      .join(" — ");

    // CEO 01/06/2026 — Sprint 2.3a: build modifierSelections snapshot từ
    // dynamicChoices. RPC checkout (Sprint 2.3b) sẽ đọc snapshot này để
    // scale BOM ingredient + trừ tồn topping NVL.
    let modifierSelections: ModifierSelectionPayload[] | undefined;
    if (hasDynamicModifiers && dynamicModifiers) {
      const payload: ModifierSelectionPayload[] = [];
      for (const g of effectiveModifierGroups) {
        const choices = dynamicChoices.get(g.id);
        if (!choices || choices.size === 0) continue;
        const opts = dynamicModifiers.optionsByGroup.get(g.id) ?? [];
        const selectedOpts = opts.filter((o) => choices.has(o.id));
        if (selectedOpts.length === 0) continue;
        payload.push({
          groupId: g.id,
          groupName: g.name,
          rule: g.rule,
          options: selectedOpts.map((o) => ({
            optionId: o.id,
            label: o.label,
            scaleFactor: o.scaleFactor,
            priceDelta: o.priceDelta,
            linkedProductId: o.linkedProductId,
          })),
        });
      }
      if (payload.length > 0) modifierSelections = payload;
    }

    onConfirm({
      productId: product.id, productName: product.name,
      variantId: selectedVariant?.id, variantLabel: selectedVariant?.label,
      quantity,
      // Sprint 2.2e: unit price include dynamic modifier extras để cashier
      // thấy đúng giá đã chọn (vd Trân châu +7k).
      unitPrice: unitPrice + dynamicModifierExtra,
      toppings: cartToppings,
      modifierSelections,
      note: composedNote || undefined,
    });
    onOpenChange(false);
    // ⚠️ TUYỆT ĐỐI KHÔNG nhả khoá ở đây. Bản đầu em nhả ngay sau
    // onOpenChange và test bắt được: cú bấm thứ 2 trong cùng nhịp vẫn lọt
    // (React chưa kịp unmount/đóng dialog). Khoá chỉ được nhả khi dialog
    // MỞ LẠI — xem effect bên dưới.
  };

  // Nhả khoá khi dialog mở (lần sau, hoặc đổi sang món khác). Bao gồm cả
  // trường hợp đóng bằng Esc/X mà không confirm.
  useEffect(() => {
    if (open) {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }, [open, product?.id]);

  /**
   * Vẽ MỘT nhóm tuỳ chọn. Tách ra hàm để nhóm ngắn (khu trên) và nhóm dài
   * (khu dưới) dùng CHUNG một cách vẽ — không có bản sao thứ hai để lệch.
   */
  function veNhom(g: ModifierGroup) {
    const opts = dynamicModifiers?.optionsByGroup.get(g.id) ?? [];
    if (opts.length === 0) return null;
    const choices = dynamicChoices.get(g.id) ?? new Set<string>();
    const ruleLabel =
      g.rule === "single_required"
        ? "Bắt buộc chọn 1"
        : g.rule === "single"
          ? "Chọn 1"
          : g.minSelect > 0 && g.maxSelect !== null
            ? `Chọn từ ${g.minSelect} đến ${g.maxSelect}`
            : g.minSelect > 0
              ? `Chọn ít nhất ${g.minSelect}`
              : g.maxSelect !== null
                ? `Chọn tối đa ${g.maxSelect}`
                : "Chọn nhiều";
    // BA trạng thái (CEO chốt): còn thiếu · đã chọn · chưa chọn.
    const conThieu = invalidModifierGroupIds.has(g.id);
    const daChonNhan = opts
      .filter((o) => choices.has(o.id))
      .map((o) => o.label)
      .join(", ");
    // Nhóm bắt buộc mà chưa chọn thì KHÔNG cho thu gọn — giấu đúng cái đang
    // thiếu là cách chắc chắn nhất để bỏ sót.
    const dangThuGon = nhomThuGon.has(g.id) && !conThieu;
    return (
      <section
        key={g.id}
        className={cn(
          O_NHOM,
          g.rule === "multi" && "basis-full",
          conThieu &&
            "rounded-lg border border-status-error/40 bg-status-error/5 p-2.5",
        )}
      >
        <NhanNhomTuyChon
          ten={g.name}
          nhanQuyTac={ruleLabel}
          thongBaoThieu={g.rule === "multi" ? `${ruleLabel} — chưa đủ` : undefined}
          conThieu={conThieu}
          daChonNhan={daChonNhan}
          thuGonDuoc={!conThieu}
          dangThuGon={dangThuGon}
          onToggleThuGon={() => toggleThuGon(g.id)}
        />
        {/* Ẩn bằng CSS, KHÔNG gỡ khỏi cây React — thu gọn rồi bung lại vẫn
            còn nguyên lựa chọn. */}
        <div className={cn("flex flex-wrap gap-2", dangThuGon && "hidden")}>
          {opts.map((o) => {
            const active = choices.has(o.id);
            const daDatToiDa =
              g.rule === "multi" &&
              g.maxSelect !== null &&
              choices.size >= g.maxSelect;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => toggleDynamicChoice(g, o.id)}
                aria-pressed={active}
                aria-disabled={!active && daDatToiDa}
                title={!active && daDatToiDa ? `Đã chọn tối đa ${g.maxSelect} mục` : undefined}
                className={cn(
                  CHIP,
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border hover:border-primary/40",
                )}
              >
                <span className="break-words">{o.label}</span>
                {o.priceDelta > 0 && (
                  <span
                    className={cn(
                      "ml-1 whitespace-nowrap tabular-nums",
                      active ? "" : "text-status-success",
                    )}
                  >
                    +{formatCurrency(o.priceDelta)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  if (!product) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* 06/08 (CEO duyệt plan vòng 4): cấu trúc 3 PHẦN — đầu cố định, THÂN
          là vùng cuộn duy nhất, chân (nút) cố định ngoài vùng cuộn. Trước đây
          dialog cao 1.103px trên màn 574px, không cuộn được, nút "Thêm vào
          đơn" nằm ở y=791 NGOÀI màn — thu ngân không bấm được.
          (cn dùng tailwind-merge nên `flex` thay `grid` của nền đúng cách.) */}
      {/* 06/08 PR-B — bề ngang theo thiết bị, KHÔNG phải bản desktop thu nhỏ:
          điện thoại 95vw · tablet dọc 42rem · tablet ngang 56rem · desktop
          68rem (1.088px, nằm trong khoảng 900–1.100 CEO chốt). Trần
          `max-w-[calc(100%-2rem)]` của nền vẫn giữ ở cỡ nhỏ. */}
      <DialogContent className="max-w-[95vw] sm:max-w-[42rem] lg:max-w-[56rem] xl:max-w-[68rem] max-h-[calc(100dvh-2rem)] overflow-hidden flex flex-col">
        {/* 07/08 (CEO chốt): ĐẦU POPUP GỘP — tên món · giá gốc · SỐ LƯỢNG ·
            tổng tạm tính, tất cả trong một khu gọn. Trước đây "Số lượng" là
            một khối riêng chiếm nguyên một cột rồi bỏ trống bên dưới, còn
            tổng tiền thì chỉ thấy ở nút dưới cùng. */}
        <DialogHeader className="shrink-0 gap-1.5">
          <DialogTitle className="text-[19px] leading-tight line-clamp-2">
            {product.name}
          </DialogTitle>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <DialogDescription className="text-[13px]">
              Giá gốc{" "}
              <span className="whitespace-nowrap tabular-nums text-foreground">
                {formatCurrency(product.sell_price)}đ
              </span>
            </DialogDescription>

            <div className="flex items-center gap-3">
              {/* Bộ số lượng — cùng hàng với tên + giá, không đứng riêng cột */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Bớt số lượng"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className={NUT_TRON}
                >
                  <Icon name="remove" size={18} />
                </button>
                <span className="w-8 text-center text-base font-semibold tabular-nums">
                  {formatNumber(quantity)}
                </span>
                <button
                  type="button"
                  aria-label="Thêm số lượng"
                  onClick={() => setQuantity((q) => q + 1)}
                  className={NUT_TRON}
                >
                  <Icon name="add" size={18} />
                </button>
              </div>

              <div className="text-right leading-tight">
                {/* CEO 08/08: chữ phụ không nhỏ hơn 12px (text-xs = 12px). */}
                <div className="text-xs text-muted-foreground">Tạm tính</div>
                <div className="text-base font-semibold whitespace-nowrap tabular-nums">
                  {formatCurrency(lineTotal)}đ
                </div>
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* 07/08 (CEO chốt) — THÂN CUỘN xếp theo NỘI DUNG, không chia đều cột.
            Trước đây mọi nhóm bị nhét vào lưới 3 cột bằng nhau: nhóm 2 lựa
            chọn và nhóm 5 dòng dài chiếm ô như nhau → chỗ thừa chỗ chật.
            Nay: khu lựa chọn NGẮN (Size/Đường/Đá) xếp lưới gọn ở trên, khu
            DÀI (Topping) chiếm TOÀN chiều ngang ở dưới.
            Đổi bố cục hoàn toàn bằng CSS → xoay máy không remount, lựa chọn
            còn nguyên. */}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-2 flex flex-col gap-4">
          {/* 06/08 — tải tuỳ chọn HỎNG: nói thật, không im lặng coi như món
              "không có tuỳ chọn". Nút xác nhận bị khoá cho tới khi tải lại
              được, vì thêm vào giỏ lúc này là bếp pha sai + mất tiền topping. */}
          {modifiersFailed && (
            <div className="rounded-lg border border-status-error/30 bg-status-error/10 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <Icon name="error" size={16} className="mt-0.5 shrink-0 text-status-error" />
                <div className="text-sm">
                  <div className="font-medium text-status-error">
                    Không tải được tuỳ chọn của món
                  </div>
                  <div className="text-muted-foreground">
                    Chưa biết món này có Đường/Đá/Topping hay không nên tạm khoá
                    nút thêm. Kiểm tra mạng rồi bấm Thử lại.
                  </div>
                </div>
              </div>
              {onRetryModifiers && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full min-h-11"
                  onClick={() => void onRetryModifiers()}
                >
                  <Icon name="refresh" size={16} /> Thử lại
                </Button>
              )}
            </div>
          )}
          {/* ══ KHU LỰA CHỌN CHÍNH — Size đầu tiên, rồi Đường/Đá ══
              Xếp hàng ngang tự xuống dòng, MỖI Ô RỘNG THEO NỘI DUNG (xem
              O_NHOM). Size luôn ở ô đầu, nhìn thấy ngay khi mở popup, KHÔNG
              phải cuộn. (Nhóm tuỳ chọn ngắn render tiếp ngay dưới, xem khối
              `nhomNgan`.) */}
          <div className="flex flex-wrap items-start gap-x-6 gap-y-3.5">
            {/* Size / Quy cách — POS-FIX-C3 giữ skeleton khi đang tải variants
                để không ai tưởng món không có size rồi thêm với giá gốc. */}
            {variantsLoading && (!variants || variants.length === 0) ? (
              <section className={O_NHOM}>
                <Label className="text-[13px] font-medium">Kích cỡ</Label>
                <div className="flex flex-wrap gap-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-9 w-20 rounded-full bg-muted animate-pulse" />
                  ))}
                </div>
              </section>
            ) : variants && variants.length > 0 ? (
              <section className={O_NHOM}>
                <Label className="text-[13px] font-medium">Kích cỡ</Label>
                <div className="flex flex-wrap gap-2">
                  {variants.map((v) => (
                    <button key={v.id} type="button" onClick={() => setSelectedVariant(v)}
                      className={cn(
                        CHIP, "active:scale-95",
                        selectedVariant?.id === v.id
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border hover:border-primary/50",
                      )}>
                      <span className="break-words">{v.label}</span>{" "}
                      {/* Tiền KHÔNG bao giờ được cắt bằng "…" */}
                      <span className="whitespace-nowrap tabular-nums">
                        {formatCurrency(v.sell_price)}đ
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {/* Mọi nhóm theo đúng thứ tự liên kết. Nhóm chọn nhiều
                tự chiếm trọn hàng nhưng không bị ép xuống cuối. */}
            {hasDynamicModifiers && nhomDaSapXep.map(veNhom)}

            {/* Khi CHƯA cấu hình nhóm tuỳ chọn: giữ Đường/Đá mặc định cũ để
                thu ngân không mất thao tác quen. */}
            {!hasConfiguredDynamicModifiers && (
              <>
                <section className={O_NHOM}>
                  <Label className="text-[13px] font-medium">Mức đường</Label>
                  <div className="flex flex-wrap gap-2">
                    {SWEETNESS_OPTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSweetness(sweetness === s ? "" : s)}
                        aria-pressed={sweetness === s}
                        className={cn(
                          CHIP,
                          sweetness === s
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border hover:border-primary/40",
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </section>

                <section className={O_NHOM}>
                  <Label className="text-[13px] font-medium">Mức đá</Label>
                  <div className="flex flex-wrap gap-2">
                    {ICE_OPTIONS.map((i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setIceLevel(iceLevel === i ? "" : i)}
                        aria-pressed={iceLevel === i}
                        className={cn(
                          CHIP,
                          iceLevel === i
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border hover:border-primary/40",
                        )}
                      >
                        {i}
                      </button>
                    ))}
                  </div>
                </section>
              </>
            )}
          </div>

          {/* ══ TOPPING — nhóm DÀI, chiếm TOÀN chiều ngang ══
              Mỗi dòng: tên + giá bên trái, bộ tăng/giảm bên phải.
              Từ 1280px chia 2 cột (ở 1024px mỗi cột chỉ ~400px, tên topping
              thật dài 30+ ký tự sẽ xuống 3 dòng → rối hơn 1 cột). */}
          {toppings && toppings.length > 0 && (
            <section className="min-w-0 space-y-1.5">
              <Label className="text-[13px] font-medium">Topping</Label>
              <div className="grid gap-2 xl:grid-cols-2 xl:gap-x-4">
                {toppings.map((t) => {
                  const qty = toppingQtys.get(t.id) ?? 0;
                  const active = qty > 0;
                  return (
                    <div
                      key={t.id}
                      className={cn(
                        "flex items-center justify-between rounded-lg border px-3 py-3 sm:py-2 text-sm transition-colors",
                        active ? "border-primary bg-primary/5" : "border-border",
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-foreground break-words">{t.name}</div>
                        <Badge variant="secondary" className="mt-0.5 whitespace-nowrap tabular-nums">
                          +{formatCurrency(t.price)}đ
                        </Badge>
                      </div>
                      {/* R6: Stepper +/- qty thay vì checkbox */}
                      <div className="flex items-center gap-0.5 bg-surface-container-lowest rounded-full p-0.5 border border-outline-variant/15 ml-2">
                        <button
                          type="button"
                          onClick={() => setToppingQty(t.id, qty - 1)}
                          disabled={qty === 0}
                          className="size-9 pointer-coarse:size-11 shrink-0 rounded-full flex items-center justify-center text-muted-foreground hover:bg-surface-container-high hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                          aria-label="Bớt topping"
                        >
                          <Icon name="remove" size={18} />
                        </button>
                        <span className="w-7 text-center text-sm font-semibold tabular-nums">
                          {formatNumber(qty)}
                        </span>
                        <button
                          type="button"
                          onClick={() => setToppingQty(t.id, qty + 1)}
                          className="size-9 pointer-coarse:size-11 shrink-0 rounded-full flex items-center justify-center text-primary hover:bg-primary-fixed"
                          aria-label="Thêm topping"
                        >
                          <Icon name="add" size={18} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Ghi chú tự do — trải hết bề ngang: chia cột cho ô nhập chữ chỉ
              làm khó gõ. */}
          <section className="min-w-0 space-y-1.5">
            <Label className="text-[13px] font-medium flex items-center gap-2">
              <Icon name="sticky_note_2" size={16} /> Ghi chú thêm
            </Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="VD: không cay, ấm nóng, ăn riêng..." rows={2}
              className="resize-none text-[13px]" />
          </section>
        </div>

        {/* Chân cố định — NGOÀI vùng cuộn (không sticky). */}
        <DialogFooter className="shrink-0">
          {/* 06/08: nhãn nói ĐÚNG lý do đang khoá — đang tải / tải hỏng /
              thiếu mục bắt buộc — thay vì luôn báo "thiếu mục bắt buộc". */}
          <Button
            // min-h-11 + whitespace-normal: nhãn có tiền dài (9 chữ số) thì
            // XUỐNG DÒNG, tuyệt đối không cắt bằng "…".
            className="w-full min-h-11 whitespace-normal"
            onClick={handleConfirm}
            disabled={!canConfirm || submitting}
            title={
              modifiersFailed
                ? "Chưa tải được tuỳ chọn — bấm Thử lại ở trên"
                : modifiersLoading
                  ? "Đang tải tuỳ chọn của món"
                  : lyDoChan
                    ? lyDoChan
                    : !canConfirm
                      ? "Vui lòng chọn các mục bắt buộc trước khi thêm"
                      : undefined
            }
          >
            {modifiersFailed
              ? "Chưa tải được tuỳ chọn"
              : modifiersLoading
                ? "Đang tải tuỳ chọn…"
                : invalidModifierGroupIds.size > 0
                  ? `Còn ${invalidModifierGroupIds.size} nhóm tuỳ chọn chưa hợp lệ`
                  : lyDoChan
                    ? lyDoChan
                    : `${confirmLabel ?? "Thêm vào đơn"} — ${formatCurrency(lineTotal)}đ`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
