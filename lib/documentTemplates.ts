import { supabase } from './supabaseClient';
import { getCachedTenantId } from './tenantContext';

export type TemplateType =
  | 'invoice_sale'
  | 'payment_receipt'
  | 'payment_voucher'
  | 'payment_slip'
  | 'delivery_note'
  | 'purchase_order'
  | 'transfer_note'
  | 'void_note'
  | 'production_order'
  | 'inventory_receipt'
  | 'inventory_issue'
  | 'inventory_transfer';

export type PaperSize = 'A4' | 'A5' | '80mm';

export type TemplateSettings = {
  company_name?: string;
  company_tax_code?: string;
  company_address?: string;
  company_phone?: string;
  logo_url?: string;
  header_text?: string;
  footer_text?: string;
  show_vat?: boolean;
  vat_rate?: number;
  show_signature?: boolean;
};

export type TemplateColumnKey = 'sku' | 'name' | 'quantity' | 'unit_price' | 'total' | 'note';

export type TemplateLayout = {
  columns: Array<{ key: TemplateColumnKey; label: string; align?: 'left' | 'center' | 'right' }>;
  show_totals?: boolean;
  show_signature?: boolean;
  note_label?: string;
};

export type DocumentTemplate = {
  id: string;
  tenant_id: string;
  template_type: TemplateType;
  paper_size: PaperSize;
  name: string;
  settings: TemplateSettings;
  layout: TemplateLayout;
  version: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const DEFAULT_COLUMNS: TemplateLayout['columns'] = [
  { key: 'sku', label: 'Mã', align: 'left' },
  { key: 'name', label: 'Tên hàng', align: 'left' },
  { key: 'quantity', label: 'SL', align: 'center' },
  { key: 'unit_price', label: 'Đơn giá', align: 'right' },
  { key: 'total', label: 'Thành tiền', align: 'right' },
];

const DEFAULT_SETTINGS: TemplateSettings = {
  company_name: 'OneBiz ERP',
  company_tax_code: 'MST: ...',
  company_address: 'Địa chỉ: ...',
  company_phone: 'Hotline: ...',
  header_text: '',
  footer_text: 'Cảm ơn quý khách!',
  show_vat: true,
  vat_rate: 10,
  show_signature: false,
};

export const DEFAULT_TEMPLATES: Array<Omit<DocumentTemplate, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>> = [
  {
    template_type: 'invoice_sale',
    paper_size: 'A5',
    name: 'Hóa đơn bán hàng (A5)',
    settings: DEFAULT_SETTINGS,
    layout: {
      columns: DEFAULT_COLUMNS,
      show_totals: true,
      show_signature: true,
      note_label: 'Ghi chú',
    },
    version: 1,
    is_active: true,
  },
  {
    template_type: 'invoice_sale',
    paper_size: 'A4',
    name: 'Hóa đơn bán hàng (A4)',
    settings: DEFAULT_SETTINGS,
    layout: {
      columns: DEFAULT_COLUMNS,
      show_totals: true,
      show_signature: true,
      note_label: 'Ghi chú',
    },
    version: 1,
    is_active: true,
  },
  {
    template_type: 'payment_slip',
    paper_size: 'A5',
    name: 'Phiếu thanh toán (A5)',
    settings: {
      ...DEFAULT_SETTINGS,
      show_vat: false,
    },
    layout: {
      columns: [
        { key: 'name', label: 'Diễn giải', align: 'left' },
        { key: 'total', label: 'Số tiền', align: 'right' },
      ],
      show_totals: true,
      show_signature: true,
      note_label: 'Ghi chú',
    },
    version: 1,
    is_active: true,
  },
  {
    template_type: 'payment_slip',
    paper_size: 'A4',
    name: 'Phiếu thanh toán (A4)',
    settings: {
      ...DEFAULT_SETTINGS,
      show_vat: false,
    },
    layout: {
      columns: [
        { key: 'name', label: 'Diễn giải', align: 'left' },
        { key: 'total', label: 'Số tiền', align: 'right' },
      ],
      show_totals: true,
      show_signature: true,
      note_label: 'Ghi chú',
    },
    version: 1,
    is_active: true,
  },
  {
    template_type: 'payment_slip',
    paper_size: '80mm',
    name: 'Phiếu thanh toán (80mm)',
    settings: {
      ...DEFAULT_SETTINGS,
      show_vat: false,
      footer_text: 'Xin cảm ơn! Hẹn gặp lại.',
    },
    layout: {
      columns: [
        { key: 'name', label: 'Diễn giải', align: 'left' },
        { key: 'total', label: 'Số tiền', align: 'right' },
      ],
      show_totals: true,
      show_signature: false,
      note_label: 'Ghi chú',
    },
    version: 1,
    is_active: true,
  },
  {
    template_type: 'delivery_note',
    paper_size: 'A5',
    name: 'Phiếu giao hàng (A5)',
    settings: DEFAULT_SETTINGS,
    layout: {
      columns: DEFAULT_COLUMNS,
      show_totals: false,
      show_signature: true,
      note_label: 'Ghi chú',
    },
    version: 1,
    is_active: true,
  },
  {
    template_type: 'inventory_receipt',
    paper_size: 'A5',
    name: 'Phiếu nhập kho (A5)',
    settings: DEFAULT_SETTINGS,
    layout: {
      columns: DEFAULT_COLUMNS,
      show_totals: true,
      show_signature: true,
      note_label: 'Ghi chú',
    },
    version: 1,
    is_active: true,
  },
  {
    template_type: 'inventory_issue',
    paper_size: 'A5',
    name: 'Phiếu xuất kho (A5)',
    settings: DEFAULT_SETTINGS,
    layout: {
      columns: DEFAULT_COLUMNS,
      show_totals: true,
      show_signature: true,
      note_label: 'Ghi chú',
    },
    version: 1,
    is_active: true,
  },
  {
    template_type: 'inventory_transfer',
    paper_size: 'A5',
    name: 'Phiếu chuyển kho (A5)',
    settings: DEFAULT_SETTINGS,
    layout: {
      columns: DEFAULT_COLUMNS,
      show_totals: false,
      show_signature: true,
      note_label: 'Ghi chú',
    },
    version: 1,
    is_active: true,
  },
  {
    template_type: 'transfer_note',
    paper_size: 'A5',
    name: 'Phiếu chuyển hàng (A5)',
    settings: DEFAULT_SETTINGS,
    layout: {
      columns: DEFAULT_COLUMNS,
      show_totals: false,
      show_signature: true,
      note_label: 'Ghi chú',
    },
    version: 1,
    is_active: true,
  },
  {
    template_type: 'void_note',
    paper_size: 'A5',
    name: 'Phiếu hủy hàng (A5)',
    settings: DEFAULT_SETTINGS,
    layout: {
      columns: DEFAULT_COLUMNS,
      show_totals: false,
      show_signature: true,
      note_label: 'Lý do hủy',
    },
    version: 1,
    is_active: true,
  },
  {
    template_type: 'production_order',
    paper_size: 'A4',
    name: 'Phiếu sản xuất (A4)',
    settings: DEFAULT_SETTINGS,
    layout: {
      columns: DEFAULT_COLUMNS,
      show_totals: false,
      show_signature: true,
      note_label: 'Ghi chú',
    },
    version: 1,
    is_active: true,
  },
  {
    template_type: 'payment_receipt',
    paper_size: 'A5',
    name: 'Phiếu thu (A5)',
    settings: {
      ...DEFAULT_SETTINGS,
      show_vat: false,
    },
    layout: {
      columns: [
        { key: 'name', label: 'Diễn giải', align: 'left' },
        { key: 'total', label: 'Số tiền', align: 'right' },
      ],
      show_totals: true,
      show_signature: true,
      note_label: 'Nội dung thu',
    },
    version: 1,
    is_active: true,
  },
  {
    template_type: 'payment_voucher',
    paper_size: 'A5',
    name: 'Phiếu chi (A5)',
    settings: {
      ...DEFAULT_SETTINGS,
      show_vat: false,
    },
    layout: {
      columns: [
        { key: 'name', label: 'Diễn giải', align: 'left' },
        { key: 'total', label: 'Số tiền', align: 'right' },
      ],
      show_totals: true,
      show_signature: true,
      note_label: 'Nội dung chi',
    },
    version: 1,
    is_active: true,
  },
  {
    template_type: 'purchase_order',
    paper_size: 'A4',
    name: 'Phiếu đặt hàng (A4)',
    settings: DEFAULT_SETTINGS,
    layout: {
      columns: DEFAULT_COLUMNS,
      show_totals: true,
      show_signature: true,
      note_label: 'Ghi chú',
    },
    version: 1,
    is_active: true,
  },
];

export async function fetchDocumentTemplates(tenantId?: string | null): Promise<DocumentTemplate[]> {
  if (!supabase) return [];
  const tenant = tenantId ?? getCachedTenantId();
  if (!tenant) return [];

  const { data, error } = await supabase
    .from('document_templates')
    .select('*')
    .eq('tenant_id', tenant)
    .order('template_type', { ascending: true })
    .order('paper_size', { ascending: true })
    .order('version', { ascending: false });

  if (error || !data) return [];
  return data as DocumentTemplate[];
}

export async function ensureDefaultTemplates(tenantId?: string | null): Promise<boolean> {
  if (!supabase) return false;
  const tenant = tenantId ?? getCachedTenantId();
  if (!tenant) return false;

  const { data } = await supabase
    .from('document_templates')
    .select('id')
    .eq('tenant_id', tenant)
    .limit(1);

  if (data && data.length > 0) return true;

  const rows = DEFAULT_TEMPLATES.map((t) => ({
    tenant_id: tenant,
    template_type: t.template_type,
    paper_size: t.paper_size,
    name: t.name,
    settings: t.settings,
    layout: t.layout,
    version: t.version,
    is_active: t.is_active,
  }));

  const { error } = await supabase.from('document_templates').insert(rows);
  return !error;
}

export async function upsertTemplate(template: {
  id?: string;
  tenant_id: string;
  template_type: TemplateType;
  paper_size: PaperSize;
  name: string;
  settings: TemplateSettings;
  layout: TemplateLayout;
  version?: number;
  is_active?: boolean;
}): Promise<boolean> {
  if (!supabase) return false;
  const payload = {
    id: template.id,
    tenant_id: template.tenant_id,
    template_type: template.template_type,
    paper_size: template.paper_size,
    name: template.name,
    settings: template.settings,
    layout: template.layout,
    version: template.version ?? 1,
    is_active: template.is_active ?? true,
  };

  const { error } = await supabase
    .from('document_templates')
    .upsert(payload)
    .select('id')
    .maybeSingle();

  return !error;
}

export function getActiveTemplate(
  templates: DocumentTemplate[],
  type: TemplateType,
  paperSize: PaperSize
): DocumentTemplate | null {
  const filtered = templates.filter((t) => t.template_type === type && t.paper_size === paperSize && t.is_active);
  if (filtered.length === 0) return null;
  return filtered.sort((a, b) => b.version - a.version)[0];
}
