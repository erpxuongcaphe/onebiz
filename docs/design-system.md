# Design System — OneBiz ERP

> **Sprint VISUAL-1** (CEO 04/05/2026) — chuẩn hoá scale toàn web sau khi 40+ commit fix nhỏ tích lũy → web siêu vẹo.
>
> Preview live: `/mockup/design-system`

---

## ⚠️ Quy tắc tổng

**KHÔNG dùng giá trị custom ngoài scale**. Nếu muốn 13px / 11px / 10.5px → phải pick từ scale gần nhất:
- 11px / 13px → **12px** hoặc **14px**
- 10.5px / 12.5px → **12px** hoặc **14px**
- 18px (icon) → **16px** hoặc **20px**

ESLint warn (sẽ setup): `text-[Xpx]` arbitrary values → suggest scale tương đương.

---

## 1. Typography Scale (6 sizes)

| Class | Size | Use case |
|---|---|---|
| `text-[32px]` (display) | 32px / 2rem | Page hero titles |
| `text-2xl` | 24px | Section titles |
| `text-xl` | 20px | Subsection / card title lớn |
| `text-base` | 16px | Card title / important body |
| `text-sm` | 14px | Body text, table cell, button md |
| `text-xs` | 12px | Caption, label, hint, badge text |

**BỎ**:
- `text-[11px]`, `text-[10px]`, `text-[10.5px]` → dùng `text-xs` (12px)
- `text-[13px]`, `text-[12.5px]` → dùng `text-sm` (14px) hoặc `text-xs` (12px)
- `text-[15px]` → dùng `text-base` (16px) hoặc `text-sm` (14px)
- `text-[9px]`, `text-[8px]` → KHÔNG có nhu cầu, replace `text-xs` + `tracking-tighter` nếu cần

---

## 2. Spacing Scale (6 levels)

| Class | px | Use case |
|---|---|---|
| `1` (4px) | 4px | Tight (badge inner padding) |
| `2` (8px) | 8px | Cell padding, gap nhỏ |
| `3` (12px) | 12px | Input padding, gap form |
| `4` (16px) | 16px | Section gap, card padding |
| `6` (24px) | 24px | Page padding mobile |
| `8` (32px) | 32px | Large section gap, page padding desktop |

**BỎ**:
- `p-1.5`, `p-2.5`, `p-3.5` → pick `p-2` hoặc `p-3`
- `gap-1.5`, `gap-2.5` → pick `gap-2` hoặc `gap-3`
- `m-1.5`, `m-2.5` → tương tự

---

## 3. Icon Sizes (4 sizes)

| Size | Use case |
|---|---|
| **14** | Inline với text-xs/sm (button sm, table row) |
| **16** | Button md, action menu |
| **20** | Header icon, page action |
| **24** | Large action, empty state |

**BỎ**:
- `size={10}`, `{11}`, `{12}`, `{13}` → dùng `size={14}` (smallest)
- `size={18}` → dùng `size={16}` hoặc `size={20}`
- `size={22}` → dùng `size={20}` hoặc `size={24}`

---

## 4. Border Radius (5 scales)

| Class | px | Use case |
|---|---|---|
| `rounded` | 4px | Chip, badge nhỏ |
| `rounded-lg` | 8px | Input, button, card sm |
| `rounded-xl` | 12px | Card md |
| `rounded-2xl` | 16px | Card lg, dialog |
| `rounded-full` | full | Avatar, pill button, status dot |

**BỎ**:
- `rounded-md` (6px) → `rounded` (4px) hoặc `rounded-lg` (8px)
- `rounded-3xl` → `rounded-2xl`

---

## 5. Shadow Levels (4 levels)

| Class | Use case |
|---|---|
| (none) | Flat, no elevation |
| `shadow-sm` | Subtle (button hover, focus) |
| `shadow-md` | Card, dropdown |
| `shadow-lg` | Modal, dialog overlay |

**BỎ** custom shadow inline (`shadow-[X_Y_Z_color]`) — pick scale gần nhất.

---

## 6. Color Tokens

Project dùng **Stitch design tokens** (Material 3) trong `tokens.css`. KHÔNG hardcode hex hay dùng `bg-slate-*`, `bg-blue-*`.

### Primary
| Token | Use case |
|---|---|
| `bg-primary` / `text-on-primary` | Action chính (button primary, header POS) |
| `bg-primary-hover` | Hover state |
| `bg-primary-fixed` | Soft background (active tab, badge) |
| `text-primary` | Link, accent text |

### Surface (5 levels)
| Token | Use case |
|---|---|
| `bg-surface` | Base |
| `bg-surface-container-lowest` | Lowest level |
| `bg-surface-container-low` | Low (page bg) |
| `bg-surface-container` | Default container |
| `bg-surface-container-high` | Elevated card |
| `bg-surface-container-highest` | Highest (modal bg) |

### Status
| Token | Use case |
|---|---|
| `bg-status-success` / `text-status-success` | Success / completed |
| `bg-status-warning` / `text-status-warning` | Warning / processing |
| `bg-status-error` / `text-status-error` | Error / cancelled |
| `bg-status-info` | Info |

Soft variants: `bg-status-success/15`, `bg-status-warning/15`...

**BỎ**:
- `bg-slate-*`, `text-slate-*`, `border-slate-*` (hardcoded)
- `bg-blue-*`, `bg-red-*`, `bg-green-*` (hardcoded)
- `bg-[#hexvalue]` (custom hex)

---

## 7. Button Variants

### Sizes (4)
| Size | Class | Height | Use case |
|---|---|---|---|
| xs | `h-7 px-3 text-xs` | 28px | Inline trong table row, dense list |
| sm | `size="sm"` | 32px | Toolbar, secondary actions |
| md | (default) | 40px | Default form button |
| lg | `size="lg"` | 48px | CTA, payment, primary action lớn |

**BỎ**: h-9, h-11 (off-scale).

### Variants (4)
- `default` — Primary action
- `outline` — Secondary action
- `ghost` — Tertiary (icon button, menu item)
- `destructive` — Delete / cancel / danger

### Pattern
```tsx
<Button>
  <Icon name="add" size={16} className="mr-1" />
  Tạo mới
</Button>
```
Icon size phải **match button size**:
- xs → icon 14
- sm → icon 14
- md → icon 16
- lg → icon 20

---

## 8. Input Variants

### Sizes (2)
| Size | Class | Height |
|---|---|---|
| sm | `h-8` | 32px |
| md | (default) | 40px |

**BỎ**: h-9, h-11.

---

## 9. Card Variants

| Variant | Style |
|---|---|
| **flat** | `bg-surface-container-low` (no border, no shadow) |
| **elevated** | `bg-white shadow-md` |
| **outlined** | `bg-white border border-border` |

Padding standard: `p-4` (16px). Larger card: `p-6` (24px).
Border radius: `rounded-xl` (12px) cho card, `rounded-2xl` (16px) cho card lớn / dialog.

---

## 10. Pattern chuẩn hoá

### Page Header
```tsx
<div className="flex items-center justify-between gap-4 pb-3 border-b border-border">
  <div>
    <h2 className="text-2xl font-bold">{title}</h2>
    <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
  </div>
  <div className="flex items-center gap-2">
    <Button variant="outline" size="sm">...</Button>
    <Button>...</Button>
  </div>
</div>
```

### KPI Card
```tsx
<div className="bg-surface-container-low rounded-lg p-3">
  <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
  <div className="text-xl font-bold tabular-nums mt-1">{value}</div>
</div>
```

### Table Row
```tsx
<tr className="border-b border-border last:border-0 hover:bg-surface-container-low/50">
  <td className="px-4 py-3 font-mono text-sm">{code}</td>
  <td className="px-4 py-3">
    <div className="text-sm font-medium">{name}</div>
    <div className="text-xs text-muted-foreground">{subtitle}</div>
  </td>
  ...
</tr>
```

### Status Pill
```tsx
<span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-status-success/15 text-status-success">
  Hoàn thành
</span>
```

### Form Field
```tsx
<div>
  <label className="text-xs font-medium mb-1 block">{label}</label>
  <Input placeholder={placeholder} />
</div>
```

### Form Footer
```tsx
<div className="flex justify-end gap-2 pt-4 border-t border-border">
  <Button variant="outline">Huỷ</Button>
  <Button>Lưu</Button>
</div>
```

---

## Migration plan (Sprint VISUAL-1, ~3-5 ngày)

### Phase 1: Typography (Day 1)
- Grep tất cả `text-\[\d+`, `text-\[\d+\.\d+`
- Replace off-scale → scale standard
- Files affected: ~50 files

### Phase 2: Spacing (Day 1-2)
- Replace `p-1.5/2.5/3.5`, `gap-1.5/2.5` → scale chuẩn
- Replace inconsistent margins
- Files affected: ~80 files

### Phase 3: Icons (Day 2)
- Replace `size={10/11/12/13/18}` → 14/16/20
- Files affected: ~40 files

### Phase 4: Color tokens (Day 2-3)
- Replace `bg-slate-*`, `text-slate-*` → tokens
- Replace hardcoded hex
- Files affected: ~20 files (đã clean 1 phần)

### Phase 5: Border radius + shadow (Day 3)
- Replace `rounded-md` → `rounded-lg`
- Standardize shadow usage
- Files affected: ~30 files

### Phase 6: Button + Input variants (Day 4)
- Replace `h-9/11` → standardize
- Verify all `<Button>` use proper variant
- Files affected: ~40 files

### Phase 7: Verify (Day 5)
- `npx tsc --noEmit`: 0 errors
- `npx vitest run`: pass
- `npx next build`: pass
- Visual regression: screenshot key pages, compare

---

## Tools (sẽ setup)

- **ESLint plugin**: warn arbitrary `text-[X]`, `p-X.5`, `gap-X.5`
- **VS Code snippet**: pre-defined patterns cho common UI
- **Storybook hoặc /mockup/design-system**: live reference

---

> Last updated: 2026-05-05 — Sprint VISUAL-1
> Maintained by: dev team (theo standard này, không tự ý đổi)
