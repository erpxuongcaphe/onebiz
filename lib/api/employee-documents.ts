/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from '../supabaseClient';

// Note: These tables are created via migrations but not in database.types.ts

// =====================================================
// Types
// =====================================================
export type DocumentType =
    | 'identity_card'
    | 'degree'
    | 'certificate'
    | 'contract'
    | 'other';

export type HistoryEventType =
    | 'hired'
    | 'promoted'
    | 'transferred'
    | 'salary_change'
    | 'warning'
    | 'terminated';

export type EmployeeDocument = {
    id: string;
    employee_id: string;
    document_type: DocumentType;
    name: string;
    description: string | null;
    file_url: string;
    file_type: string | null;
    file_size: number | null;
    uploaded_by: string | null;
    issue_date: string | null;
    expiry_date: string | null;
    is_verified: boolean;
    verified_by: string | null;
    verified_at: string | null;
    created_at: string;
    updated_at: string;
};

export type EmployeeHistory = {
    id: string;
    employee_id: string;
    event_type: HistoryEventType;
    event_date: string;
    description: string;
    old_value: string | null;
    new_value: string | null;
    metadata: Record<string, unknown> | null;
    created_by: string | null;
    created_at: string;
};

// =====================================================
// Documents CRUD
// =====================================================
export async function getEmployeeDocuments(employeeId: string): Promise<EmployeeDocument[]> {
    const { data, error } = await supabase
        .from('employee_documents')
        .select('*')
        .eq('employee_id', employeeId)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []) as EmployeeDocument[];
}

export async function uploadDocument(doc: {
    employee_id: string;
    document_type: DocumentType;
    name: string;
    description?: string;
    file_url: string;
    file_type?: string;
    file_size?: number;
    uploaded_by?: string;
    issue_date?: string;
    expiry_date?: string;
}): Promise<EmployeeDocument> {
    const { data, error } = await supabase
        .from('employee_documents')
        .insert(doc)
        .select()
        .single();

    if (error) throw error;
    return data as EmployeeDocument;
}

export async function updateDocument(
    id: string,
    updates: Partial<EmployeeDocument>
): Promise<EmployeeDocument> {
    const { data, error } = await supabase
        .from('employee_documents')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;
    return data as EmployeeDocument;
}

export async function verifyDocument(
    id: string,
    verifiedBy: string
): Promise<EmployeeDocument> {
    const { data, error } = await supabase
        .from('employee_documents')
        .update({
            is_verified: true,
            verified_by: verifiedBy,
            verified_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;
    return data as EmployeeDocument;
}

export async function deleteDocument(id: string): Promise<void> {
    const { error } = await supabase
        .from('employee_documents')
        .delete()
        .eq('id', id);

    if (error) throw error;
}

// =====================================================
// History
// =====================================================
export async function getEmployeeHistory(employeeId: string): Promise<EmployeeHistory[]> {
    const { data, error } = await supabase
        .from('employee_history')
        .select('*')
        .eq('employee_id', employeeId)
        .order('event_date', { ascending: false });

    if (error) throw error;
    return (data || []) as unknown as EmployeeHistory[];
}

export async function addHistoryEvent(event: {
    employee_id: string;
    event_type: HistoryEventType;
    event_date: string;
    description: string;
    old_value?: string;
    new_value?: string;
    metadata?: Record<string, unknown>;
    created_by?: string;
}): Promise<EmployeeHistory> {
    const { data, error } = await supabase
        .from('employee_history')
        .insert(event as any)
        .select()
        .single();

    if (error) throw error;
    return data as unknown as EmployeeHistory;
}

// =====================================================
// Helper Functions
// =====================================================
export function getDocumentTypeLabel(type: DocumentType): string {
    const labels: Record<DocumentType, string> = {
        identity_card: 'CMND/CCCD',
        degree: 'Bằng cấp',
        certificate: 'Chứng chỉ',
        contract: 'Hợp đồng',
        other: 'Khác'
    };
    return labels[type];
}

export function getDocumentTypeIcon(type: DocumentType): string {
    const icons: Record<DocumentType, string> = {
        identity_card: '🪪',
        degree: '🎓',
        certificate: '📜',
        contract: '📄',
        other: '📎'
    };
    return icons[type];
}

export function getEventTypeLabel(type: HistoryEventType): string {
    const labels: Record<HistoryEventType, string> = {
        hired: 'Tuyển dụng',
        promoted: 'Thăng chức',
        transferred: 'Chuyển phòng',
        salary_change: 'Điều chỉnh lương',
        warning: 'Cảnh cáo',
        terminated: 'Nghỉ việc'
    };
    return labels[type];
}

export function getEventTypeColor(type: HistoryEventType): string {
    const colors: Record<HistoryEventType, string> = {
        hired: 'bg-green-100 text-green-800',
        promoted: 'bg-blue-100 text-blue-800',
        transferred: 'bg-purple-100 text-purple-800',
        salary_change: 'bg-amber-100 text-amber-800',
        warning: 'bg-orange-100 text-orange-800',
        terminated: 'bg-red-100 text-red-800'
    };
    return colors[type];
}

export function formatFileSize(bytes: number | null): string {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
