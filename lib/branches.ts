import { supabase } from './supabaseClient';

export type Branch = {
  id: string;
  code: string;
  name: string;
  status: string;
};

export async function fetchBranches(): Promise<Branch[]> {
  if (!supabase) return [];
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return [];

  const { data, error } = await supabase
    .from('branches')
    .select('id, code, name, status')
    .order('created_at', { ascending: true })
    .returns<Branch[]>();

  if (error) return [];
  return data ?? [];
}

export async function fetchCurrentBranchId(): Promise<string | null> {
  if (!supabase) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return null;

  const { data, error } = await supabase.rpc('current_branch_id');
  if (error) return null;
  return (data as any) ?? null;
}

export async function setMyBranch(branchId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return false;

  const { error } = await supabase.rpc('set_my_branch', { p_branch_id: branchId });
  return !error;
}
