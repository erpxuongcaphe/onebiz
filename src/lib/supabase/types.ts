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
        };
        Update: {
          name?: string;
          address?: string | null;
          phone?: string | null;
          is_default?: boolean;
          is_active?: boolean;
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
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          parent_id?: string | null;
          sort_order?: number;
        };
        Update: {
          name?: string;
          parent_id?: string | null;
          sort_order?: number;
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
          total: number;
        };
        Update: {
          quantity?: number;
          unit_price?: number;
          discount?: number;
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
          total: number;
        };
        Update: {
          quantity?: number;
          received_quantity?: number;
          unit_price?: number;
          discount?: number;
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
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
