import { supabaseUntyped as supabase } from "@/lib/supabase";
import {
    FloorZone,
    POSTable
} from "@/lib/types/pos";

// === ZONES ===

export async function getZones(branchId: string): Promise<FloorZone[]> {
    const { data, error } = await supabase
        .from('floor_zones')
        .select('*')
        .eq('branch_id', branchId)
        .eq('is_active', true)
        .order('sort_order');

    if (error) throw error;
    return data || [];
}

export async function createZone(zone: Partial<FloorZone>): Promise<FloorZone> {
    const { data, error } = await supabase
        .from('floor_zones')
        .insert([zone])
        .select()
        .single();

    if (error) throw error;
    return data;
}

export async function updateZone(id: string, updates: Partial<FloorZone>): Promise<FloorZone> {
    const { data, error } = await supabase
        .from('floor_zones')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;
    return data;
}

// === TABLES ===

export async function getTables(branchId: string, zoneId?: string): Promise<POSTable[]> {
    let query = supabase
        .from('pos_tables')
        .select(`
            *,
            current_order:orders(id, order_number, status, total, created_at)
        `)
        .eq('branch_id', branchId)
        .eq('is_active', true);

    if (zoneId) {
        query = query.eq('zone_id', zoneId);
    }

    const { data, error } = await query.order('table_number');

    if (error) throw error;
    return data || [];
}

export async function getTablesWithZones(branchId: string): Promise<{ zones: FloorZone[], tables: POSTable[] }> {
    const [zones, tables] = await Promise.all([
        getZones(branchId),
        getTables(branchId)
    ]);

    return { zones, tables };
}

export async function createTable(table: Partial<POSTable>): Promise<POSTable> {
    const { data, error } = await supabase
        .from('pos_tables')
        .insert([table])
        .select()
        .single();

    if (error) throw error;
    return data;
}

export async function updateTable(id: string, updates: Partial<POSTable>): Promise<POSTable> {
    const { data, error } = await supabase
        .from('pos_tables')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;
    return data;
}

export async function deleteTable(id: string): Promise<void> {
    const { error } = await supabase
        .from('pos_tables')
        .update({ is_active: false })
        .eq('id', id);

    if (error) throw error;
}
