import { supabase } from '@/lib/supabase';
import type {
    Branch,
    FloorZone,
    Table,
    UserBranch,
    FloorPlan,
    CreateBranchInput,
    UpdateBranchInput,
    CreateFloorZoneInput,
    CreateTableInput
} from '@/lib/types/branch';

// ============================================
// BRANCHES
// ============================================

// Helper to map database row to Branch type (handles missing columns from old schema)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapToBranch(row: any): Branch {
    return {
        id: row.id,
        code: row.code || row.name?.substring(0, 3).toUpperCase() || 'BR',
        name: row.name,
        address: row.address || undefined,
        phone: row.phone || undefined,
        email: row.email || undefined,
        is_headquarters: row.is_headquarters ?? row.is_office ?? false,
        is_warehouse: row.is_warehouse ?? false,
        is_pos_enabled: row.is_pos_enabled ?? true,
        is_active: row.is_active ?? true,
        settings: row.settings || {},
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

export async function getBranches(): Promise<Branch[]> {
    const { data, error } = await supabase
        .from('branches')
        .select('*')
        .order('name');

    if (error) throw new Error(`Lỗi tải danh sách chi nhánh: ${error.message}`);

    // Filter active branches and map to Branch type
    const branches = (data || [])
        .filter((row) => row.is_active !== false)
        .map(mapToBranch);

    // Sort: headquarters first
    return branches.sort((a, b) => {
        if (a.is_headquarters && !b.is_headquarters) return -1;
        if (!a.is_headquarters && b.is_headquarters) return 1;
        return a.name.localeCompare(b.name);
    });
}

export async function getAllBranches(): Promise<Branch[]> {
    const { data, error } = await supabase
        .from('branches')
        .select('*')
        .order('name');

    if (error) throw new Error(`Lỗi tải danh sách chi nhánh: ${error.message}`);
    return (data || []).map(mapToBranch);
}

export async function getBranchById(id: string): Promise<Branch | null> {
    const { data, error } = await supabase
        .from('branches')
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null;
        throw new Error(`Lỗi tải chi nhánh: ${error.message}`);
    }
    return mapToBranch(data);
}

export async function getBranchByCode(code: string): Promise<Branch | null> {
    // Note: 'code' column may not exist in old schema
    const branches = await getAllBranches();
    return branches.find(b => b.code === code) || null;
}

export async function createBranch(input: CreateBranchInput): Promise<Branch> {
    // Map to old schema if needed
    const insertData = {
        name: input.name,
        address: input.address,
        is_active: true,
        // New fields - will be ignored if columns don't exist
        code: input.code,
        phone: input.phone,
        email: input.email,
        is_office: input.is_headquarters,
    };

    const { data, error } = await supabase
        .from('branches')
        .insert(insertData)
        .select()
        .single();

    if (error) throw new Error(`Lỗi tạo chi nhánh: ${error.message}`);
    return mapToBranch(data);
}

export async function updateBranch(id: string, input: UpdateBranchInput): Promise<Branch> {
    const { data, error } = await supabase
        .from('branches')
        .update(input)
        .eq('id', id)
        .select()
        .single();

    if (error) throw new Error(`Lỗi cập nhật chi nhánh: ${error.message}`);
    return mapToBranch(data);
}

export async function deleteBranch(id: string): Promise<void> {
    const { error } = await supabase
        .from('branches')
        .delete()
        .eq('id', id);

    if (error) throw new Error(`Lỗi xóa chi nhánh: ${error.message}`);
}

// ============================================
// FLOOR ZONES (Requires migration to create table)
// ============================================

export async function getFloorZones(branchId: string): Promise<FloorZone[]> {
    void branchId; // Will be used after migration
    // Table doesn't exist yet - will be created by migration
    // Return empty array for now
    console.warn('floor_zones table not available yet. Run migration first.');
    return [];
}

export async function createFloorZone(input: CreateFloorZoneInput): Promise<FloorZone> {
    throw new Error('floor_zones table not available. Run migration first: ' + JSON.stringify(input));
}

export async function updateFloorZone(id: string, input: Partial<FloorZone>): Promise<FloorZone> {
    throw new Error('floor_zones table not available. Run migration first: ' + id + JSON.stringify(input));
}

export async function deleteFloorZone(id: string): Promise<void> {
    throw new Error('floor_zones table not available. Run migration first: ' + id);
}

// ============================================
// TABLES (Requires migration to create table)
// ============================================

export async function getTables(branchId: string): Promise<Table[]> {
    void branchId; // Will be used after migration
    // Table doesn't exist yet - will be created by migration
    console.warn('tables table not available yet. Run migration first.');
    return [];
}

export async function getTablesByZone(zoneId: string): Promise<Table[]> {
    void zoneId; // Will be used after migration
    console.warn('tables table not available yet. Run migration first.');
    return [];
}

export async function createTable(input: CreateTableInput): Promise<Table> {
    throw new Error('tables table not available. Run migration first: ' + JSON.stringify(input));
}

export async function updateTable(id: string, input: Partial<Table>): Promise<Table> {
    throw new Error('tables table not available. Run migration first: ' + id + JSON.stringify(input));
}

export async function deleteTable(id: string): Promise<void> {
    throw new Error('tables table not available. Run migration first: ' + id);
}

// ============================================
// FLOOR PLAN (Combined)
// ============================================

export async function getFloorPlan(branchId: string): Promise<FloorPlan | null> {
    const branch = await getBranchById(branchId);
    if (!branch) return null;

    const zones = await getFloorZones(branchId);
    const tables = await getTables(branchId);

    return { branch, zones, tables };
}

export async function saveFloorPlan(
    branchId: string,
    zones: Partial<FloorZone>[],
    tables: Partial<Table>[]
): Promise<void> {
    // Update zones
    for (const zone of zones) {
        if (zone.id) {
            await updateFloorZone(zone.id, zone);
        } else {
            await createFloorZone({ ...zone, branch_id: branchId } as CreateFloorZoneInput);
        }
    }

    // Update tables
    for (const table of tables) {
        if (table.id) {
            await updateTable(table.id, table);
        } else {
            await createTable({ ...table, branch_id: branchId } as CreateTableInput);
        }
    }
}

// ============================================
// USER BRANCHES (Requires migration to create table)
// ============================================

export async function getUserBranches(userId: string): Promise<UserBranch[]> {
    void userId; // Will be used after migration
    // Table doesn't exist yet
    console.warn('user_branches table not available yet. Run migration first.');
    return [];
}

export async function getDefaultBranch(userId: string): Promise<Branch | null> {
    void userId; // Will be used after migration
    // user_branches table doesn't exist yet, just return first branch
    try {
        const branches = await getBranches();
        if (branches.length > 0) {
            // Return first branch (headquarters will be first due to sort)
            return branches[0];
        }
    } catch (e) {
        console.error('Error getting default branch:', e);
    }

    return null;
}

export async function assignUserToBranch(
    userId: string,
    branchId: string,
    options?: { is_default?: boolean; can_view_other_branches?: boolean }
): Promise<void> {
    void userId; void branchId; void options; // Will be used after migration
    console.warn('user_branches table not available yet. Run migration first.');
}

export async function removeUserFromBranch(userId: string, branchId: string): Promise<void> {
    void userId; void branchId; // Will be used after migration
    console.warn('user_branches table not available yet. Run migration first.');
}
