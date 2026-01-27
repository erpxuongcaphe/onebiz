import { supabase } from './supabaseClient';

export type InventoryWarehouse = {
  id: string;
  name: string;
  code: string;
  branch_id?: string | null;
};

export async function fetchInventoryWarehouses(): Promise<InventoryWarehouse[]> {
  if (!supabase) return [];
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return [];

  const { data, error } = await supabase
    .from('inventory_warehouses')
    .select('id, name, code, branch_id')
    .order('created_at', { ascending: true })
    .returns<InventoryWarehouse[]>();

  if (error) return [];
  return data ?? [];
}
