// POS Types

export type OrderType = 'dine_in' | 'takeaway' | 'delivery';
export type OrderStatus = 'draft' | 'confirmed' | 'preparing' | 'ready' | 'completed' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'partial' | 'paid';
export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'momo' | 'zalopay' | 'mixed';
export type ItemStatus = 'pending' | 'preparing' | 'ready' | 'served' | 'cancelled';
export type DiscountType = 'percent' | 'fixed';

export interface Order {
    id: string;
    branch_id: string;
    table_id?: string;
    order_number: string;
    order_type: OrderType;
    status: OrderStatus;

    customer_name?: string;
    customer_phone?: string;

    subtotal: number;
    discount_type: DiscountType;
    discount_value: number;
    discount_amount: number;
    tax_rate: number;
    tax_amount: number;
    total: number;

    payment_status: PaymentStatus;
    payment_method?: PaymentMethod;
    amount_paid: number;
    change_amount: number;

    notes?: string;
    kitchen_notes?: string;

    created_by?: string;
    served_by?: string;
    completed_at?: string;
    created_at: string;
    updated_at: string;

    // Joined fields
    items?: OrderItem[];
    table?: POSTable;
}

export interface OrderItem {
    id: string;
    order_id: string;
    product_id: string;
    product_name: string;
    quantity: number;
    unit_price: number;
    discount_type: DiscountType;
    discount_value: number;
    discount_amount: number;
    line_total: number;
    notes?: string;
    status: ItemStatus;
    created_at: string;

    // Joined fields
    product?: {
        id: string;
        name: string;
        code: string;
        image_url?: string;
        category?: { name: string };
    };
}

export interface FloorZone {
    id: string;
    branch_id: string;
    name: string;
    shape_type: string;
    shape_data: Record<string, unknown>;
    color: string;
    position_x: number;
    position_y: number;
    width: number;
    height: number;
    sort_order: number;
    is_active: boolean;

    // Joined
    tables?: POSTable[];
}

export interface POSTable {
    id: string;
    branch_id: string;
    zone_id?: string;
    table_number: string;
    name?: string;
    seat_count: number;
    table_type: string;
    position_x: number;
    position_y: number;
    width: number;
    height: number;
    rotation: number;
    is_active: boolean;
    current_order_id?: string;

    // Joined
    current_order?: Order;
    zone?: FloorZone;
}

// Input types for creating/updating
export interface CreateOrderInput {
    branch_id: string;
    table_id?: string;
    order_type: OrderType;
    customer_name?: string;
    customer_phone?: string;
    notes?: string;
    items: CreateOrderItemInput[];
}

export interface CreateOrderItemInput {
    product_id: string;
    product_name: string;
    quantity: number;
    unit_price: number;
    notes?: string;
}

export interface UpdateOrderInput {
    status?: OrderStatus;
    discount_type?: DiscountType;
    discount_value?: number;
    tax_rate?: number;
    notes?: string;
    kitchen_notes?: string;
}

export interface ProcessPaymentInput {
    payment_method: PaymentMethod;
    amount_paid: number;
}

// Cart state (client-side)
export interface CartItem {
    product_id: string;
    product_name: string;
    product_code: string;
    image_url?: string;
    quantity: number;
    unit_price: number;
    notes?: string;
}
