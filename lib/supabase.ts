import { createClient } from '@supabase/supabase-js';
import { Database } from './database.types';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);

// Untyped client for inventory tables not yet in generated types
// TODO: Regenerate types after running migrations on production DB
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabaseUntyped = createClient<any>(supabaseUrl, supabaseAnonKey);
