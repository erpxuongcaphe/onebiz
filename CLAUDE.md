# CLAUDE.md - AI Assistant Guidelines for OneBiz ERP

## Project Overview

**OneBiz ERP** is a modern, mobile-first Enterprise Resource Planning system designed for small to medium-sized Vietnamese businesses. It's a multi-tenant SaaS application managing HR, Inventory, Sales, Finance, and POS operations.

**Tech Stack:** React 19, Next.js 14, TypeScript, Tailwind CSS, Supabase (PostgreSQL), Vite

## Quick Commands

```bash
# Development
npm run dev           # Start Vite dev server (port 3000)
npm run dev:main      # Vite dev (main mode)
npm run dev:pos       # Vite dev (POS mode, port 3001)

# Apps (Next.js)
cd apps/erp && npm run dev    # ERP app (port 3000)
cd apps/pos && npm run dev    # POS app (port 3001)

# Build & Deploy
npm run build         # Production build (4GB memory allocated)
npm run typecheck     # TypeScript type checking
npm run preview       # Preview production build

# ERP App specific
cd apps/erp && npm run lint   # ESLint
cd apps/erp && npm run clean  # Clear .next and node_modules
```

## Project Structure

```
onebiz/
├── apps/
│   ├── erp/                  # Main ERP (Next.js 14)
│   │   ├── app/              # App Router pages
│   │   ├── components/       # ERP-specific components
│   │   ├── contexts/         # Auth, Branch contexts
│   │   └── lib/              # API calls, utilities
│   └── pos/                  # POS app (Next.js 14)
├── components/               # Root Vite components
├── lib/                      # Root utilities & Supabase client
├── contexts/                 # Root context providers
├── supabase/                 # Database migrations (37 files)
├── docs/                     # Documentation
├── App.tsx                   # Vite app entry
└── types.ts                  # Shared type definitions
```

## Architecture Decisions

### Multi-App Structure
- **Root (Vite):** Legacy/demo interface, tab-based navigation
- **apps/erp (Next.js):** Full ERP with SSR, file-based routing
- **apps/pos (Next.js):** Dedicated POS terminal interface

### Database (Supabase PostgreSQL)
- **Multi-tenant isolation** via Row-Level Security (RLS)
- **Auto-generated types** in `lib/database.types.ts`
- All queries automatically filtered by `tenant_id`

### Authentication
- Supabase Auth with session persistence in localStorage
- Keys: `hrm_user`, `hrm_permissions`
- Granular RBAC with wildcard pattern matching (`hr.*`, `inventory.products.read`)

## Code Conventions

### API Pattern (Result Type)
```typescript
type Result<T> = { data: T; error: null } | { data: null; error: string };

// Always check session first
const { data: sessionData } = await supabase.auth.getSession();
if (!sessionData.session) return MOCK_PRODUCTS;

// Return mock data as fallback for offline/demo
```

### Function Naming
- `fetch*` - Read operations
- `create*` - Insert operations
- `update*` - Patch operations
- `archive/restore` - Soft deletion
- `delete*` - Hard deletion
- `on*` - Event handlers

### Component Patterns
```typescript
// Tab-based navigation with lazy loading
const Dashboard = React.lazy(() => import('./components/Dashboard'));

// Mobile-first responsive design
<nav className="lg:hidden fixed bottom-0">  {/* Mobile only */}
<aside className="hidden lg:flex">         {/* Desktop only */}
```

### Styling (Tailwind CSS)
- **High-density ERP design** - Use tight spacing: `p-1`, `p-1.5`, `p-2`
- **Font sizes:** `text-[10px]`, `text-xs` (12px), `text-sm` (14px)
- **Numbers:** Always use `tabular-nums` for currency/stats
- **Safe areas:** Use `pb-safe` for iPhone home indicator

### Color System
| Purpose | Light | Dark |
|---------|-------|------|
| Background | `bg-slate-50` | `bg-slate-950` |
| Cards | `bg-white` | `bg-slate-900` |
| Primary | `indigo-600` | `indigo-500` |
| Success | `emerald-600` | `emerald-500` |
| Warning | `amber-500` | `amber-400` |
| Danger | `rose-600` | `rose-500` |

## Critical Rules

### DO NOT
1. Use hamburger menu for mobile nav - use bottom navigation (`MobileNav.tsx`)
2. Forget safe area padding on fixed bottom elements
3. Use large padding (`p-4`, `p-6`) inside ERP cards - keep density high
4. Create files with English UI text - all user-facing text must be Vietnamese
5. Skip session checks in API functions
6. Forget RLS policies when adding new tables

### ALWAYS
1. Check `supabase.auth.getSession()` before database operations
2. Provide mock data fallbacks for offline/demo mode
3. Use Vietnamese for all error messages and UI text
4. Include `tenant_id` in new tables for multi-tenancy
5. Use path alias `@/*` for imports in apps
6. Test on mobile viewport - this is mobile-first

## Database Schema (Key Tables)

```sql
-- Core
tenants, users, roles, permissions, user_roles, departments

-- HR Module
hr_employees, hr_attendance, hr_leave_requests, hr_payroll

-- Inventory Module
inventory_products, inventory_categories, inventory_warehouses
inventory_stock, inventory_stock_movements

-- Sales Module
sales_customers, sales_orders, sales_order_items

-- Finance Module
finance_accounts, finance_transactions, finance_transaction_lines
```

## Environment Setup

Create `.env.local` from `.env.example`:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# For Vite (root app)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `@supabase/supabase-js` | Database & Auth |
| `lucide-react` | Icons (stroke-width 1.5-2) |
| `recharts` | Charts & visualizations |
| `framer-motion` | Animations |
| `sonner` | Toast notifications |
| `xlsx` | Excel export |
| `html2pdf.js`, `jspdf` | PDF generation |
| `qrcode.react`, `html5-qrcode` | QR codes |

## Testing

No test framework currently configured. When adding tests:
- Use Vitest (compatible with Vite)
- Focus on API functions in `lib/` first
- Mock Supabase client for unit tests

## Documentation References

- `ARCHITECTURE.md` - Comprehensive system design (77KB)
- `AI_CONTEXT.md` - Design rules and visual conventions
- `supabase/README.md` - Migration execution order

## Common Tasks

### Adding a New Page (ERP App)
1. Create page in `apps/erp/app/dashboard/[feature]/page.tsx`
2. Add navigation item in sidebar/mobile nav
3. Check permission in page component using `hasSpecificPermission()`

### Adding a New API Function
```typescript
// In lib/api/[module].ts
export async function fetchSomething(): Promise<Result<Something[]>> {
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return { data: MOCK_DATA, error: null };

  const { data, error } = await supabase
    .from('table_name')
    .select('*');

  if (error) return { data: null, error: formatError(error) };
  return { data, error: null };
}
```

### Adding a New Database Table
1. Create migration in `supabase/migrations/`
2. Follow naming: `YYYYMMDDHHMMSS_description.sql`
3. Include RLS policies with `tenant_id` filter
4. Regenerate types: `supabase gen types typescript`

## Error Messages (Vietnamese)

```typescript
// Common error mappings
'23505' -> 'Dữ liệu bị trùng (SKU/code đã tồn tại).'
'PGRST116' -> 'Không tìm thấy dữ liệu.'
default -> 'Đã xảy ra lỗi. Vui lòng thử lại.'
```

## Performance Notes

- Build uses `--max-old-space-size=4096` for large bundles
- Code splitting configured for: react, supabase, charts, icons
- Source maps disabled in production
- Lazy load heavy components with `React.lazy()`
