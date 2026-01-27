# KIẾN TRÚC HỆ THỐNG ERP MULTI-TENANT - ONEBIZ.COM.VN

## 📋 Mục Lục
1. [Tổng Quan Hệ Thống](#1-tổng-quan-hệ-thống)
2. [Kiến Trúc Multi-Domain](#2-kiến-trúc-multi-domain)
3. [Multi-Tenant Strategy](#3-multi-tenant-strategy)
4. [Database Schema Design](#4-database-schema-design)
5. [Authentication & Authorization](#5-authentication--authorization)
6. [API Design](#6-api-design)
7. [Real-time Data Sync](#7-real-time-data-sync)
8. [Deployment Strategy](#8-deployment-strategy)
9. [Cost Estimation](#9-cost-estimation)
10. [Migration Plan](#10-migration-plan)

---

## 1. Tổng Quan Hệ Thống

### 1.1 Mô Tả
Hệ thống ERP multi-tenant được thiết kế cho doanh nghiệp nhỏ tại Việt Nam, cho phép:
- **Multi-domain architecture**: Tách biệt modules theo subdomain
- **Multi-tenant deployment**: Mỗi khách hàng có thể deploy độc lập
- **Centralized reporting**: Tập trung dữ liệu từ subdomains về main domain
- **Single Sign-On**: Xác thực thống nhất giữa các domains

### 1.2 Tech Stack
```
Frontend:
├── Next.js 15 (App Router)
├── React 19
├── TypeScript
├── Tailwind CSS
└── Lucide Icons

Backend:
├── Next.js API Routes
├── Supabase (PostgreSQL + Auth + Storage + Realtime)
└── Row Level Security (RLS)

Infrastructure:
├── Vercel (Hosting)
├── Supabase (Database)
├── Cloudflare (CDN & DNS)
└── AWS S3/Supabase Storage (File storage)
```

### 1.3 System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    INTERNET (Cloudflare CDN)                     │
└──────────────┬──────────────┬──────────────┬────────────────────┘
               │              │              │
               ▼              ▼              ▼
       ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
       │   Main App   │ │   HR System  │ │  Inventory   │
       │onebiz.com.vn │ │ hr.onebiz... │ │inventory...  │
       └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
              │                │                 │
              │    ┌───────────┴─────────────┐   │
              │    │   Supabase Auth (SSO)   │   │
              │    └───────────┬─────────────┘   │
              │                │                 │
              └────────────────┼─────────────────┘
                               ▼
                    ┌────────────────────┐
                    │  Supabase Database │
                    │   (PostgreSQL)     │
                    │  + Row Level SEC   │
                    └────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │  Database Schema    │
                    ├─────────────────────┤
                    │ - tenants           │
                    │ - users             │
                    │ - roles             │
                    │ - permissions       │
                    │ - hr_*              │
                    │ - inventory_*       │
                    │ - sales_*           │
                    │ - finance_*         │
                    └─────────────────────┘
```

---

## 2. Kiến Trúc Multi-Domain

### 2.1 Domain Structure

```
onebiz.com.vn (Main Domain)
├── Dashboard (Tổng hợp KPI từ tất cả modules)
├── Báo cáo (Reports & Analytics)
├── Tài chính (Finance Management)
├── Bán hàng (Sales & Orders)
└── Cài đặt (Settings & Configuration)

hr.onebiz.com.vn (HR Subdomain)
├── Nhân viên (Employees)
├── Chấm công (Attendance)
├── Lương (Payroll)
└── Tuyển dụng (Recruitment)

inventory.onebiz.com.vn (Inventory Subdomain)
├── Sản phẩm (Products)
├── Kho (Warehouses)
├── Nhập/Xuất kho (Stock Movements)
└── Kiểm kê (Stock Taking)
```

### 2.2 Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Data Flow Pattern                        │
└─────────────────────────────────────────────────────────────┘

WRITE OPERATIONS (Direct to Database):
┌──────────────┐           ┌──────────────┐
│ HR Subdomain │──Write──▶ │   Database   │
└──────────────┘           └──────────────┘
                                  ▲
┌──────────────┐                  │
│Inv Subdomain │──────Write───────┘
└──────────────┘

READ OPERATIONS (Main Domain aggregates):
┌──────────────┐           ┌──────────────┐
│ Main Domain  │◀──Read────│   Database   │
└──────────────┘           │ (All tables) │
                           └──────────────┘

REAL-TIME SYNC (Supabase Realtime):
┌──────────────┐           ┌──────────────┐
│ HR Subdomain │◀─Listen───│  Realtime    │
└──────────────┘           │  Channel     │
                           └──────────────┘
┌──────────────┐                  ▲
│Inv Subdomain │◀─────Listen──────┘
└──────────────┘
┌──────────────┐                  ▲
│ Main Domain  │◀─────Listen──────┘
└──────────────┘
```

### 2.3 Next.js Multi-Domain Configuration

**File: `next.config.js`**
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Cho phép deploy trên multiple domains
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: process.env.ALLOWED_ORIGINS || '*',
          },
          {
            key: 'Access-Control-Allow-Credentials',
            value: 'true',
          },
        ],
      },
    ];
  },
  
  // Environment-based configuration
  env: {
    DOMAIN: process.env.DOMAIN,
    SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
};

module.exports = nextConfig;
```

**File: `.env.local` (Main Domain)**
```env
DOMAIN=onebiz.com.vn
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_MAIN_DOMAIN=https://onebiz.com.vn
NEXT_PUBLIC_HR_DOMAIN=https://hr.onebiz.com.vn
NEXT_PUBLIC_INVENTORY_DOMAIN=https://inventory.onebiz.com.vn
```

**File: `.env.local` (HR Subdomain)**
```env
DOMAIN=hr.onebiz.com.vn
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_MAIN_DOMAIN=https://onebiz.com.vn
```

---

## 3. Multi-Tenant Strategy

### 3.1 Tenant Isolation Model

**Chiến lược: Shared Database với Row Level Security (RLS)**

```
┌─────────────────────────────────────────────────┐
│           Multi-Tenant Architecture             │
├─────────────────────────────────────────────────┤
│                                                 │
│  Customer A (tenant_id: uuid-1)                 │
│  ├── Domain: customer-a.com                     │
│  └── Database: All tables filtered by RLS       │
│                                                 │
│  Customer B (tenant_id: uuid-2)                 │
│  ├── Domain: customer-b.com                     │
│  └── Database: All tables filtered by RLS       │
│                                                 │
│  OneBiz (tenant_id: uuid-default)               │
│  ├── Domain: onebiz.com.vn                      │
│  └── Database: All tables filtered by RLS       │
│                                                 │
└─────────────────────────────────────────────────┘
```

### 3.2 Tenant Configuration

**File: `lib/tenant/config.ts`**
```typescript
export interface TenantConfig {
  id: string;
  name: string;
  domain: string;
  subdomain: string;
  logo: string;
  primaryColor: string;
  features: {
    hr: boolean;
    inventory: boolean;
    finance: boolean;
    sales: boolean;
  };
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export const getTenantConfig = async (
  domain: string
): Promise<TenantConfig> => {
  // Trong production, query từ database
  // Trong development, dùng config file
  
  const configs: Record<string, TenantConfig> = {
    'onebiz.com.vn': {
      id: 'default-tenant',
      name: 'OneBiz ERP',
      domain: 'onebiz.com.vn',
      subdomain: '',
      logo: '/logo.svg',
      primaryColor: '#4F46E5', // Indigo
      features: {
        hr: true,
        inventory: true,
        finance: true,
        sales: true,
      },
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    },
    'hr.onebiz.com.vn': {
      id: 'default-tenant',
      name: 'OneBiz HR',
      domain: 'hr.onebiz.com.vn',
      subdomain: 'hr',
      logo: '/logo-hr.svg',
      primaryColor: '#4F46E5',
      features: {
        hr: true,
        inventory: false,
        finance: false,
        sales: false,
      },
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    },
    'inventory.onebiz.com.vn': {
      id: 'default-tenant',
      name: 'OneBiz Inventory',
      domain: 'inventory.onebiz.com.vn',
      subdomain: 'inventory',
      logo: '/logo-inventory.svg',
      primaryColor: '#059669', // Emerald
      features: {
        hr: false,
        inventory: true,
        finance: false,
        sales: false,
      },
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    },
  };

  return configs[domain] || configs['onebiz.com.vn'];
};
```

### 3.3 Tenant Context Provider

**File: `lib/tenant/TenantProvider.tsx`**
```typescript
'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { TenantConfig, getTenantConfig } from './config';

interface TenantContextValue {
  tenant: TenantConfig | null;
  loading: boolean;
}

const TenantContext = createContext<TenantContextValue>({
  tenant: null,
  loading: true,
});

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const [tenant, setTenant] = useState<TenantConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadTenant = async () => {
      const domain = window.location.hostname;
      const config = await getTenantConfig(domain);
      setTenant(config);
      setLoading(false);
    };

    loadTenant();
  }, []);

  return (
    <TenantContext.Provider value={{ tenant, loading }}>
      {children}
    </TenantContext.Provider>
  );
}

export const useTenant = () => useContext(TenantContext);
```

### 3.4 Deployment per Tenant

**Kịch bản 1: Customer muốn deploy trên domain riêng**

```bash
# 1. Fork repository hoặc clone
git clone https://github.com/onebiz/erp-system.git customer-erp

# 2. Tạo Supabase project riêng cho customer
# Chạy migration scripts để tạo database schema

# 3. Config environment variables
cat > .env.local << EOF
DOMAIN=customer-company.com
NEXT_PUBLIC_SUPABASE_URL=https://customer-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=customer-anon-key
NEXT_PUBLIC_TENANT_ID=customer-tenant-uuid
EOF

# 4. Deploy lên Vercel với custom domain
vercel --prod
vercel domains add customer-company.com
```

**Kịch bản 2: Customer dùng shared infrastructure**

```bash
# Customer chỉ cần:
# 1. Đăng ký tài khoản qua onebiz.com.vn
# 2. Chọn subdomain: customer.onebiz.com.vn
# 3. Hệ thống tự động:
#    - Tạo tenant_id trong database
#    - Configure DNS cho subdomain
#    - Apply RLS policies
```

---

## 4. Database Schema Design

### 4.1 Core Tables

**File: `supabase/migrations/001_core_schema.sql`**

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 1. TENANTS TABLE (Multi-tenant core)
-- ============================================
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  subdomain VARCHAR(100) UNIQUE,
  custom_domain VARCHAR(255) UNIQUE,
  logo_url TEXT,
  primary_color VARCHAR(7) DEFAULT '#4F46E5',
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'trial')),
  features JSONB DEFAULT '{"hr": true, "inventory": true, "finance": true, "sales": true}',
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS for tenants
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own tenant"
  ON tenants FOR SELECT
  USING (id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- ============================================
-- 2. USERS TABLE
-- ============================================
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL UNIQUE,
  full_name VARCHAR(255) NOT NULL,
  avatar_url TEXT,
  phone VARCHAR(20),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

-- RLS for users
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view users in their tenant"
  ON users FOR SELECT
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can update their own profile"
  ON users FOR UPDATE
  USING (id = auth.uid());

-- ============================================
-- 3. ROLES TABLE (RBAC)
-- ============================================
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  permissions JSONB DEFAULT '[]', -- Array of permission strings
  is_system BOOLEAN DEFAULT false, -- System roles cannot be deleted
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);

-- RLS for roles
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view roles in their tenant"
  ON roles FOR SELECT
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- Default system roles per tenant
INSERT INTO roles (tenant_id, name, description, permissions, is_system)
SELECT 
  t.id,
  role_data.name,
  role_data.description,
  role_data.permissions,
  true
FROM tenants t
CROSS JOIN (
  VALUES
    ('Super Admin', 'Full system access', '["*"]'),
    ('Admin', 'Administrative access', '["users.*", "roles.*", "settings.*"]'),
    ('Manager', 'Department manager', '["read.*", "write.own_department"]'),
    ('Employee', 'Basic employee access', '["read.own", "write.own"]')
) AS role_data(name, description, permissions);

-- ============================================
-- 4. USER_ROLES TABLE (Many-to-Many)
-- ============================================
CREATE TABLE user_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, role_id)
);

-- RLS for user_roles
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own roles"
  ON user_roles FOR SELECT
  USING (user_id = auth.uid());

-- ============================================
-- 5. DEPARTMENTS TABLE
-- ============================================
CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50),
  parent_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  manager_id UUID REFERENCES users(id) ON DELETE SET NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, code)
);

-- RLS for departments
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view departments in their tenant"
  ON departments FOR SELECT
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));
```

### 4.2 HR Module Tables

**File: `supabase/migrations/002_hr_schema.sql`**

```sql
-- ============================================
-- HR MODULE: EMPLOYEES
-- ============================================
CREATE TABLE hr_employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  employee_code VARCHAR(50) NOT NULL,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  position VARCHAR(255),
  employment_type VARCHAR(50) CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'intern')),
  join_date DATE NOT NULL,
  leave_date DATE,
  base_salary DECIMAL(15, 2),
  contract_file_url TEXT,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'on_leave', 'resigned', 'terminated')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, employee_code)
);

-- RLS for hr_employees
ALTER TABLE hr_employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view employees in their tenant"
  ON hr_employees FOR SELECT
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- ============================================
-- HR MODULE: ATTENDANCE
-- ============================================
CREATE TABLE hr_attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  check_in TIMESTAMPTZ,
  check_out TIMESTAMPTZ,
  work_hours DECIMAL(4, 2),
  status VARCHAR(20) CHECK (status IN ('present', 'absent', 'late', 'leave', 'remote')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, employee_id, date)
);

-- RLS for hr_attendance
ALTER TABLE hr_attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view their own attendance"
  ON hr_attendance FOR SELECT
  USING (
    tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
    AND (
      employee_id = (SELECT id FROM hr_employees WHERE user_id = auth.uid())
      OR EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid()
        AND r.permissions @> '["hr.attendance.read"]'
      )
    )
  );

-- ============================================
-- HR MODULE: LEAVE REQUESTS
-- ============================================
CREATE TABLE hr_leave_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  leave_type VARCHAR(50) CHECK (leave_type IN ('annual', 'sick', 'unpaid', 'maternity', 'paternity')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  total_days DECIMAL(3, 1) NOT NULL,
  reason TEXT,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS for hr_leave_requests
ALTER TABLE hr_leave_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can manage their own leave requests"
  ON hr_leave_requests FOR ALL
  USING (
    tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
    AND employee_id = (SELECT id FROM hr_employees WHERE user_id = auth.uid())
  );

-- ============================================
-- HR MODULE: PAYROLL
-- ============================================
CREATE TABLE hr_payroll (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  month DATE NOT NULL, -- First day of month
  base_salary DECIMAL(15, 2) NOT NULL,
  allowances DECIMAL(15, 2) DEFAULT 0,
  bonuses DECIMAL(15, 2) DEFAULT 0,
  deductions DECIMAL(15, 2) DEFAULT 0,
  insurance DECIMAL(15, 2) DEFAULT 0,
  tax DECIMAL(15, 2) DEFAULT 0,
  net_salary DECIMAL(15, 2) NOT NULL,
  payment_date DATE,
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'paid')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, employee_id, month)
);

-- RLS for hr_payroll
ALTER TABLE hr_payroll ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view their own payroll"
  ON hr_payroll FOR SELECT
  USING (
    tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
    AND employee_id = (SELECT id FROM hr_employees WHERE user_id = auth.uid())
  );
```

### 4.3 Inventory Module Tables

**File: `supabase/migrations/003_inventory_schema.sql`**

```sql
-- ============================================
-- INVENTORY: CATEGORIES
-- ============================================
CREATE TABLE inventory_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50),
  parent_id UUID REFERENCES inventory_categories(id) ON DELETE SET NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, code)
);

-- RLS
ALTER TABLE inventory_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view categories in their tenant"
  ON inventory_categories FOR SELECT
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- ============================================
-- INVENTORY: PRODUCTS
-- ============================================
CREATE TABLE inventory_products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sku VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  category_id UUID REFERENCES inventory_categories(id) ON DELETE SET NULL,
  description TEXT,
  unit VARCHAR(50) DEFAULT 'pcs', -- pcs, kg, liter, etc.
  cost_price DECIMAL(15, 2),
  selling_price DECIMAL(15, 2),
  min_stock_level INTEGER DEFAULT 0,
  max_stock_level INTEGER,
  barcode VARCHAR(100),
  image_url TEXT,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'discontinued')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, sku)
);

-- RLS
ALTER TABLE inventory_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view products in their tenant"
  ON inventory_products FOR SELECT
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- ============================================
-- INVENTORY: WAREHOUSES
-- ============================================
CREATE TABLE inventory_warehouses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) NOT NULL,
  address TEXT,
  manager_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, code)
);

-- RLS
ALTER TABLE inventory_warehouses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view warehouses in their tenant"
  ON inventory_warehouses FOR SELECT
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- ============================================
-- INVENTORY: STOCK (Current stock levels)
-- ============================================
CREATE TABLE inventory_stock (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES inventory_products(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES inventory_warehouses(id) ON DELETE CASCADE,
  quantity DECIMAL(15, 3) NOT NULL DEFAULT 0,
  reserved_quantity DECIMAL(15, 3) NOT NULL DEFAULT 0, -- Reserved for orders
  available_quantity DECIMAL(15, 3) GENERATED ALWAYS AS (quantity - reserved_quantity) STORED,
  last_stocktake_date DATE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, product_id, warehouse_id)
);

-- RLS
ALTER TABLE inventory_stock ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view stock in their tenant"
  ON inventory_stock FOR SELECT
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- ============================================
-- INVENTORY: STOCK MOVEMENTS (History)
-- ============================================
CREATE TABLE inventory_stock_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES inventory_products(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES inventory_warehouses(id) ON DELETE CASCADE,
  movement_type VARCHAR(50) NOT NULL CHECK (movement_type IN (
    'purchase', 'sale', 'transfer_in', 'transfer_out', 
    'adjustment', 'return', 'damage', 'stocktake'
  )),
  quantity DECIMAL(15, 3) NOT NULL, -- Positive for IN, negative for OUT
  reference_type VARCHAR(50), -- 'purchase_order', 'sales_order', etc.
  reference_id UUID,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE inventory_stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view movements in their tenant"
  ON inventory_stock_movements FOR SELECT
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- Index for performance
CREATE INDEX idx_stock_movements_product ON inventory_stock_movements(product_id, created_at DESC);
CREATE INDEX idx_stock_movements_warehouse ON inventory_stock_movements(warehouse_id, created_at DESC);
```

### 4.4 Sales Module Tables

**File: `supabase/migrations/004_sales_schema.sql`**

```sql
-- ============================================
-- SALES: CUSTOMERS
-- ============================================
CREATE TABLE sales_customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(20),
  address TEXT,
  tax_code VARCHAR(50),
  customer_type VARCHAR(50) CHECK (customer_type IN ('individual', 'company')),
  credit_limit DECIMAL(15, 2) DEFAULT 0,
  payment_term_days INTEGER DEFAULT 0, -- Net payment days
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'blocked')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, code)
);

-- RLS
ALTER TABLE sales_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view customers in their tenant"
  ON sales_customers FOR SELECT
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- ============================================
-- SALES: ORDERS
-- ============================================
CREATE TABLE sales_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_number VARCHAR(50) NOT NULL,
  customer_id UUID NOT NULL REFERENCES sales_customers(id) ON DELETE RESTRICT,
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  delivery_date DATE,
  status VARCHAR(50) DEFAULT 'draft' CHECK (status IN (
    'draft', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'
  )),
  subtotal DECIMAL(15, 2) NOT NULL DEFAULT 0,
  discount DECIMAL(15, 2) DEFAULT 0,
  tax DECIMAL(15, 2) DEFAULT 0,
  total DECIMAL(15, 2) NOT NULL DEFAULT 0,
  payment_status VARCHAR(50) DEFAULT 'unpaid' CHECK (payment_status IN (
    'unpaid', 'partial', 'paid', 'refunded'
  )),
  shipping_address TEXT,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, order_number)
);

-- RLS
ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view orders in their tenant"
  ON sales_orders FOR SELECT
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- ============================================
-- SALES: ORDER ITEMS
-- ============================================
CREATE TABLE sales_order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES inventory_products(id) ON DELETE RESTRICT,
  quantity DECIMAL(15, 3) NOT NULL,
  unit_price DECIMAL(15, 2) NOT NULL,
  discount DECIMAL(15, 2) DEFAULT 0,
  tax_rate DECIMAL(5, 2) DEFAULT 0,
  subtotal DECIMAL(15, 2) GENERATED ALWAYS AS (quantity * unit_price - discount) STORED,
  total DECIMAL(15, 2) GENERATED ALWAYS AS ((quantity * unit_price - discount) * (1 + tax_rate / 100)) STORED,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE sales_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view order items in their tenant"
  ON sales_order_items FOR SELECT
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));
```

### 4.5 Finance Module Tables

**File: `supabase/migrations/005_finance_schema.sql`**

```sql
-- ============================================
-- FINANCE: ACCOUNTS (Chart of Accounts)
-- ============================================
CREATE TABLE finance_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  account_type VARCHAR(50) CHECK (account_type IN (
    'asset', 'liability', 'equity', 'revenue', 'expense'
  )),
  parent_id UUID REFERENCES finance_accounts(id) ON DELETE SET NULL,
  balance DECIMAL(15, 2) DEFAULT 0,
  is_system BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, code)
);

-- RLS
ALTER TABLE finance_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view accounts in their tenant"
  ON finance_accounts FOR SELECT
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- ============================================
-- FINANCE: TRANSACTIONS
-- ============================================
CREATE TABLE finance_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  transaction_number VARCHAR(50) NOT NULL,
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT,
  reference_type VARCHAR(50), -- 'sales_order', 'purchase_order', 'payroll', etc.
  reference_id UUID,
  total_amount DECIMAL(15, 2) NOT NULL,
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'void')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, transaction_number)
);

-- RLS
ALTER TABLE finance_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view transactions in their tenant"
  ON finance_transactions FOR SELECT
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- ============================================
-- FINANCE: TRANSACTION LINES (Double Entry)
-- ============================================
CREATE TABLE finance_transaction_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL REFERENCES finance_transactions(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES finance_accounts(id) ON DELETE RESTRICT,
  debit DECIMAL(15, 2) DEFAULT 0,
  credit DECIMAL(15, 2) DEFAULT 0,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT check_debit_or_credit CHECK (
    (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
  )
);

-- RLS
ALTER TABLE finance_transaction_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view transaction lines in their tenant"
  ON finance_transaction_lines FOR SELECT
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- Constraint: Total debits must equal total credits per transaction
CREATE OR REPLACE FUNCTION check_transaction_balance()
RETURNS TRIGGER AS $$
BEGIN
  IF (
    SELECT ABS(SUM(debit) - SUM(credit))
    FROM finance_transaction_lines
    WHERE transaction_id = NEW.transaction_id
  ) > 0.01 THEN
    RAISE EXCEPTION 'Transaction debits must equal credits';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ensure_transaction_balance
  AFTER INSERT OR UPDATE ON finance_transaction_lines
  FOR EACH ROW
  EXECUTE FUNCTION check_transaction_balance();
```

### 4.6 Database Indexes for Performance

**File: `supabase/migrations/006_indexes.sql`**

```sql
-- Tenant-based queries (most common filter)
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_employees_tenant ON hr_employees(tenant_id);
CREATE INDEX idx_products_tenant ON inventory_products(tenant_id);
CREATE INDEX idx_orders_tenant ON sales_orders(tenant_id);

-- Search and lookup
CREATE INDEX idx_products_sku ON inventory_products(sku);
CREATE INDEX idx_customers_email ON sales_customers(email);
CREATE INDEX idx_employees_code ON hr_employees(employee_code);

-- Date-based queries (reports)
CREATE INDEX idx_attendance_date ON hr_attendance(date DESC);
CREATE INDEX idx_orders_date ON sales_orders(order_date DESC);
CREATE INDEX idx_transactions_date ON finance_transactions(transaction_date DESC);

-- Full-text search (Vietnamese support)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX idx_products_name_trgm ON inventory_products USING gin (name gin_trgm_ops);
CREATE INDEX idx_customers_name_trgm ON sales_customers USING gin (name gin_trgm_ops);
```

---

## 5. Authentication & Authorization

### 5.1 Single Sign-On (SSO) Flow

```
┌─────────────────────────────────────────────────────────────┐
│              SSO Authentication Flow                         │
└─────────────────────────────────────────────────────────────┘

Step 1: User visits hr.onebiz.com.vn
  ├── Check localStorage for session token
  ├── If no token → Redirect to onebiz.com.vn/login
  └── If token exists → Validate with Supabase Auth

Step 2: Login at onebiz.com.vn
  ├── User enters email/password
  ├── Supabase Auth creates session
  ├── Store session in Supabase (shared across domains)
  └── Set secure cookie with SameSite=None; Secure

Step 3: Redirect back to hr.onebiz.com.vn
  ├── Extract session from Supabase
  ├── Validate tenant_id matches domain
  ├── Load user permissions from user_roles
  └── Grant access to HR module

Step 4: Access other subdomains
  ├── User clicks link to inventory.onebiz.com.vn
  ├── Session is already valid in Supabase
  ├── No re-login required
  └── Seamless navigation
```

### 5.2 Supabase Auth Configuration

**File: `lib/auth/supabase.ts`**

```typescript
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      flowType: 'pkce', // Use PKCE flow for security
    },
  }
);
```

### 5.3 Auth Provider with SSO

**File: `lib/auth/AuthProvider.tsx`**

```typescript
'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { useTenant } from '../tenant/TenantProvider';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  permissions: string[];
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [permissions, setPermissions] = useState<string[]>([]);
  const { tenant } = useTenant();

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        loadPermissions(session.user.id);
      }
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        loadPermissions(session.user.id);
      } else {
        setPermissions([]);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadPermissions = async (userId: string) => {
    const { data, error } = await supabase
      .from('user_roles')
      .select('role:roles(permissions)')
      .eq('user_id', userId);

    if (!error && data) {
      const allPermissions = data.flatMap(
        (item: any) => item.role.permissions || []
      );
      setPermissions(allPermissions);
    }
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const hasPermission = (permission: string): boolean => {
    // Check for wildcard permission
    if (permissions.includes('*')) return true;

    // Check for exact match
    if (permissions.includes(permission)) return true;

    // Check for module wildcard (e.g., "hr.*" matches "hr.employees.read")
    const [module, ...rest] = permission.split('.');
    if (permissions.includes(`${module}.*`)) return true;

    return false;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        permissions,
        signIn,
        signOut,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
```

### 5.4 Permission-based Component

**File: `components/auth/ProtectedComponent.tsx`**

```typescript
'use client';

import { useAuth } from '@/lib/auth/AuthProvider';

interface ProtectedComponentProps {
  permission: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function ProtectedComponent({
  permission,
  children,
  fallback = null,
}: ProtectedComponentProps) {
  const { hasPermission } = useAuth();

  if (!hasPermission(permission)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
```

### 5.5 Permission Definitions

```typescript
// File: lib/auth/permissions.ts

export const PERMISSIONS = {
  // HR Module
  HR_EMPLOYEES_READ: 'hr.employees.read',
  HR_EMPLOYEES_WRITE: 'hr.employees.write',
  HR_EMPLOYEES_DELETE: 'hr.employees.delete',
  HR_ATTENDANCE_READ: 'hr.attendance.read',
  HR_ATTENDANCE_WRITE: 'hr.attendance.write',
  HR_PAYROLL_READ: 'hr.payroll.read',
  HR_PAYROLL_WRITE: 'hr.payroll.write',

  // Inventory Module
  INVENTORY_PRODUCTS_READ: 'inventory.products.read',
  INVENTORY_PRODUCTS_WRITE: 'inventory.products.write',
  INVENTORY_STOCK_READ: 'inventory.stock.read',
  INVENTORY_STOCK_WRITE: 'inventory.stock.write',

  // Sales Module
  SALES_ORDERS_READ: 'sales.orders.read',
  SALES_ORDERS_WRITE: 'sales.orders.write',
  SALES_CUSTOMERS_READ: 'sales.customers.read',
  SALES_CUSTOMERS_WRITE: 'sales.customers.write',

  // Finance Module
  FINANCE_TRANSACTIONS_READ: 'finance.transactions.read',
  FINANCE_TRANSACTIONS_WRITE: 'finance.transactions.write',
  FINANCE_REPORTS_READ: 'finance.reports.read',

  // System
  SYSTEM_ADMIN: '*',
  SETTINGS_MANAGE: 'settings.*',
} as const;
```

---

## 6. API Design

### 6.1 API Structure

```
/api
├── /auth
│   ├── /login
│   ├── /logout
│   ├── /refresh
│   └── /sso-validate
├── /hr
│   ├── /employees
│   ├── /attendance
│   ├── /leave-requests
│   └── /payroll
├── /inventory
│   ├── /products
│   ├── /stock
│   ├── /warehouses
│   └── /movements
├── /sales
│   ├── /orders
│   ├── /customers
│   └── /quotations
├── /finance
│   ├── /accounts
│   ├── /transactions
│   └── /reports
└── /reports
    ├── /dashboard
    ├── /analytics
    └── /export
```

### 6.2 API Route Example: Products

**File: `app/api/inventory/products/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

// GET /api/inventory/products
export async function GET(request: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });

  // Verify authentication
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get tenant_id from user
  const { data: userData } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', session.user.id)
    .single();

  if (!userData) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Parse query parameters
  const searchParams = request.nextUrl.searchParams;
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');
  const search = searchParams.get('search') || '';
  const category = searchParams.get('category');
  const status = searchParams.get('status');

  // Build query with RLS (automatically filters by tenant_id)
  let query = supabase
    .from('inventory_products')
    .select('*, category:inventory_categories(name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  // Apply filters
  if (search) {
    query = query.ilike('name', `%${search}%`);
  }

  if (category) {
    query = query.eq('category_id', category);
  }

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    data,
    pagination: {
      page,
      limit,
      total: count,
      totalPages: Math.ceil((count || 0) / limit),
    },
  });
}

// POST /api/inventory/products
export async function POST(request: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });

  // Verify authentication
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check permission
  const hasPermission = await checkPermission(
    session.user.id,
    'inventory.products.write'
  );

  if (!hasPermission) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Get tenant_id
  const { data: userData } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', session.user.id)
    .single();

  // Parse request body
  const body = await request.json();

  // Insert product (RLS automatically adds tenant_id)
  const { data, error } = await supabase
    .from('inventory_products')
    .insert({
      ...body,
      tenant_id: userData.tenant_id,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}

// Helper function
async function checkPermission(
  userId: string,
  permission: string
): Promise<boolean> {
  const supabase = createRouteHandlerClient({ cookies });

  const { data } = await supabase
    .from('user_roles')
    .select('role:roles(permissions)')
    .eq('user_id', userId);

  if (!data) return false;

  const allPermissions = data.flatMap((item: any) => item.role.permissions || []);

  return (
    allPermissions.includes('*') ||
    allPermissions.includes(permission) ||
    allPermissions.includes(permission.split('.')[0] + '.*')
  );
}
```

### 6.3 API Middleware for Tenant Validation

**File: `middleware.ts`**

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';

export async function middleware(request: NextRequest) {
  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req: request, res });

  // Refresh session if needed
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // For API routes, validate tenant
  if (request.nextUrl.pathname.startsWith('/api/')) {
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's tenant
    const { data: userData } = await supabase
      .from('users')
      .select('tenant_id, tenants(domain, subdomain)')
      .eq('id', session.user.id)
      .single();

    if (!userData) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Validate domain matches tenant
    const hostname = request.headers.get('host') || '';
    const tenant = userData.tenants as any;
    
    const isValidDomain =
      hostname === tenant.domain ||
      hostname === `${tenant.subdomain}.${tenant.domain}`;

    if (!isValidDomain) {
      return NextResponse.json({ error: 'Invalid tenant' }, { status: 403 });
    }
  }

  return res;
}

export const config = {
  matcher: ['/api/:path*', '/dashboard/:path*'],
};
```

---

## 7. Real-time Data Sync

### 7.1 Supabase Realtime Configuration

**File: `lib/realtime/useRealtimeSync.ts`**

```typescript
'use client';

import { useEffect } from 'react';
import { supabase } from '../auth/supabase';
import { useTenant } from '../tenant/TenantProvider';

interface RealtimeSyncOptions {
  table: string;
  event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
  filter?: string;
  onInsert?: (payload: any) => void;
  onUpdate?: (payload: any) => void;
  onDelete?: (payload: any) => void;
}

export function useRealtimeSync({
  table,
  event = '*',
  filter,
  onInsert,
  onUpdate,
  onDelete,
}: RealtimeSyncOptions) {
  const { tenant } = useTenant();

  useEffect(() => {
    if (!tenant) return;

    // Create channel
    const channel = supabase
      .channel(`${table}-changes`)
      .on(
        'postgres_changes',
        {
          event,
          schema: 'public',
          table,
          filter: filter || `tenant_id=eq.${tenant.id}`,
        },
        (payload) => {
          console.log('Realtime change received:', payload);

          switch (payload.eventType) {
            case 'INSERT':
              onInsert?.(payload.new);
              break;
            case 'UPDATE':
              onUpdate?.(payload.new);
              break;
            case 'DELETE':
              onDelete?.(payload.old);
              break;
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenant, table, event, filter]);
}
```

### 7.2 Real-time Dashboard Example

**File: `app/dashboard/page.tsx`**

```typescript
'use client';

import { useState, useEffect } from 'react';
import { useRealtimeSync } from '@/lib/realtime/useRealtimeSync';
import { supabase } from '@/lib/auth/supabase';

export default function Dashboard() {
  const [stats, setStats] = useState({
    totalOrders: 0,
    totalRevenue: 0,
    lowStockItems: 0,
    activeEmployees: 0,
  });

  // Load initial data
  useEffect(() => {
    loadDashboardStats();
  }, []);

  // Real-time sync for orders
  useRealtimeSync({
    table: 'sales_orders',
    onInsert: (order) => {
      setStats((prev) => ({
        ...prev,
        totalOrders: prev.totalOrders + 1,
        totalRevenue: prev.totalRevenue + order.total,
      }));
    },
    onUpdate: (order) => {
      // Recalculate stats
      loadDashboardStats();
    },
  });

  // Real-time sync for inventory
  useRealtimeSync({
    table: 'inventory_stock',
    onUpdate: (stock) => {
      if (stock.available_quantity < stock.min_stock_level) {
        loadDashboardStats(); // Refresh low stock count
      }
    },
  });

  const loadDashboardStats = async () => {
    // Load from database
    const [orders, revenue, lowStock, employees] = await Promise.all([
      supabase.from('sales_orders').select('id', { count: 'exact', head: true }),
      supabase.from('sales_orders').select('total'),
      supabase
        .from('inventory_stock')
        .select('id', { count: 'exact', head: true })
        .lt('available_quantity', 'min_stock_level'),
      supabase
        .from('hr_employees')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active'),
    ]);

    setStats({
      totalOrders: orders.count || 0,
      totalRevenue:
        revenue.data?.reduce((sum, o) => sum + (o.total || 0), 0) || 0,
      lowStockItems: lowStock.count || 0,
      activeEmployees: employees.count || 0,
    });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard title="Đơn hàng" value={stats.totalOrders} />
      <StatCard
        title="Doanh thu"
        value={new Intl.NumberFormat('vi-VN', {
          style: 'currency',
          currency: 'VND',
        }).format(stats.totalRevenue)}
      />
      <StatCard title="Hàng sắp hết" value={stats.lowStockItems} />
      <StatCard title="Nhân viên" value={stats.activeEmployees} />
    </div>
  );
}
```

---

## 8. Deployment Strategy

### 8.1 Development Environment

```bash
# Local Development Setup
# 1. Clone repository
git clone https://github.com/onebiz/erp-system.git
cd erp-system

# 2. Install dependencies
npm install

# 3. Setup Supabase local development
npx supabase init
npx supabase start

# 4. Run migrations
npx supabase db reset

# 5. Setup environment variables
cp .env.example .env.local
# Edit .env.local with your Supabase credentials

# 6. Start development server
npm run dev

# Access:
# - Main: http://localhost:3000
# - HR: http://hr.localhost:3000
# - Inventory: http://inventory.localhost:3000
```

**File: `.env.example`**
```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-local-anon-key

# Domain configuration
DOMAIN=localhost:3000
NEXT_PUBLIC_MAIN_DOMAIN=http://localhost:3000
NEXT_PUBLIC_HR_DOMAIN=http://hr.localhost:3000
NEXT_PUBLIC_INVENTORY_DOMAIN=http://inventory.localhost:3000

# Tenant (for development)
NEXT_PUBLIC_TENANT_ID=default-tenant
```

### 8.2 Production Deployment

#### Option 1: Monorepo with Multiple Vercel Projects

```
Repository Structure:
/
├── apps/
│   ├── main/         → Deploy to onebiz.com.vn
│   ├── hr/           → Deploy to hr.onebiz.com.vn
│   └── inventory/    → Deploy to inventory.onebiz.com.vn
├── packages/
│   ├── ui/           → Shared components
│   ├── database/     → Supabase client & types
│   └── auth/         → Auth utilities
└── supabase/
    └── migrations/
```

**Deployment Steps:**

```bash
# 1. Create Vercel projects
vercel --cwd apps/main
vercel --cwd apps/hr
vercel --cwd apps/inventory

# 2. Configure custom domains in Vercel
# Main: onebiz.com.vn
# HR: hr.onebiz.com.vn
# Inventory: inventory.onebiz.com.vn

# 3. Set environment variables per project
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add DOMAIN production
```

#### Option 2: Single Next.js App with Domain-based Routing

```typescript
// middleware.ts
export function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || '';
  
  // Route based on domain
  if (hostname.startsWith('hr.')) {
    return NextResponse.rewrite(new URL('/hr', request.url));
  }
  
  if (hostname.startsWith('inventory.')) {
    return NextResponse.rewrite(new URL('/inventory', request.url));
  }
  
  return NextResponse.next();
}
```

### 8.3 Supabase Production Setup

```bash
# 1. Create Supabase project at supabase.com
# 2. Get connection string and API keys

# 3. Run migrations
npx supabase link --project-ref your-project-ref
npx supabase db push

# 4. Enable Realtime for tables
# Go to Supabase Dashboard > Database > Replication
# Enable for: sales_orders, inventory_stock, hr_attendance

# 5. Configure Auth settings
# Enable Email/Password provider
# Add allowed domains:
# - onebiz.com.vn
# - hr.onebiz.com.vn
# - inventory.onebiz.com.vn
# - *.onebiz.com.vn (for custom tenant domains)
```

### 8.4 DNS Configuration (Cloudflare)

```
DNS Records:

Type    Name          Content                    Proxy
----------------------------------------------------
A       @             76.76.21.21                ✓ Proxied
CNAME   hr            onebiz.com.vn              ✓ Proxied
CNAME   inventory     onebiz.com.vn              ✓ Proxied
CNAME   *             onebiz.com.vn              ✓ Proxied (for tenants)

Cloudflare Settings:
- SSL/TLS: Full (strict)
- Always Use HTTPS: On
- Automatic HTTPS Rewrites: On
- Minimum TLS Version: 1.2
- Opportunistic Encryption: On
- TLS 1.3: On
```

### 8.5 CI/CD Pipeline (GitHub Actions)

**File: `.github/workflows/deploy.yml`**

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy-main:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install Vercel CLI
        run: npm install -g vercel
        
      - name: Deploy Main Domain
        run: |
          cd apps/main
          vercel --prod --token=${{ secrets.VERCEL_TOKEN }}
        env:
          VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID_MAIN }}

  deploy-hr:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Deploy HR Subdomain
        run: |
          cd apps/hr
          vercel --prod --token=${{ secrets.VERCEL_TOKEN }}
        env:
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID_HR }}

  deploy-inventory:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Deploy Inventory Subdomain
        run: |
          cd apps/inventory
          vercel --prod --token=${{ secrets.VERCEL_TOKEN }}
        env:
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID_INVENTORY }}
```

---

## 9. Cost Estimation

### 9.1 Monthly Cost Breakdown (Vietnamese Market)

#### Tier 1: Startup (1-10 users)

```
┌─────────────────────────────────────────────────────────┐
│ Service           Plan              Cost        VND      │
├─────────────────────────────────────────────────────────┤
│ Vercel           Hobby              $0          0đ       │
│ Supabase         Free               $0          0đ       │
│ Domain (.vn)     Annual             $15/year    ~30.000đ │
│ Cloudflare       Free               $0          0đ       │
│                                                          │
│ TOTAL PER MONTH:                    ~30.000 VNĐ/tháng   │
└─────────────────────────────────────────────────────────┘

Limitations:
- Vercel: 100GB bandwidth, 100 deployments/day
- Supabase: 500MB database, 1GB file storage, 2GB bandwidth
- Suitable for: Testing, MVP, very small business
```

#### Tier 2: Small Business (10-50 users)

```
┌─────────────────────────────────────────────────────────┐
│ Service           Plan              Cost        VND      │
├─────────────────────────────────────────────────────────┤
│ Vercel           Pro                $20/month   500.000đ │
│ Supabase         Pro                $25/month   625.000đ │
│ Domain (.vn)     Annual             $15/year    30.000đ  │
│ Cloudflare       Pro (optional)     $20/month   500.000đ │
│                                                          │
│ TOTAL PER MONTH:                    ~1.625.000 VNĐ      │
└─────────────────────────────────────────────────────────┘

Features:
- Vercel: 1TB bandwidth, unlimited deployments
- Supabase: 8GB database, 100GB file storage, 250GB bandwidth
- Cloudflare Pro: Advanced DDoS, WAF, Image optimization
- Suitable for: Growing businesses, 10-50 employees
```

#### Tier 3: Medium Business (50-200 users)

```
┌─────────────────────────────────────────────────────────┐
│ Service           Plan              Cost        VND      │
├─────────────────────────────────────────────────────────┤
│ Vercel           Pro                $20/month   500.000đ │
│ Supabase         Team               $599/month  15M đ    │
│ Domain (.vn)     Annual             $15/year    30.000đ  │
│ Cloudflare       Business           $200/month  5M đ     │
│ S3 Storage       ~500GB             $12/month   300.000đ │
│                                                          │
│ TOTAL PER MONTH:                    ~20.800.000 VNĐ     │
└─────────────────────────────────────────────────────────┘

Features:
- Supabase Team: 1 week PITR, 50GB bandwidth daily, SOC2
- Cloudflare Business: 100% uptime SLA, PCI compliance
- S3: For large file storage (documents, images)
- Suitable for: Established SMEs
```

#### Tier 4: Enterprise (200+ users)

```
┌─────────────────────────────────────────────────────────┐
│ Service           Plan              Cost        VND      │
├─────────────────────────────────────────────────────────┤
│ Vercel           Enterprise         Custom      Liên hệ  │
│ Supabase         Enterprise         Custom      Liên hệ  │
│ AWS/GCP          Custom             ~$500/mo    12.5M đ  │
│ Cloudflare       Enterprise         Custom      Liên hệ  │
│                                                          │
│ ESTIMATED TOTAL:                    50-100 triệu VNĐ/mo  │
└─────────────────────────────────────────────────────────┘

Features:
- Dedicated infrastructure
- Custom SLA (99.99% uptime)
- 24/7 support
- Compliance: SOC2, ISO 27001
- Custom integrations
```

### 9.2 Per-Tenant Pricing Model

```
Pricing Strategy for OneBiz Customers:

┌─────────────────────────────────────────────────────────┐
│ Package      Users    Storage   Price/month   Features  │
├─────────────────────────────────────────────────────────┤
│ Starter      1-5      1GB       500.000đ      Basic     │
│ Business     6-20     10GB      2.000.000đ    Standard  │
│ Professional 21-50    50GB      5.000.000đ    Advanced  │
│ Enterprise   51+      Custom    Custom        Full      │
└─────────────────────────────────────────────────────────┘

Additional Costs:
- Extra user: 50.000đ/user/month
- Extra storage: 100.000đ/10GB/month
- Custom domain setup: 500.000đ one-time
- API access: 1.000.000đ/month
- Custom integrations: From 5.000.000đ
```

### 9.3 Cost Optimization Strategies

```
1. Database Optimization:
   - Enable connection pooling (PgBouncer) - Free with Supabase
   - Use database indexes properly - Reduces query costs
   - Implement caching with Redis/Upstash - ~$10/month
   - Archive old data to cheaper storage

2. CDN & Bandwidth:
   - Use Cloudflare Images - $5/month for 100k images
   - Enable Vercel Edge Caching - Included
   - Compress assets (WebP, Brotli) - Free
   - Lazy load images/components

3. Serverless Functions:
   - Use Edge Functions for fast responses - Free 100k/mo
   - Combine related API calls
   - Implement request batching
   - Cache API responses

4. Storage:
   - Use Supabase Storage for < 100GB - Included
   - Move to S3 for larger files - Cheaper at scale
   - Implement file compression
   - Set up lifecycle policies (auto-delete old files)
```

---

## 10. Migration Plan

### 10.1 Migration from Current System to Multi-tenant

**Phase 1: Preparation (Week 1-2)**

```
Tasks:
✓ Audit current database schema
✓ Create migration scripts
✓ Setup development environment
✓ Create test tenant data
✓ Document API changes

Deliverables:
- Database migration scripts
- Data migration plan
- Rollback procedures
```

**Phase 2: Database Migration (Week 3)**

```sql
-- Step 1: Add tenant_id to existing tables
ALTER TABLE users ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE products ADD COLUMN tenant_id UUID REFERENCES tenants(id);
-- ... repeat for all tables

-- Step 2: Create default tenant for existing data
INSERT INTO tenants (id, name, subdomain, domain)
VALUES ('default-tenant-uuid', 'OneBiz', '', 'onebiz.com.vn');

-- Step 3: Update existing records with default tenant
UPDATE users SET tenant_id = 'default-tenant-uuid';
UPDATE products SET tenant_id = 'default-tenant-uuid';
-- ... repeat for all tables

-- Step 4: Make tenant_id NOT NULL
ALTER TABLE users ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE products ALTER COLUMN tenant_id SET NOT NULL;

-- Step 5: Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- ... repeat for all tables
```

**Phase 3: Code Migration (Week 4-5)**

```
Tasks:
- Add TenantProvider to app
- Update all database queries to be tenant-aware
- Implement SSO authentication
- Add permission checks to API routes
- Update UI to show tenant branding

Testing:
- Unit tests for tenant isolation
- Integration tests for SSO flow
- Load testing with multiple tenants
```

**Phase 4: Subdomain Setup (Week 6)**

```
Tasks:
1. Configure DNS for subdomains
2. Deploy HR system to hr.onebiz.com.vn
3. Deploy Inventory to inventory.onebiz.com.vn
4. Setup SSL certificates
5. Configure CORS for cross-domain requests

Verification:
- Test SSO across domains
- Verify data isolation
- Check real-time sync
- Performance testing
```

**Phase 5: Production Rollout (Week 7-8)**

```
Day 1-2: Soft Launch
- Enable for internal testing only
- Monitor error logs
- Check performance metrics

Day 3-5: Beta Testing
- Invite 5-10 friendly customers
- Gather feedback
- Fix critical bugs

Day 6-7: Full Launch
- Announce to all customers
- Provide migration guides
- 24/7 support standby
```

### 10.2 Migrating Existing Customer to Their Own Domain

**Scenario: Customer "ABC Company" wants custom domain `erp.abc.com`**

```bash
# Step 1: Create new tenant in database
INSERT INTO tenants (name, custom_domain, features)
VALUES ('ABC Company', 'erp.abc.com', '{"hr":true,"inventory":true}');

# Step 2: Migrate customer data
UPDATE users SET tenant_id = 'abc-tenant-id' WHERE company_id = 'abc-id';
UPDATE products SET tenant_id = 'abc-tenant-id' WHERE company_id = 'abc-id';
# ... migrate all related data

# Step 3: Customer configures DNS
# They add CNAME: erp.abc.com → onebiz.com.vn

# Step 4: Add domain to Vercel
vercel domains add erp.abc.com --project=onebiz-erp

# Step 5: Verify SSL certificate is issued

# Step 6: Update environment config
# Add erp.abc.com to allowed domains

# Step 7: Test & Go Live
# Customer can now access at erp.abc.com
```

---

## 11. Security Best Practices

### 11.1 Checklist

```
✓ Row Level Security (RLS) enabled on all tables
✓ API routes verify authentication token
✓ Permission checks before sensitive operations
✓ Input validation and sanitization
✓ SQL injection prevention (use parameterized queries)
✓ XSS protection (Content Security Policy)
✓ CSRF tokens for state-changing operations
✓ Rate limiting on API endpoints
✓ Audit logging for sensitive actions
✓ Regular security updates (dependencies)
✓ Environment variables never committed to git
✓ HTTPS enforced on all domains
✓ Secure cookie settings (HttpOnly, Secure, SameSite)
✓ Two-factor authentication (optional for admin)
```

### 11.2 RLS Policy Examples

```sql
-- Prevent cross-tenant data access
CREATE POLICY "tenant_isolation"
  ON inventory_products FOR ALL
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- Allow employees to see only their own payroll
CREATE POLICY "employees_own_payroll"
  ON hr_payroll FOR SELECT
  USING (
    employee_id = (SELECT id FROM hr_employees WHERE user_id = auth.uid())
  );

-- Managers can see their department's data
CREATE POLICY "managers_department_view"
  ON hr_employees FOR SELECT
  USING (
    department_id IN (
      SELECT id FROM departments 
      WHERE manager_id = auth.uid()
    )
  );
```

---

## 12. Performance Optimization

### 12.1 Database Optimization

```sql
-- 1. Add indexes for common queries
CREATE INDEX idx_orders_customer_date 
  ON sales_orders(customer_id, order_date DESC);

CREATE INDEX idx_stock_product_warehouse 
  ON inventory_stock(product_id, warehouse_id);

-- 2. Materialized views for complex reports
CREATE MATERIALIZED VIEW mv_monthly_sales AS
SELECT 
  DATE_TRUNC('month', order_date) AS month,
  tenant_id,
  COUNT(*) AS total_orders,
  SUM(total) AS total_revenue
FROM sales_orders
WHERE status != 'cancelled'
GROUP BY month, tenant_id;

-- Refresh daily via cron job
CREATE INDEX idx_mv_monthly_sales ON mv_monthly_sales(tenant_id, month DESC);

-- 3. Partitioning for large tables (optional for scale)
CREATE TABLE inventory_stock_movements_2024 
  PARTITION OF inventory_stock_movements
  FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
```

### 12.2 Frontend Optimization

```typescript
// 1. Use React Server Components for static content
// app/dashboard/layout.tsx
export default async function DashboardLayout({ children }) {
  const stats = await fetchDashboardStats(); // Server-side fetch
  
  return (
    <div>
      <StaticHeader stats={stats} />
      {children}
    </div>
  );
}

// 2. Implement pagination and virtual scrolling
import { useVirtualizer } from '@tanstack/react-virtual';

// 3. Lazy load components
const InventoryModule = dynamic(() => import('./InventoryModule'), {
  loading: () => <Skeleton />,
});

// 4. Optimize images
import Image from 'next/image';

<Image 
  src="/product.jpg" 
  width={200} 
  height={200} 
  alt="Product" 
  loading="lazy"
  placeholder="blur"
/>
```

---

## 13. Monitoring & Analytics

### 13.1 Recommended Tools

```
1. Vercel Analytics (Built-in)
   - Web Vitals (LCP, FID, CLS)
   - Real-time traffic
   - Cost: Free on Pro plan

2. Supabase Dashboard
   - Database performance
   - Query statistics
   - Connection pooling metrics

3. Sentry (Error Tracking)
   - JavaScript errors
   - Backend exceptions
   - User session replay
   - Cost: $26/month (Team plan)

4. LogRocket (Session Replay)
   - User behavior analysis
   - Performance monitoring
   - Cost: $99/month

5. PostHog (Product Analytics)
   - Feature usage
   - User funnels
   - A/B testing
   - Cost: Free up to 1M events
```

### 13.2 Custom Logging

**File: `lib/monitoring/logger.ts`**

```typescript
import { supabase } from '../auth/supabase';

interface LogEntry {
  level: 'info' | 'warn' | 'error';
  message: string;
  metadata?: Record<string, any>;
  user_id?: string;
  tenant_id?: string;
}

export async function log(entry: LogEntry) {
  await supabase.from('system_logs').insert({
    ...entry,
    created_at: new Date().toISOString(),
  });

  // Also send to external service (Sentry, LogRocket, etc.)
  if (entry.level === 'error') {
    // Sentry.captureException(entry);
  }
}

// Usage:
await log({
  level: 'info',
  message: 'User created new order',
  metadata: { order_id: '123', total: 1000000 },
  user_id: session.user.id,
  tenant_id: tenant.id,
});
```

---

## 14. Roadmap & Future Enhancements

### Phase 1 (Current): Foundation - Q1 2026
- ✓ Multi-tenant architecture
- ✓ SSO authentication
- ✓ Basic modules (HR, Inventory, Sales, Finance)
- ✓ Real-time sync

### Phase 2: Mobile Apps - Q2 2026
- React Native mobile app for iOS/Android
- Offline-first functionality
- Barcode scanning for inventory
- Mobile attendance check-in (with GPS)

### Phase 3: AI & Automation - Q3 2026
- AI-powered demand forecasting
- Automated invoice processing (OCR)
- Chatbot for employee queries
- Smart reporting with NLP

### Phase 4: Integrations - Q4 2026
- E-commerce platforms (Shopee, Lazada, TikTok Shop)
- Accounting software (MISA, FAST)
- Payment gateways (VNPay, MoMo, ZaloPay)
- Shipping providers (GHN, GHTK, Viettel Post)

### Phase 5: Advanced Features - 2027
- Multi-currency support
- Multi-language (English, Vietnamese, Chinese)
- Advanced workflow automation
- Custom module builder (no-code)
- WhiteLabel solution for resellers

---

## 15. Tổng Kết

### 15.1 Ưu Điểm Kiến Trúc

```
✅ Scalability: Dễ dàng scale theo số lượng tenant
✅ Security: RLS đảm bảo data isolation tuyệt đối
✅ Performance: Supabase Realtime cho real-time updates
✅ Cost-effective: Pay-as-you-grow pricing
✅ Developer Experience: Modern tech stack, type-safe
✅ Flexibility: Dễ dàng thêm modules mới
✅ Maintainability: Shared codebase, single deployment
```

### 15.2 Trade-offs

```
⚠️ Complexity: Multi-tenant requires careful planning
⚠️ Supabase dependency: Vendor lock-in risk
⚠️ Learning curve: Team needs to learn RLS, Realtime
⚠️ Migration effort: Existing data needs careful migration
```

### 15.3 Next Steps

```
1. ✓ Review architecture document
2. ⬜ Setup development environment
3. ⬜ Create database schema (run migrations)
4. ⬜ Implement authentication flow
5. ⬜ Build tenant provider
6. ⬜ Develop first module (HR or Inventory)
7. ⬜ Setup subdomains on Vercel
8. ⬜ Testing and QA
9. ⬜ Production deployment
10. ⬜ Customer onboarding
```

---

## Phụ Lục

### A. Tài Liệu Tham Khảo

- [Next.js 15 Documentation](https://nextjs.org/docs)
- [Supabase Documentation](https://supabase.com/docs)
- [Multi-tenant Architecture Guide](https://supabase.com/docs/guides/auth/row-level-security)
- [Vercel Deployment Guide](https://vercel.com/docs)

### B. Code Repository Structure

```
/
├── .github/
│   └── workflows/
│       └── deploy.yml
├── app/
│   ├── (auth)/
│   │   ├── login/
│   │   └── register/
│   ├── (dashboard)/
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── api/
│   │   ├── auth/
│   │   ├── hr/
│   │   ├── inventory/
│   │   ├── sales/
│   │   └── finance/
│   └── layout.tsx
├── components/
│   ├── ui/
│   ├── auth/
│   └── modules/
├── lib/
│   ├── auth/
│   ├── tenant/
│   ├── realtime/
│   └── utils/
├── supabase/
│   ├── migrations/
│   ├── seed.sql
│   └── config.toml
├── public/
├── .env.example
├── .env.local (gitignored)
├── next.config.js
├── middleware.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

### C. Support & Contact

```
Technical Support:
- Email: support@onebiz.com.vn
- Hotline: 1900 xxxx
- Working hours: 8:00 - 17:30 (GMT+7)

Sales Inquiry:
- Email: sales@onebiz.com.vn
- Zalo: 0xxx xxx xxx

Documentation:
- Docs: https://docs.onebiz.com.vn
- API Reference: https://api.onebiz.com.vn/docs
```

---

**Document Version:** 1.0  
**Last Updated:** January 26, 2026  
**Author:** OneBiz Development Team  
**Status:** ✅ Ready for Implementation

---
