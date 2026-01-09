export type ProductType = 'raw_material' | 'finished_product' | 'service';

export interface Unit {
    id: string;
    name: string;
    code: string;
    is_active: boolean;
}

export interface Category {
    id: string;
    name: string;
    description?: string;
    parent_id?: string;
    is_active: boolean;
    children?: Category[]; // For recursive display
}

export interface Product {
    id: string;
    code: string;
    name: string;
    category_id?: string;
    unit_id?: string;
    type: ProductType;
    cost_price: number;
    selling_price: number;
    min_stock_level: number;
    max_stock_level?: number;
    image_url?: string;
    description?: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;

    // Joined fields
    category?: Category;
    unit?: Unit;
    inventory?: BranchProduct; // Current branch inventory
}

export interface BranchProduct {
    id: string;
    branch_id: string;
    product_id: string;
    stock_quantity: number;
    average_cost: number;
    location?: string;
    min_stock_level?: number;
    max_stock_level?: number;
    last_checked_at?: string;
}

export type TransactionType = 'import' | 'export' | 'adjustment' | 'transfer_in' | 'transfer_out' | 'sale' | 'return';

export interface InventoryTransaction {
    id: string;
    branch_id: string;
    product_id: string;
    type: TransactionType;
    quantity: number;
    quantity_before?: number;
    quantity_after?: number;
    unit_price?: number;
    total_amount?: number;
    reference_id?: string;
    note?: string;
    created_by?: string;
    created_at: string;

    // Joined fields
    product?: Product;
    user_name?: string; // If we join with users
}

export interface CreateProductInput {
    code: string;
    name: string;
    category_id?: string;
    unit_id?: string;
    type: ProductType;
    cost_price?: number;
    selling_price?: number;
    min_stock_level?: number;
    max_stock_level?: number;
    description?: string;
    image_url?: string;
}

export interface UpdateProductInput extends Partial<CreateProductInput> {
    is_active?: boolean;
}

export interface UpdateStockInput {
    branch_id: string;
    product_id: string;
    quantity_change: number; // Can be negative
    type: TransactionType;
    unit_price?: number;
    reference_id?: string;
    note?: string;
    current_stock?: number; // Optional safety check
}
