import { supabase } from './supabaseClient';

type Result<T> = { data: T; error: null } | { data: null; error: string };

function formatError(err: any): string {
    const code = err?.code as string | undefined;
    if (code === '23505') return 'Dữ liệu bị trùng (code đã tồn tại).';
    if (err?.message) return String(err.message);
    return 'Đã xảy ra lỗi. Vui lòng thử lại.';
}

export type Supplier = {
    id: string;
    code: string;
    name: string;
    tax_code?: string | null;
    contact_person?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    payment_terms: number;
    credit_limit?: number | null;
    currency: string;
    status: 'active' | 'inactive';
    notes?: string | null;
    created_at?: string;
    updated_at?: string;
};

export type CreateSupplierInput = {
    code: string;
    name: string;
    tax_code?: string | null;
    contact_person?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    payment_terms?: number;
    credit_limit?: number | null;
    currency?: string;
    notes?: string | null;
};

export async function fetchSuppliers(options?: {
    status?: 'active' | 'inactive';
    includeInactive?: boolean;
}): Promise<Supplier[]> {
    if (!supabase) return [];
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return [];

    let query = supabase
        .from('suppliers')
        .select('*')
        .order('name', { ascending: true });

    if (options?.status) {
        query = query.eq('status', options.status);
    } else if (!options?.includeInactive) {
        query = query.eq('status', 'active');
    }

    const { data, error } = await query.returns<Supplier[]>();
    if (error) {
        console.error('Error fetching suppliers:', error);
        return [];
    }
    return data ?? [];
}

export async function getSupplierById(id: string): Promise<Supplier | null> {
    if (!supabase) return null;
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return null;

    const { data, error } = await supabase
        .from('suppliers')
        .select('*')
        .eq('id', id)
        .single();

    if (error) return null;
    return (data as any) ?? null;
}

export async function createSupplier(input: CreateSupplierInput): Promise<Result<{ id: string }>> {
    if (!supabase) return { data: null, error: 'Chưa cấu hình Supabase.' };
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return { data: null, error: 'Bạn chưa đăng nhập.' };

    const { data, error } = await supabase
        .from('suppliers')
        .insert({
            code: input.code,
            name: input.name,
            tax_code: input.tax_code ?? null,
            contact_person: input.contact_person ?? null,
            email: input.email ?? null,
            phone: input.phone ?? null,
            address: input.address ?? null,
            payment_terms: input.payment_terms ?? 30,
            credit_limit: input.credit_limit ?? null,
            currency: input.currency ?? 'VND',
            notes: input.notes ?? null,
        })
        .select('id')
        .single();

    if (error) return { data: null, error: formatError(error) };
    const id = (data as any)?.id as string | undefined;
    if (!id) return { data: null, error: 'Không tạo được nhà cung cấp.' };
    return { data: { id }, error: null };
}

export async function updateSupplier(
    id: string,
    patch: Partial<CreateSupplierInput> & { status?: 'active' | 'inactive' }
): Promise<Result<true>> {
    if (!supabase) return { data: null, error: 'Chưa cấu hình Supabase.' };
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return { data: null, error: 'Bạn chưa đăng nhập.' };

    const { error } = await supabase.from('suppliers').update(patch).eq('id', id);

    if (error) return { data: null, error: formatError(error) };
    return { data: true, error: null };
}

export async function deleteSupplier(id: string): Promise<Result<true>> {
    if (!supabase) return { data: null, error: 'Chưa cấu hình Supabase.' };
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return { data: null, error: 'Bạn chưa đăng nhập.' };

    const { error } = await supabase.from('suppliers').delete().eq('id', id);

    if (error) return { data: null, error: formatError(error) };
    return { data: true, error: null };
}

// Archive/restore
export async function archiveSupplier(id: string): Promise<Result<true>> {
    return updateSupplier(id, { status: 'inactive' });
}

export async function restoreSupplier(id: string): Promise<Result<true>> {
    return updateSupplier(id, { status: 'active' });
}
