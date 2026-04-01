// Service interface - platform-agnostic, shared between web + mobile
// All services (mock and Supabase) must implement this interface

import type { QueryParams, QueryResult } from "@/lib/types";

export interface EntityService<T, TDetail = T> {
  getAll(params: QueryParams): Promise<QueryResult<T>>;
  getById?(id: string): Promise<TDetail | null>;
  create?(data: Partial<TDetail>): Promise<TDetail>;
  update?(id: string, data: Partial<TDetail>): Promise<TDetail>;
  delete?(id: string): Promise<void>;
}

// Shared helper for mock services
export function simulateDelay(ms: number = 300): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function paginateData<T>(
  data: T[],
  page: number,
  pageSize: number
): { data: T[]; total: number } {
  const start = page * pageSize;
  return {
    data: data.slice(start, start + pageSize),
    total: data.length,
  };
}

export function searchFilter<T>(
  items: T[],
  search: string | undefined,
  searchFields: (keyof T)[]
): T[] {
  if (!search) return items;
  const lower = search.toLowerCase();
  return items.filter((item) =>
    searchFields.some((field) => {
      const val = item[field];
      return typeof val === "string" && val.toLowerCase().includes(lower);
    })
  );
}
