/**
 * Supabase service base utilities.
 * Shared helpers for building queries from QueryParams.
 */

import { createClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { QueryParams } from "@/lib/types";

// Singleton client for browser-side services
let client: SupabaseClient<Database> | null = null;

export function getClient(): SupabaseClient<Database> {
  if (!client) {
    client = createClient();
  }
  return client;
}

/**
 * Apply pagination to a Supabase query builder.
 * Returns the range [from, to] for `.range()`.
 */
export function getPaginationRange(params: QueryParams): { from: number; to: number } {
  const from = params.page * params.pageSize;
  const to = from + params.pageSize - 1;
  return { from, to };
}

/**
 * Map sort order string to Supabase ascending boolean.
 */
export function isAscending(params: QueryParams): boolean {
  return params.sortOrder === "asc";
}

/**
 * Handle Supabase query errors consistently.
 * Throws a descriptive error if the query failed.
 */
export function handleError(error: { message: string; code?: string }, context: string): never {
  throw new Error(`[${context}] ${error.message} (code: ${error.code ?? "unknown"})`);
}

/**
 * Extract a single filter value from QueryParams.filters.
 * Handles the string | string[] union by taking first element if array.
 */
export function getFilterValue(filters: Record<string, string | string[]> | undefined, key: string): string | undefined {
  if (!filters) return undefined;
  const val = filters[key];
  if (!val) return undefined;
  return Array.isArray(val) ? val[0] : val;
}
