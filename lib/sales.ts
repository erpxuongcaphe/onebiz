import { supabase } from './supabaseClient';

export type CustomerRow = {
  id: string;
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
};

export async function fetchCustomers(): Promise<CustomerRow[]> {
  if (!supabase) return [];
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return [];

  const { data, error } = await supabase
    .from('sales_customers')
    .select('id, code, name, email, phone, status')
    .order('created_at', { ascending: false })
    .returns<CustomerRow[]>();

  if (error) return [];
  return data ?? [];
}
