import { supabase } from './supabaseClient';

export type CustomerRow = {
  id: string;
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
};

function buildCustomerCode() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(16).slice(2, 6).toUpperCase();
  return `CUST-${stamp}-${rand}`;
}

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

export async function getWalkInCustomer(): Promise<CustomerRow | null> {
  if (!supabase) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return null;

  const { data } = await supabase
    .from('sales_customers')
    .select('id, code, name, email, phone, status')
    .eq('code', 'WALKIN')
    .maybeSingle();

  return (data as CustomerRow) ?? null;
}

export async function createCustomer(params: {
  name: string;
  phone?: string;
  email?: string;
}): Promise<CustomerRow | null> {
  if (!supabase) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return null;
  const code = buildCustomerCode();
  const { data, error } = await supabase
    .from('sales_customers')
    .insert({
      code,
      name: params.name,
      phone: params.phone ?? null,
      email: params.email ?? null,
      status: 'active',
    })
    .select('id, code, name, email, phone, status')
    .maybeSingle();

  if (error) return null;
  return (data as CustomerRow) ?? null;
}
