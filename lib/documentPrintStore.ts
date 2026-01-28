import { supabase } from './supabaseClient';
import { getCachedTenantId } from './tenantContext';
import type { PaperSize, TemplateType } from './documentTemplates';
import type { DocumentPayload } from './documentPrint';

export async function createDocumentPrint(params: {
  template_id?: string | null;
  template_type: TemplateType;
  paper_size: PaperSize;
  source_type: 'pos_payment' | 'finance_transaction' | 'manual';
  source_id?: string | null;
  payload: DocumentPayload;
}): Promise<boolean> {
  if (!supabase) return false;
  const tenantId = getCachedTenantId();
  if (!tenantId) return false;

  const { error } = await supabase.from('document_prints').insert({
    tenant_id: tenantId,
    template_id: params.template_id ?? null,
    template_type: params.template_type,
    paper_size: params.paper_size,
    source_type: params.source_type,
    source_id: params.source_id ?? null,
    payload: params.payload,
  });

  return !error;
}
