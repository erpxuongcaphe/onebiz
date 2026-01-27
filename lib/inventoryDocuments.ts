import { supabase } from './supabaseClient';

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export type InventoryDocument = {
  id: string;
  branch_id: string;
  doc_number: string;
  doc_type: 'receipt' | 'issue' | 'transfer';
  status: 'draft' | 'posted' | 'void';
  doc_date: string;
  warehouse_from_id: string | null;
  warehouse_to_id: string | null;
  notes: string | null;
  created_at: string;
};

export async function fetchInventoryDocuments(params: {
  branchId?: string;
  docType?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
  warehouseId?: string;
}): Promise<InventoryDocument[]> {
  if (!supabase) return [];
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return [];

  let q = supabase
    .from('inventory_documents')
    .select('id, branch_id, doc_number, doc_type, status, doc_date, warehouse_from_id, warehouse_to_id, notes, created_at')
    .order('doc_date', { ascending: false })
    .limit(100);

  if (params.branchId) q = q.eq('branch_id', params.branchId);
  if (params.docType) q = q.eq('doc_type', params.docType);
  if (params.status) q = q.eq('status', params.status);
  if (params.fromDate) q = q.gte('doc_date', params.fromDate);
  if (params.toDate) q = q.lte('doc_date', params.toDate);
  if (params.warehouseId) {
    q = q.or(`warehouse_from_id.eq.${params.warehouseId},warehouse_to_id.eq.${params.warehouseId}`);
  }

  const { data, error } = await q;
  if (error || !data) return [];
  return (data as any[]).map((d) => ({
    id: d.id,
    branch_id: d.branch_id,
    doc_number: d.doc_number,
    doc_type: d.doc_type,
    status: d.status,
    doc_date: d.doc_date,
    warehouse_from_id: d.warehouse_from_id,
    warehouse_to_id: d.warehouse_to_id,
    notes: d.notes,
    created_at: d.created_at,
  }));
}

export async function createInventoryDocument(input: {
  branch_id: string;
  doc_type: 'receipt' | 'issue' | 'transfer';
  doc_number: string;
  doc_date: string;
  warehouse_from_id?: string | null;
  warehouse_to_id?: string | null;
  notes?: string | null;
}): Promise<string | null> {
  if (!supabase) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return null;

  const { data, error } = await supabase
    .from('inventory_documents')
    .insert({
      branch_id: input.branch_id,
      doc_type: input.doc_type,
      doc_number: input.doc_number,
      doc_date: input.doc_date,
      warehouse_from_id: input.warehouse_from_id ?? null,
      warehouse_to_id: input.warehouse_to_id ?? null,
      notes: input.notes ?? null,
      created_by: sessionData.session.user.id,
    })
    .select('id')
    .single();

  if (error) return null;
  return (data as any)?.id ?? null;
}

export async function updateInventoryDocument(documentId: string, patch: {
  warehouse_from_id?: string | null;
  warehouse_to_id?: string | null;
  notes?: string | null;
}): Promise<boolean> {
  if (!supabase) return false;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return false;

  const { error } = await supabase
    .from('inventory_documents')
    .update({
      ...(patch.warehouse_from_id !== undefined ? { warehouse_from_id: patch.warehouse_from_id } : {}),
      ...(patch.warehouse_to_id !== undefined ? { warehouse_to_id: patch.warehouse_to_id } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    })
    .eq('id', documentId);

  return !error;
}

export type InventoryDocumentLine = {
  id: string;
  product_id: string;
  quantity: number;
  unit_cost: number;
  notes: string | null;
};

export async function fetchInventoryDocumentLines(documentId: string): Promise<InventoryDocumentLine[]> {
  if (!supabase) return [];
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return [];

  const { data, error } = await supabase
    .from('inventory_document_lines')
    .select('id, product_id, quantity, unit_cost, notes')
    .eq('document_id', documentId)
    .order('created_at', { ascending: true });

  if (error || !data) return [];
  return (data as any[]).map((l) => ({
    id: l.id,
    product_id: l.product_id,
    quantity: toNumber(l.quantity),
    unit_cost: toNumber(l.unit_cost),
    notes: l.notes ?? null,
  }));
}

export async function updateInventoryDocumentLine(lineId: string, patch: { quantity?: number; unit_cost?: number | null; notes?: string | null }): Promise<boolean> {
  if (!supabase) return false;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return false;

  const { error } = await supabase
    .from('inventory_document_lines')
    .update({
      ...(patch.quantity !== undefined ? { quantity: patch.quantity } : {}),
      ...(patch.unit_cost !== undefined ? { unit_cost: patch.unit_cost } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    })
    .eq('id', lineId);

  return !error;
}

export async function deleteInventoryDocumentLine(lineId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return false;

  const { error } = await supabase
    .from('inventory_document_lines')
    .delete()
    .eq('id', lineId);

  return !error;
}

export async function voidInventoryDocument(documentId: string, reason?: string): Promise<boolean> {
  if (!supabase) return false;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return false;

  const { error } = await supabase.rpc('inventory_void_document', {
    p_document_id: documentId,
    p_reason: reason ?? null,
  });
  return !error;
}

export type ProductPick = { id: string; sku: string; name: string; price: number };

export async function fetchProductsForPick(): Promise<ProductPick[]> {
  if (!supabase) return [];
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return [];

  const { data, error } = await supabase
    .from('inventory_products')
    .select('id, sku, name, selling_price')
    .neq('status', 'inactive')
    .order('name', { ascending: true });

  if (error || !data) return [];
  return (data as any[]).map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    price: toNumber(p.selling_price),
  }));
}

export async function addInventoryDocumentLine(input: {
  document_id: string;
  product_id: string;
  quantity: number;
  unit_cost?: number | null;
  notes?: string | null;
}): Promise<boolean> {
  if (!supabase) return false;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return false;

  const { error } = await supabase
    .from('inventory_document_lines')
    .insert({
      document_id: input.document_id,
      product_id: input.product_id,
      quantity: input.quantity,
      unit_cost: input.unit_cost ?? null,
      notes: input.notes ?? null,
    });

  return !error;
}

export async function postInventoryDocument(documentId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return false;

  const { error } = await supabase.rpc('inventory_post_document', { p_document_id: documentId });
  return !error;
}
