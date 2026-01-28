import { supabase } from '@/lib/supabaseClient';

export type SystemConfig = {
    key: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any;
    description: string;
    group_name: string;
};

export const getSystemConfigs = async (groupName?: string) => {
    let query = supabase.from('system_configs').select('*');
    if (groupName) {
        query = query.eq('group_name', groupName);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Convert 'value' from JSONB to primitive if needed, though supabase-js handles JSON usually
    return data as SystemConfig[];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const updateSystemConfig = async (key: string, value: any) => {
    const { data, error } = await supabase
        .from('system_configs')
        .update({ value, updated_at: new Date().toISOString() })
        .eq('key', key)
        .select()
        .single();

    if (error) throw error;
    return data;
};

// Helper utility to convert array to object for easier calculation usage
export const configsToObject = (configs: SystemConfig[]) => {
    return configs.reduce((acc, config) => {
        acc[config.key] = config.value;
        return acc;
    }, {} as Record<string, number>); // Changed to number as we mostly rely on numbers for payroll
};
