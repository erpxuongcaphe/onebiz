/**
 * Supabase Database types.
 *
 * Sẽ được thay thế bằng auto-generated types từ:
 *   npx supabase gen types typescript --project-id nppumpxtjoirwhwgbvoo > src/lib/supabase/types.ts
 *
 * Tạm thời define skeleton để TypeScript không lỗi.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      tenants: {
        Row: {
          id: string;
          name: string;
          slug: string;
          settings: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          settings?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          settings?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      branches: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          address: string | null;
          phone: string | null;
          is_default: boolean;
          is_active: boolean;
          code: string | null;
          branch_type: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          address?: string | null;
          phone?: string | null;
          is_default?: boolean;
          is_active?: boolean;
          code?: string | null;
          branch_type?: string;
        };
        Update: {
          name?: string;
          address?: string | null;
          phone?: string | null;
          is_default?: boolean;
          is_active?: boolean;
          code?: string | null;
          branch_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "branches_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          id: string;
          tenant_id: string;
          branch_id: string | null;
          full_name: string;
          email: string;
          phone: string | null;
          avatar_url: string | null;
          role: "owner" | "admin" | "manager" | "staff" | "cashier";
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          tenant_id: string;
          branch_id?: string | null;
          full_name: string;
          email: string;
          phone?: string | null;
          avatar_url?: string | null;
          role?: "owner" | "admin" | "manager" | "staff" | "cashier";
          is_active?: boolean;
        };
        Update: {
          branch_id?: string | null;
          full_name?: string;
          phone?: string | null;
          avatar_url?: string | null;
          role?: "owner" | "admin" | "manager" | "staff" | "cashier";
          is_active?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profiles_branch_id_fkey";
            columns: ["branch_id"];
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
        ];
      };
      categories: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          parent_id: string | null;
          sort_order: number;
          code: string | null;
          scope: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          parent_id?: string | null;
          sort_order?: number;
          code?: string | null;
          scope?: string | null;
        };
        Update: {
          name?: string;
          parent_id?: string | null;
          sort_order?: number;
          code?: string | null;
          scope?: string | null;
        };
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          tenant_id: string;
          code: string;
          barcode: string | null;
          name: string;
          category_id: string | null;
          unit: string;
          cost_price: number;
          sell_price: number;
          stock: number;
          min_stock: number;
          max_stock: number;
          weight: number | null;
          description: string | null;
          image_url: string | null;
          allow_sale: boolean;
          is_active: boolean;
          product_type: string;
          has_bom: boolean;
          old_code: string | null;
          group_code: string | null;
          purchase_unit: string | null;
          stock_unit: string | null;
          sell_unit: string | null;
          shelf_life_days: number | null;
          shelf_life_unit: string;
          supplier_id: string | null;
          vat_rate: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          code: string;
          barcode?: string | null;
          name: string;
          category_id?: string | null;
          unit?: string;
          cost_price?: number;
          sell_price: number;
          stock?: number;
          min_stock?: number;
          max_stock?: number;
          weight?: number | null;
          description?: string | null;
          image_url?: string | null;
          allow_sale?: boolean;
          is_active?: boolean;
          product_type?: string;
          has_bom?: boolean;
          old_code?: string | null;
          group_code?: string | null;
          purchase_unit?: string | null;
          stock_unit?: string | null;
          sell_unit?: string | null;
          shelf_life_days?: number | null;
          shelf_life_unit?: string;
          supplier_id?: string | null;
          vat_rate?: number;
        };
        Update: {
          code?: string;
          barcode?: string | null;
          name?: string;
          category_id?: string | null;
          unit?: string;
          cost_price?: number;
          sell_price?: number;
          stock?: number;
          min_stock?: number;
          max_stock?: number;
          weight?: number | null;
          description?: string | null;
          image_url?: string | null;
          allow_sale?: boolean;
          is_active?: boolean;
          product_type?: string;
          has_bom?: boolean;
          old_code?: string | null;
          group_code?: string | null;
          purchase_unit?: string | null;
          stock_unit?: string | null;
          sell_unit?: string | null;
          shelf_life_days?: number | null;
          shelf_life_unit?: string;
          supplier_id?: string | null;
          vat_rate?: number;
        };
        Relationships: [
          {
            foreignKeyName: "products_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_category_id_fkey";
            columns: ["category_id"];
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      suppliers: {
        Row: {
          id: string;
          tenant_id: string;
          code: string;
          name: string;
          phone: string | null;
          email: string | null;
          address: string | null;
          tax_code: string | null;
          debt: number;
          note: string | null;
          is_active: boolean;
          group_code: string | null;
          group_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          code: string;
          name: string;
          phone?: string | null;
          email?: string | null;
          address?: string | null;
          tax_code?: string | null;
          debt?: number;
          note?: string | null;
          is_active?: boolean;
          group_code?: string | null;
          group_id?: string | null;
        };
        Update: {
          code?: string;
          name?: string;
          phone?: string | null;
          email?: string | null;
          address?: string | null;
          tax_code?: string | null;
          debt?: number;
          note?: string | null;
          is_active?: boolean;
          group_code?: string | null;
          group_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "suppliers_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_groups: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          discount_percent: number;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          discount_percent?: number;
          note?: string | null;
        };
        Update: {
          name?: string;
          discount_percent?: number;
          note?: string | null;
        };
        Relationships: [];
      };
      customers: {
        Row: {
          id: string;
          tenant_id: string;
          code: string;
          name: string;
          phone: string | null;
          email: string | null;
          address: string | null;
          group_id: string | null;
          gender: "male" | "female" | null;
          customer_type: "individual" | "company";
          debt: number;
          total_spent: number;
          total_orders: number;
          loyalty_points: number;
          loyalty_tier_id: string | null;
          note: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          code: string;
          name: string;
          phone?: string | null;
          email?: string | null;
          address?: string | null;
          group_id?: string | null;
          gender?: "male" | "female" | null;
          customer_type?: "individual" | "company";
          debt?: number;
          total_spent?: number;
          total_orders?: number;
          loyalty_points?: number;
          loyalty_tier_id?: string | null;
          note?: string | null;
          is_active?: boolean;
        };
        Update: {
          code?: string;
          name?: string;
          phone?: string | null;
          email?: string | null;
          address?: string | null;
          group_id?: string | null;
          gender?: "male" | "female" | null;
          customer_type?: "individual" | "company";
          debt?: number;
          loyalty_points?: number;
          loyalty_tier_id?: string | null;
          total_spent?: number;
          total_orders?: number;
          note?: string | null;
          is_active?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customers_group_id_fkey";
            columns: ["group_id"];
            referencedRelation: "customer_groups";
            referencedColumns: ["id"];
          },
        ];
      };
      invoices: {
        Row: {
          id: string;
          tenant_id: string;
          branch_id: string;
          code: string;
          customer_id: string | null;
          customer_name: string;
          status: "draft" | "confirmed" | "completed" | "cancelled";
          subtotal: number;
          discount_amount: number;
          tax_amount: number;
          total: number;
          paid: number;
          debt: number;
          payment_method: "cash" | "transfer" | "card" | "mixed";
          note: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          branch_id: string;
          code: string;
          customer_id?: string | null;
          customer_name?: string;
          status?: "draft" | "confirmed" | "completed" | "cancelled";
          subtotal?: number;
          discount_amount?: number;
          tax_amount?: number;
          total?: number;
          paid?: number;
          debt?: number;
          payment_method?: "cash" | "transfer" | "card" | "mixed";
          note?: string | null;
          created_by: string;
        };
        Update: {
          status?: "draft" | "confirmed" | "completed" | "cancelled";
          subtotal?: number;
          discount_amount?: number;
          tax_amount?: number;
          total?: number;
          paid?: number;
          debt?: number;
          payment_method?: "cash" | "transfer" | "card" | "mixed";
          note?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "invoices_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_branch_id_fkey";
            columns: ["branch_id"];
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_customer_id_fkey";
            columns: ["customer_id"];
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      invoice_items: {
        Row: {
          id: string;
          invoice_id: string;
          product_id: string;
          product_name: string;
          unit: string;
          quantity: number;
          unit_price: number;
          discount: number;
          vat_rate: number;
          vat_amount: number;
          total: number;
        };
        Insert: {
          id?: string;
          invoice_id: string;
          product_id: string;
          product_name: string;
          unit?: string;
          quantity: number;
          unit_price: number;
          discount?: number;
          vat_rate?: number;
          vat_amount?: number;
          total: number;
        };
        Update: {
          quantity?: number;
          unit_price?: number;
          discount?: number;
          vat_rate?: number;
          vat_amount?: number;
          total?: number;
        };
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey";
            columns: ["invoice_id"];
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey";
            columns: ["product_id"];
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_orders: {
        Row: {
          id: string;
          tenant_id: string;
          branch_id: string;
          code: string;
          supplier_id: string;
          supplier_name: string;
          status: "draft" | "ordered" | "partial" | "completed" | "cancelled";
          subtotal: number;
          discount_amount: number;
          tax_amount: number;
          total: number;
          paid: number;
          debt: number;
          note: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          branch_id: string;
          code: string;
          supplier_id: string;
          supplier_name: string;
          status?: "draft" | "ordered" | "partial" | "completed" | "cancelled";
          subtotal?: number;
          discount_amount?: number;
          tax_amount?: number;
          total?: number;
          paid?: number;
          debt?: number;
          note?: string | null;
          created_by: string;
        };
        Update: {
          status?: "draft" | "ordered" | "partial" | "completed" | "cancelled";
          subtotal?: number;
          discount_amount?: number;
          tax_amount?: number;
          total?: number;
          paid?: number;
          debt?: number;
          note?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_orders_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey";
            columns: ["supplier_id"];
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_order_items: {
        Row: {
          id: string;
          purchase_order_id: string;
          product_id: string;
          product_name: string;
          unit: string;
          quantity: number;
          received_quantity: number;
          unit_price: number;
          discount: number;
          vat_rate: number;
          vat_amount: number;
          total: number;
        };
        Insert: {
          id?: string;
          purchase_order_id: string;
          product_id: string;
          product_name: string;
          unit?: string;
          quantity: number;
          received_quantity?: number;
          unit_price: number;
          discount?: number;
          vat_rate?: number;
          vat_amount?: number;
          total: number;
        };
        Update: {
          quantity?: number;
          received_quantity?: number;
          unit_price?: number;
          discount?: number;
          vat_rate?: number;
          vat_amount?: number;
          total?: number;
        };
        Relationships: [
          {
            foreignKeyName: "po_items_purchase_order_id_fkey";
            columns: ["purchase_order_id"];
            referencedRelation: "purchase_orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "po_items_product_id_fkey";
            columns: ["product_id"];
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_movements: {
        Row: {
          id: string;
          tenant_id: string;
          branch_id: string;
          product_id: string;
          type: "in" | "out" | "adjust" | "transfer";
          quantity: number;
          reference_type: string | null;
          reference_id: string | null;
          note: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          branch_id: string;
          product_id: string;
          type: "in" | "out" | "adjust" | "transfer";
          quantity: number;
          reference_type?: string | null;
          reference_id?: string | null;
          note?: string | null;
          created_by: string;
        };
        Update: {
          note?: string | null;
        };
        Relationships: [];
      };
      cash_transactions: {
        Row: {
          id: string;
          tenant_id: string;
          branch_id: string;
          code: string;
          type: "receipt" | "payment";
          category: string;
          amount: number;
          counterparty: string | null;
          payment_method: "cash" | "transfer" | "card";
          reference_type: string | null;
          reference_id: string | null;
          note: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          branch_id: string;
          code: string;
          type: "receipt" | "payment";
          category: string;
          amount: number;
          counterparty?: string | null;
          payment_method?: "cash" | "transfer" | "card";
          reference_type?: string | null;
          reference_id?: string | null;
          note?: string | null;
          created_by: string;
        };
        Update: {
          note?: string | null;
        };
        Relationships: [];
      };
      delivery_partners: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          code: string;
          phone: string | null;
          api_key: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          code: string;
          phone?: string | null;
          api_key?: string | null;
          is_active?: boolean;
        };
        Update: {
          name?: string;
          code?: string;
          phone?: string | null;
          api_key?: string | null;
          is_active?: boolean;
        };
        Relationships: [];
      };
      shipping_orders: {
        Row: {
          id: string;
          tenant_id: string;
          invoice_id: string;
          partner_id: string | null;
          code: string;
          status: "pending" | "picked_up" | "in_transit" | "delivered" | "returned" | "cancelled";
          shipping_fee: number;
          cod_amount: number;
          receiver_name: string;
          receiver_phone: string;
          receiver_address: string;
          tracking_code: string | null;
          note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          invoice_id: string;
          partner_id?: string | null;
          code: string;
          status?: "pending" | "picked_up" | "in_transit" | "delivered" | "returned" | "cancelled";
          shipping_fee?: number;
          cod_amount?: number;
          receiver_name: string;
          receiver_phone: string;
          receiver_address: string;
          tracking_code?: string | null;
          note?: string | null;
        };
        Update: {
          status?: "pending" | "picked_up" | "in_transit" | "delivered" | "returned" | "cancelled";
          shipping_fee?: number;
          cod_amount?: number;
          tracking_code?: string | null;
          note?: string | null;
        };
        Relationships: [];
      };
      sales_returns: {
        Row: {
          id: string;
          tenant_id: string;
          branch_id: string;
          code: string;
          invoice_id: string;
          customer_id: string | null;
          customer_name: string;
          status: "draft" | "confirmed" | "completed" | "cancelled";
          total: number;
          refunded: number;
          reason: string | null;
          note: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          branch_id: string;
          code: string;
          invoice_id: string;
          customer_id?: string | null;
          customer_name?: string;
          status?: "draft" | "confirmed" | "completed" | "cancelled";
          total?: number;
          refunded?: number;
          reason?: string | null;
          note?: string | null;
          created_by: string;
        };
        Update: {
          status?: "draft" | "confirmed" | "completed" | "cancelled";
          total?: number;
          refunded?: number;
          reason?: string | null;
          note?: string | null;
        };
        Relationships: [];
      };
      return_items: {
        Row: {
          id: string;
          return_id: string;
          product_id: string;
          product_name: string;
          unit: string;
          quantity: number;
          unit_price: number;
          total: number;
        };
        Insert: {
          id?: string;
          return_id: string;
          product_id: string;
          product_name: string;
          unit?: string;
          quantity: number;
          unit_price: number;
          total: number;
        };
        Update: {
          quantity?: number;
          unit_price?: number;
          total?: number;
        };
        Relationships: [];
      };
      inventory_checks: {
        Row: {
          id: string;
          tenant_id: string;
          branch_id: string;
          code: string;
          status: "draft" | "in_progress" | "balanced" | "cancelled";
          note: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          branch_id: string;
          code: string;
          status?: "draft" | "in_progress" | "balanced" | "cancelled";
          note?: string | null;
          created_by: string;
        };
        Update: {
          status?: "draft" | "in_progress" | "balanced" | "cancelled";
          note?: string | null;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          tenant_id: string;
          user_id: string;
          type: string;
          title: string;
          description: string | null;
          is_read: boolean;
          reference_type: string | null;
          reference_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          user_id: string;
          type: string;
          title: string;
          description?: string | null;
          is_read?: boolean;
          reference_type?: string | null;
          reference_id?: string | null;
        };
        Update: {
          is_read?: boolean;
        };
        Relationships: [];
      };
      code_sequences: {
        Row: {
          id: string;
          tenant_id: string;
          entity_type: string;
          prefix: string;
          current_number: number;
          padding: number;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          entity_type: string;
          prefix: string;
          current_number?: number;
          padding?: number;
        };
        Update: {
          current_number?: number;
          prefix?: string;
          padding?: number;
        };
        Relationships: [];
      };
      audit_log: {
        Row: {
          id: string;
          tenant_id: string;
          user_id: string;
          action: string;
          entity_type: string;
          entity_id: string | null;
          old_data: Json | null;
          new_data: Json | null;
          ip_address: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          user_id: string;
          action: string;
          entity_type: string;
          entity_id?: string | null;
          old_data?: Json | null;
          new_data?: Json | null;
          ip_address?: string | null;
        };
        Update: never;
        Relationships: [];
      };
      // ============ NEW TABLES (migration 00004) ============
      favorites: {
        Row: {
          id: string;
          tenant_id: string;
          user_id: string;
          entity_type: string;
          entity_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          user_id: string;
          entity_type: string;
          entity_id: string;
          created_at?: string;
        };
        Update: {
          entity_type?: string;
          entity_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "favorites_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      coupons: {
        Row: {
          id: string;
          tenant_id: string;
          code: string;
          name: string;
          description: string | null;
          type: "fixed" | "percent";
          value: number;
          min_order_amount: number;
          max_discount_amount: number | null;
          max_uses: number | null;
          used_count: number;
          max_uses_per_customer: number | null;
          start_date: string | null;
          end_date: string | null;
          is_active: boolean;
          applies_to: "all" | "category" | "product";
          applies_to_ids: string[];
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          code: string;
          name: string;
          description?: string | null;
          type: "fixed" | "percent";
          value: number;
          min_order_amount?: number;
          max_discount_amount?: number | null;
          max_uses?: number | null;
          used_count?: number;
          max_uses_per_customer?: number | null;
          start_date?: string | null;
          end_date?: string | null;
          is_active?: boolean;
          applies_to?: "all" | "category" | "product";
          applies_to_ids?: string[];
          created_by?: string | null;
        };
        Update: {
          code?: string;
          name?: string;
          description?: string | null;
          type?: "fixed" | "percent";
          value?: number;
          min_order_amount?: number;
          max_discount_amount?: number | null;
          max_uses?: number | null;
          used_count?: number;
          max_uses_per_customer?: number | null;
          start_date?: string | null;
          end_date?: string | null;
          is_active?: boolean;
          applies_to?: "all" | "category" | "product";
          applies_to_ids?: string[];
        };
        Relationships: [
          {
            foreignKeyName: "coupons_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      coupon_usages: {
        Row: {
          id: string;
          tenant_id: string;
          coupon_id: string;
          invoice_id: string | null;
          customer_id: string | null;
          discount_amount: number;
          used_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          coupon_id: string;
          invoice_id?: string | null;
          customer_id?: string | null;
          discount_amount: number;
          used_at?: string;
        };
        Update: {
          discount_amount?: number;
        };
        Relationships: [
          {
            foreignKeyName: "coupon_usages_coupon_id_fkey";
            columns: ["coupon_id"];
            referencedRelation: "coupons";
            referencedColumns: ["id"];
          },
        ];
      };
      promotions: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          description: string | null;
          type: "discount_percent" | "discount_fixed" | "buy_x_get_y" | "gift";
          value: number;
          min_order_amount: number;
          buy_quantity: number | null;
          get_quantity: number | null;
          applies_to: "all" | "category" | "product";
          applies_to_ids: string[];
          start_date: string;
          end_date: string;
          is_active: boolean;
          auto_apply: boolean;
          priority: number;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          description?: string | null;
          type: "discount_percent" | "discount_fixed" | "buy_x_get_y" | "gift";
          value: number;
          min_order_amount?: number;
          buy_quantity?: number | null;
          get_quantity?: number | null;
          applies_to?: "all" | "category" | "product";
          applies_to_ids?: string[];
          start_date: string;
          end_date: string;
          is_active?: boolean;
          auto_apply?: boolean;
          priority?: number;
          created_by?: string | null;
        };
        Update: {
          name?: string;
          description?: string | null;
          type?: "discount_percent" | "discount_fixed" | "buy_x_get_y" | "gift";
          value?: number;
          min_order_amount?: number;
          buy_quantity?: number | null;
          get_quantity?: number | null;
          applies_to?: "all" | "category" | "product";
          applies_to_ids?: string[];
          start_date?: string;
          end_date?: string;
          is_active?: boolean;
          auto_apply?: boolean;
          priority?: number;
        };
        Relationships: [
          {
            foreignKeyName: "promotions_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      loyalty_settings: {
        Row: {
          id: string;
          tenant_id: string;
          is_enabled: boolean;
          points_per_amount: number;
          amount_per_point: number;
          redemption_points: number;
          redemption_value: number;
          max_redemption_percent: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          is_enabled?: boolean;
          points_per_amount?: number;
          amount_per_point?: number;
          redemption_points?: number;
          redemption_value?: number;
          max_redemption_percent?: number;
        };
        Update: {
          is_enabled?: boolean;
          points_per_amount?: number;
          amount_per_point?: number;
          redemption_points?: number;
          redemption_value?: number;
          max_redemption_percent?: number;
        };
        Relationships: [
          {
            foreignKeyName: "loyalty_settings_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      loyalty_tiers: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          min_points: number;
          discount_percent: number;
          sort_order: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          min_points?: number;
          discount_percent?: number;
          sort_order?: number;
          is_active?: boolean;
        };
        Update: {
          name?: string;
          min_points?: number;
          discount_percent?: number;
          sort_order?: number;
          is_active?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "loyalty_tiers_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      loyalty_transactions: {
        Row: {
          id: string;
          tenant_id: string;
          customer_id: string;
          type: "earn" | "redeem" | "adjust" | "expire";
          points: number;
          balance_after: number;
          reference_type: string | null;
          reference_id: string | null;
          note: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          customer_id: string;
          type: "earn" | "redeem" | "adjust" | "expire";
          points: number;
          balance_after?: number;
          reference_type?: string | null;
          reference_id?: string | null;
          note?: string | null;
          created_by?: string | null;
        };
        Update: {
          note?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "loyalty_transactions_customer_id_fkey";
            columns: ["customer_id"];
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      online_orders: {
        Row: {
          id: string;
          tenant_id: string;
          channel_id: string | null;
          channel_name: string;
          external_order_id: string | null;
          code: string;
          customer_id: string | null;
          customer_name: string;
          customer_phone: string | null;
          customer_address: string | null;
          items: Json;
          subtotal: number;
          discount_amount: number;
          shipping_fee: number;
          total_amount: number;
          status: "pending" | "confirmed" | "shipping" | "completed" | "cancelled";
          payment_status: "unpaid" | "paid" | "refunded";
          note: string | null;
          invoice_id: string | null;
          shipping_order_id: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          channel_id?: string | null;
          channel_name: string;
          external_order_id?: string | null;
          code: string;
          customer_id?: string | null;
          customer_name: string;
          customer_phone?: string | null;
          customer_address?: string | null;
          items?: Json;
          subtotal?: number;
          discount_amount?: number;
          shipping_fee?: number;
          total_amount?: number;
          status?: "pending" | "confirmed" | "shipping" | "completed" | "cancelled";
          payment_status?: "unpaid" | "paid" | "refunded";
          note?: string | null;
          invoice_id?: string | null;
          shipping_order_id?: string | null;
          created_by?: string | null;
        };
        Update: {
          channel_name?: string;
          customer_name?: string;
          customer_phone?: string | null;
          customer_address?: string | null;
          items?: Json;
          subtotal?: number;
          discount_amount?: number;
          shipping_fee?: number;
          total_amount?: number;
          status?: "pending" | "confirmed" | "shipping" | "completed" | "cancelled";
          payment_status?: "unpaid" | "paid" | "refunded";
          note?: string | null;
          invoice_id?: string | null;
          shipping_order_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "online_orders_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "online_orders_customer_id_fkey";
            columns: ["customer_id"];
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      conversations: {
        Row: {
          id: string;
          tenant_id: string;
          channel_name: "facebook" | "zalo";
          external_id: string | null;
          customer_id: string | null;
          customer_name: string;
          customer_avatar: string | null;
          last_message: string | null;
          last_message_at: string | null;
          unread_count: number;
          status: "open" | "closed" | "archived";
          assigned_to: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          channel_name: "facebook" | "zalo";
          external_id?: string | null;
          customer_id?: string | null;
          customer_name: string;
          customer_avatar?: string | null;
          last_message?: string | null;
          last_message_at?: string | null;
          unread_count?: number;
          status?: "open" | "closed" | "archived";
          assigned_to?: string | null;
        };
        Update: {
          customer_name?: string;
          customer_avatar?: string | null;
          last_message?: string | null;
          last_message_at?: string | null;
          unread_count?: number;
          status?: "open" | "closed" | "archived";
          assigned_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "conversations_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      conversation_messages: {
        Row: {
          id: string;
          conversation_id: string;
          sender_type: "customer" | "shop" | "system";
          sender_name: string | null;
          content: string;
          message_type: "text" | "image" | "product" | "order";
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          sender_type: "customer" | "shop" | "system";
          sender_name?: string | null;
          content: string;
          message_type?: "text" | "image" | "product" | "order";
          metadata?: Json | null;
          created_at?: string;
        };
        Update: {
          content?: string;
          metadata?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      sales_channels: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          type: string;
          config: Json;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          type: string;
          config?: Json;
          is_active?: boolean;
        };
        Update: {
          name?: string;
          type?: string;
          config?: Json;
          is_active?: boolean;
        };
        Relationships: [];
      };
      // ============ NEW TABLES (manufacturing, variants, lots, pipelines) ============
      product_variants: {
        Row: {
          id: string;
          tenant_id: string;
          product_id: string;
          sku: string | null;
          name: string;
          packaging_type: string | null;
          packaging_size: string | null;
          unit_count: number;
          barcode: string | null;
          sell_price: number;
          cost_price: number;
          weight: number | null;
          is_default: boolean;
          is_active: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          product_id: string;
          sku?: string | null;
          name: string;
          packaging_type?: string | null;
          packaging_size?: string | null;
          unit_count?: number;
          barcode?: string | null;
          sell_price: number;
          cost_price?: number;
          weight?: number | null;
          is_default?: boolean;
          is_active?: boolean;
          sort_order?: number;
        };
        Update: {
          product_id?: string;
          sku?: string | null;
          name?: string;
          packaging_type?: string | null;
          packaging_size?: string | null;
          unit_count?: number;
          barcode?: string | null;
          sell_price?: number;
          cost_price?: number;
          weight?: number | null;
          is_default?: boolean;
          is_active?: boolean;
          sort_order?: number;
        };
        Relationships: [];
      };
      bom: {
        Row: {
          id: string;
          tenant_id: string;
          product_id: string;
          variant_id: string | null;
          code: string | null;
          name: string;
          version: number;
          is_active: boolean;
          batch_size: number;
          yield_qty: number;
          yield_unit: string;
          note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          product_id: string;
          variant_id?: string | null;
          code?: string | null;
          name: string;
          version?: number;
          is_active?: boolean;
          batch_size?: number;
          yield_qty?: number;
          yield_unit?: string;
          note?: string | null;
        };
        Update: {
          product_id?: string;
          variant_id?: string | null;
          code?: string | null;
          name?: string;
          version?: number;
          is_active?: boolean;
          batch_size?: number;
          yield_qty?: number;
          yield_unit?: string;
          note?: string | null;
        };
        Relationships: [];
      };
      bom_items: {
        Row: {
          id: string;
          bom_id: string;
          material_id: string;
          quantity: number;
          unit: string;
          waste_percent: number;
          sort_order: number;
          note: string | null;
        };
        Insert: {
          id?: string;
          bom_id: string;
          material_id: string;
          quantity: number;
          unit?: string;
          waste_percent?: number;
          sort_order?: number;
          note?: string | null;
        };
        Update: {
          bom_id?: string;
          material_id?: string;
          quantity?: number;
          unit?: string;
          waste_percent?: number;
          sort_order?: number;
          note?: string | null;
        };
        Relationships: [];
      };
      uom_conversions: {
        Row: {
          id: string;
          tenant_id: string;
          product_id: string;
          from_unit: string;
          to_unit: string;
          factor: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          product_id: string;
          from_unit: string;
          to_unit: string;
          factor: number;
          is_active?: boolean;
        };
        Update: {
          product_id?: string;
          from_unit?: string;
          to_unit?: string;
          factor?: number;
          is_active?: boolean;
        };
        Relationships: [];
      };
      branch_stock: {
        Row: {
          id: string;
          tenant_id: string;
          branch_id: string;
          product_id: string;
          variant_id: string | null;
          quantity: number;
          reserved: number;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          branch_id: string;
          product_id: string;
          variant_id?: string | null;
          quantity?: number;
          reserved?: number;
        };
        Update: {
          branch_id?: string;
          product_id?: string;
          variant_id?: string | null;
          quantity?: number;
          reserved?: number;
        };
        Relationships: [];
      };
      group_code_sequences: {
        Row: {
          id: string;
          tenant_id: string;
          prefix: string;
          group_code: string;
          current_number: number;
          padding: number;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          prefix: string;
          group_code: string;
          current_number?: number;
          padding?: number;
        };
        Update: {
          prefix?: string;
          group_code?: string;
          current_number?: number;
          padding?: number;
        };
        Relationships: [];
      };
      production_orders: {
        Row: {
          id: string;
          tenant_id: string;
          code: string;
          branch_id: string;
          bom_id: string;
          product_id: string;
          variant_id: string | null;
          planned_qty: number;
          completed_qty: number;
          status: string;
          lot_number: string | null;
          planned_start: string | null;
          planned_end: string | null;
          actual_start: string | null;
          actual_end: string | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          code: string;
          branch_id: string;
          bom_id: string;
          product_id: string;
          variant_id?: string | null;
          planned_qty: number;
          completed_qty?: number;
          status?: string;
          lot_number?: string | null;
          planned_start?: string | null;
          planned_end?: string | null;
          actual_start?: string | null;
          actual_end?: string | null;
          notes?: string | null;
          created_by?: string | null;
        };
        Update: {
          code?: string;
          branch_id?: string;
          bom_id?: string;
          product_id?: string;
          variant_id?: string | null;
          planned_qty?: number;
          completed_qty?: number;
          status?: string;
          lot_number?: string | null;
          planned_start?: string | null;
          planned_end?: string | null;
          actual_start?: string | null;
          actual_end?: string | null;
          notes?: string | null;
          created_by?: string | null;
        };
        Relationships: [];
      };
      production_order_materials: {
        Row: {
          id: string;
          production_order_id: string;
          product_id: string;
          planned_qty: number;
          actual_qty: number | null;
          unit: string;
          note: string | null;
        };
        Insert: {
          id?: string;
          production_order_id: string;
          product_id: string;
          planned_qty: number;
          actual_qty?: number | null;
          unit: string;
          note?: string | null;
        };
        Update: {
          production_order_id?: string;
          product_id?: string;
          planned_qty?: number;
          actual_qty?: number | null;
          unit?: string;
          note?: string | null;
        };
        Relationships: [];
      };
      product_lots: {
        Row: {
          id: string;
          tenant_id: string;
          product_id: string;
          variant_id: string | null;
          lot_number: string;
          source_type: string;
          production_order_id: string | null;
          purchase_order_id: string | null;
          supplier_id: string | null;
          manufactured_date: string | null;
          expiry_date: string | null;
          received_date: string;
          initial_qty: number;
          current_qty: number;
          branch_id: string;
          status: string;
          note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          product_id: string;
          variant_id?: string | null;
          lot_number: string;
          source_type: string;
          production_order_id?: string | null;
          purchase_order_id?: string | null;
          supplier_id?: string | null;
          manufactured_date?: string | null;
          expiry_date?: string | null;
          received_date: string;
          initial_qty: number;
          current_qty?: number;
          branch_id: string;
          status?: string;
          note?: string | null;
        };
        Update: {
          product_id?: string;
          variant_id?: string | null;
          lot_number?: string;
          source_type?: string;
          production_order_id?: string | null;
          purchase_order_id?: string | null;
          supplier_id?: string | null;
          manufactured_date?: string | null;
          expiry_date?: string | null;
          received_date?: string;
          initial_qty?: number;
          current_qty?: number;
          branch_id?: string;
          status?: string;
          note?: string | null;
        };
        Relationships: [];
      };
      lot_allocations: {
        Row: {
          id: string;
          tenant_id: string;
          lot_id: string;
          source_type: string;
          source_id: string;
          quantity: number;
          allocated_at: string;
          allocated_by: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          lot_id: string;
          source_type: string;
          source_id: string;
          quantity: number;
          allocated_at?: string;
          allocated_by?: string | null;
        };
        Update: {
          lot_id?: string;
          source_type?: string;
          source_id?: string;
          quantity?: number;
          allocated_at?: string;
          allocated_by?: string | null;
        };
        Relationships: [];
      };
      price_tiers: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          code: string;
          description: string | null;
          priority: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          code: string;
          description?: string | null;
          priority?: number;
          is_active?: boolean;
        };
        Update: {
          name?: string;
          code?: string;
          description?: string | null;
          priority?: number;
          is_active?: boolean;
        };
        Relationships: [];
      };
      price_tier_items: {
        Row: {
          id: string;
          price_tier_id: string;
          product_id: string;
          variant_id: string | null;
          price: number;
          min_qty: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          price_tier_id: string;
          product_id: string;
          variant_id?: string | null;
          price: number;
          min_qty?: number;
        };
        Update: {
          price_tier_id?: string;
          product_id?: string;
          variant_id?: string | null;
          price?: number;
          min_qty?: number;
        };
        Relationships: [];
      };
      pipelines: {
        Row: {
          id: string;
          tenant_id: string;
          entity_type: string;
          name: string;
          description: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          entity_type: string;
          name: string;
          description?: string | null;
          is_active?: boolean;
        };
        Update: {
          entity_type?: string;
          name?: string;
          description?: string | null;
          is_active?: boolean;
        };
        Relationships: [];
      };
      pipeline_stages: {
        Row: {
          id: string;
          pipeline_id: string;
          code: string;
          name: string;
          color: string | null;
          icon: string | null;
          sort_order: number;
          is_initial: boolean;
          is_final: boolean;
          validation_rules: Json | null;
          metadata: Json | null;
        };
        Insert: {
          id?: string;
          pipeline_id: string;
          code: string;
          name: string;
          color?: string | null;
          icon?: string | null;
          sort_order?: number;
          is_initial?: boolean;
          is_final?: boolean;
          validation_rules?: Json | null;
          metadata?: Json | null;
        };
        Update: {
          pipeline_id?: string;
          code?: string;
          name?: string;
          color?: string | null;
          icon?: string | null;
          sort_order?: number;
          is_initial?: boolean;
          is_final?: boolean;
          validation_rules?: Json | null;
          metadata?: Json | null;
        };
        Relationships: [];
      };
      pipeline_transitions: {
        Row: {
          id: string;
          pipeline_id: string;
          from_stage_id: string;
          to_stage_id: string;
          name: string | null;
          required_role: string | null;
          conditions: Json | null;
          auto_trigger: boolean;
        };
        Insert: {
          id?: string;
          pipeline_id: string;
          from_stage_id: string;
          to_stage_id: string;
          name?: string | null;
          required_role?: string | null;
          conditions?: Json | null;
          auto_trigger?: boolean;
        };
        Update: {
          pipeline_id?: string;
          from_stage_id?: string;
          to_stage_id?: string;
          name?: string | null;
          required_role?: string | null;
          conditions?: Json | null;
          auto_trigger?: boolean;
        };
        Relationships: [];
      };
      pipeline_items: {
        Row: {
          id: string;
          tenant_id: string;
          pipeline_id: string;
          entity_id: string;
          current_stage_id: string;
          dimensions: Json;
          entered_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          pipeline_id: string;
          entity_id: string;
          current_stage_id: string;
          dimensions?: Json;
        };
        Update: {
          pipeline_id?: string;
          entity_id?: string;
          current_stage_id?: string;
          dimensions?: Json;
        };
        Relationships: [];
      };
      pipeline_history: {
        Row: {
          id: string;
          pipeline_item_id: string;
          from_stage_id: string | null;
          to_stage_id: string;
          transition_id: string | null;
          changed_by: string | null;
          changed_at: string;
          note: string | null;
          metadata: Json | null;
        };
        Insert: {
          id?: string;
          pipeline_item_id: string;
          from_stage_id?: string | null;
          to_stage_id: string;
          transition_id?: string | null;
          changed_by?: string | null;
          changed_at?: string;
          note?: string | null;
          metadata?: Json | null;
        };
        Update: {
          pipeline_item_id?: string;
          from_stage_id?: string | null;
          to_stage_id?: string;
          transition_id?: string | null;
          changed_by?: string | null;
          changed_at?: string;
          note?: string | null;
          metadata?: Json | null;
        };
        Relationships: [];
      };
      pipeline_automations: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          trigger_pipeline_id: string;
          trigger_stage_id: string;
          action_type: string;
          action_config: Json;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          trigger_pipeline_id: string;
          trigger_stage_id: string;
          action_type: string;
          action_config: Json;
          is_active?: boolean;
        };
        Update: {
          name?: string;
          trigger_pipeline_id?: string;
          trigger_stage_id?: string;
          action_type?: string;
          action_config?: Json;
          is_active?: boolean;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      next_code: {
        Args: {
          p_tenant_id: string;
          p_entity_type: string;
        };
        Returns: string;
      };
      toggle_favorite: {
        Args: {
          p_entity_type: string;
          p_entity_id: string;
        };
        Returns: boolean;
      };
      validate_coupon: {
        Args: {
          p_code: string;
          p_order_amount: number;
          p_customer_id?: string;
        };
        Returns: Json;
      };
      earn_loyalty_points: {
        Args: {
          p_customer_id: string;
          p_invoice_id: string;
          p_amount: number;
        };
        Returns: number;
      };
      next_group_code: {
        Args: {
          p_tenant_id: string;
          p_prefix: string;
          p_group_code: string;
        };
        Returns: string;
      };
      calculate_bom_cost: {
        Args: {
          p_bom_id: string;
        };
        Returns: Json;
      };
      consume_production_materials: {
        Args: {
          p_production_order_id: string;
        };
        Returns: undefined;
      };
      complete_production_order: {
        Args: {
          p_production_order_id: string;
          p_completed_qty: number;
          p_lot_number?: string;
          p_manufactured_date?: string;
          p_expiry_date?: string;
        };
        Returns: string;
      };
      allocate_lots_fifo: {
        Args: {
          p_tenant_id: string;
          p_product_id: string;
          p_branch_id: string;
          p_quantity: number;
          p_source_type: string;
          p_source_id: string;
          p_allocated_by?: string;
        };
        Returns: Json;
      };
      get_lots_for_product: {
        Args: {
          p_product_id: string;
          p_branch_id?: string;
        };
        Returns: Json;
      };
      check_expiring_lots: {
        Args: {
          p_tenant_id: string;
          p_days_threshold?: number;
        };
        Returns: Json;
      };
      pipeline_transition: {
        Args: {
          p_pipeline_item_id: string;
          p_to_stage_id: string;
          p_changed_by?: string;
          p_note?: string;
          p_dimensions?: Json;
        };
        Returns: Json;
      };
      pipeline_get_allowed_transitions: {
        Args: {
          p_pipeline_item_id: string;
        };
        Returns: Json;
      };
      pipeline_get_board: {
        Args: {
          p_pipeline_id: string;
        };
        Returns: Json;
      };
      pipeline_get_timeline: {
        Args: {
          p_pipeline_item_id: string;
        };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
