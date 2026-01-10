// TypeScript types for Branch module

export interface Branch {
    id: string;
    code: string;
    name: string;
    address?: string;
    phone?: string;
    email?: string;
    is_headquarters: boolean;
    is_warehouse: boolean;
    is_pos_enabled: boolean;
    is_active: boolean;
    settings: BranchSettings;
    created_at: string;
    updated_at: string;
}

export interface BranchSettings {
    timezone?: string;
    currency?: string;
    tax_rate?: number;
    receipt_header?: string;
    receipt_footer?: string;
    [key: string]: unknown;
}

export interface FloorZone {
    id: string;
    branch_id: string;
    name: string;
    shape_type: 'rectangle' | 'circle' | 'polygon';
    shape_data: ShapeData;
    color: string;
    position_x: number;
    position_y: number;
    width: number;
    height: number;
    sort_order: number;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

export interface ShapeData {
    points?: { x: number; y: number }[]; // For polygon
    radius?: number; // For circle
    [key: string]: unknown;
}

export interface Table {
    id: string;
    branch_id: string;
    zone_id?: string;
    table_number: string;
    name?: string;
    seat_count: number;
    table_type: 'square' | 'round' | 'long' | 'sofa' | 'bar_stool';
    position_x: number;
    position_y: number;
    width: number;
    height: number;
    rotation: number;
    is_active: boolean;
    created_at: string;
    updated_at: string;
    // Runtime status (not in DB)
    status?: 'available' | 'occupied' | 'reserved';
    current_order_id?: string;
    guest_count?: number;
}

export interface UserBranch {
    id: string;
    user_id: string;
    branch_id: string;
    can_view_other_branches: boolean;
    is_default: boolean;
    created_at: string;
    // Joined data
    branch?: Branch;
}

export interface FloorPlan {
    branch: Branch;
    zones: FloorZone[];
    tables: Table[];
}

// Input types for create/update
export interface CreateBranchInput {
    code: string;
    name: string;
    address?: string;
    phone?: string;
    email?: string;
    is_headquarters?: boolean;
    is_warehouse?: boolean;
    is_pos_enabled?: boolean;
    settings?: BranchSettings;
}

export interface UpdateBranchInput {
    code?: string;
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    is_headquarters?: boolean;
    is_warehouse?: boolean;
    is_pos_enabled?: boolean;
    is_active?: boolean;
    settings?: BranchSettings;
}

export interface CreateFloorZoneInput {
    branch_id: string;
    name: string;
    shape_type?: 'rectangle' | 'circle' | 'polygon';
    shape_data?: ShapeData;
    color?: string;
    position_x?: number;
    position_y?: number;
    width?: number;
    height?: number;
    sort_order?: number;
}

export interface CreateTableInput {
    branch_id: string;
    zone_id?: string;
    table_number: string;
    name?: string;
    seat_count?: number;
    table_type?: 'square' | 'round' | 'long' | 'sofa' | 'bar_stool';
    position_x?: number;
    position_y?: number;
    width?: number;
    height?: number;
    rotation?: number;
}
