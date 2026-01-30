import { supabase } from './supabaseClient';

type Result<T> = { data: T; error: null } | { data: null; error: string };

function formatError(err: any): string {
    const code = err?.code as string | undefined;
    if (code === '23505') return 'Dữ liệu bị trùng (code đã tồn tại).';
    if (err?.message) return String(err.message);
    return 'Đã xảy ra lỗi. Vui lòng thử lại.';
}

export type Customer = {
    id: string;
    code?: string | null;
    name: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    // Type & Tax
    customer_type: 'retail' | 'wholesale' | 'vip' | 'corporate' | 'individual';
    tax_code?: string | null; // MST for corporate
    id_card_number?: string | null; // CCCD for individual
    // Payment Terms
    payment_terms_days: number; // 0 = COD
    payment_terms_description?: string | null;
    credit_limit?: number | null;
    // Contact
    contact_person?: string | null;
    // Bank info
    bank_name?: string | null;
    bank_account_number?: string | null;
    bank_account_name?: string | null;
    // Status
    status: 'active' | 'inactive' | 'suspended';
    created_at?: string;
};

export async function fetchCustomers(options?: {
    customerType?: string;
    status?: string;
    includeInactive?: boolean;
}): Promise<Customer[]> {
    if (!supabase) return [];
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return [];

    let query = supabase
        .from('sales_customers')
        .select('*')
        .order('name', { ascending: true });

    if (options?.customerType) {
        query = query.eq('customer_type', options.customerType);
    }

    if (options?.status) {
        query = query.eq('status', options.status);
    } else if (!options?.includeInactive) {
        query = query.eq('status', 'active');
    }

    const { data, error } = await query.returns<Customer[]>();
    if (error) {
        console.error('Error fetching customers:', error);
        return [];
    }
    return data ?? [];
}

export async function getCustomerById(id: string): Promise<Customer | null> {
    if (!supabase) return null;
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return null;

    const { data, error } = await supabase
        .from('sales_customers')
        .select('*')
        .eq('id', id)
        .single();

    if (error) return null;
    return (data as any) ?? null;
}

export type CreateCustomerInput = {
    code?: string | null;
    name: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    customer_type?: 'retail' | 'wholesale' | 'vip' | 'corporate' | 'individual';
    tax_code?: string | null;
    id_card_number?: string | null;
    payment_terms_days?: number;
    payment_terms_description?: string | null;
    credit_limit?: number | null;
    contact_person?: string | null;
    bank_name?: string | null;
    bank_account_number?: string | null;
    bank_account_name?: string | null;
};

export async function createCustomer(input: CreateCustomerInput): Promise<Result<{ id: string }>> {
    if (!supabase) return { data: null, error: 'Chưa cấu hình Supabase.' };
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return { data: null, error: 'Bạn chưa đăng nhập.' };

    const { data, error } = await supabase
        .from('sales_customers')
        .insert({
            code: input.code,
            name: input.name,
            email: input.email,
            phone: input.phone,
            address: input.address,
            customer_type: input.customer_type ?? 'retail',
            tax_code: input.tax_code,
            id_card_number: input.id_card_number,
            payment_terms_days: input.payment_terms_days ?? 0,
            payment_terms_description: input.payment_terms_description,
            credit_limit: input.credit_limit,
            contact_person: input.contact_person,
            bank_name: input.bank_name,
            bank_account_number: input.bank_account_number,
            bank_account_name: input.bank_account_name,
            status: 'active',
        })
        .select('id')
        .single();

    if (error) return { data: null, error: formatError(error) };
    const id = (data as any)?.id as string | undefined;
    if (!id) return { data: null, error: 'Không tạo được khách hàng.' };
    return { data: { id }, error: null };
}

export async function updateCustomer(
    id: string,
    patch: Partial<CreateCustomerInput> & { status?: 'active' | 'inactive' | 'suspended' }
): Promise<Result<true>> {
    if (!supabase) return { data: null, error: 'Chưa cấu hình Supabase.' };
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return { data: null, error: 'Bạn chưa đăng nhập.' };

    const { error } = await supabase.from('sales_customers').update(patch).eq('id', id);

    if (error) return { data: null, error: formatError(error) };
    return { data: true, error: null };
}

export async function deleteCustomer(id: string): Promise<Result<true>> {
    if (!supabase) return { data: null, error: 'Chưa cấu hình Supabase.' };
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return { data: null, error: 'Bạn chưa đăng nhập.' };

    const { error } = await supabase.from('sales_customers').delete().eq('id', id);

    if (error) return { data: null, error: formatError(error) };
    return { data: true, error: null };
}

// Get customer outstanding balance (công nợ)
export async function getCustomerBalance(customerId: string): Promise<number> {
    if (!supabase) return 0;
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return 0;

    // TODO: Calculate from invoices and payments
    // This is a placeholder - implement when invoice/payment tables are ready
    return 0;
}
