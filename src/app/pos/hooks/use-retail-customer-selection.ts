"use client";

import { useCallback } from "react";
import type { Customer } from "@/lib/types";
import { getOrCreateWalkInCustomer } from "@/lib/services/supabase/customers";

export const RETAIL_CUSTOMER_REQUIRED_MESSAGE = "Vui lòng chọn khách hàng trước khi thanh toán.";

export function hasSelectedRetailCustomer(customer: Customer | null | undefined): customer is Customer {
  return typeof customer?.id === "string" && customer.id.trim().length > 0;
}

type SelectionToken = { requestId: number; tabId: string };
interface SelectionOptions {
  beginRequest: () => SelectionToken;
  isCurrent: (token: SelectionToken) => boolean;
  onSelected: (customer: Customer | null) => void;
  onError: (error: unknown) => void;
}

/** A null picker choice means explicitly choosing Guest, never an automatic checkout default. */
export function useRetailCustomerSelection({ beginRequest, isCurrent, onSelected, onError }: SelectionOptions) {
  return useCallback(async (choice: Customer | null) => {
    const token = beginRequest();
    // While resolving Guest, the previous customer must not remain chargeable.
    if (!choice) onSelected(null);
    try {
      const selected = choice ?? await getOrCreateWalkInCustomer();
      if (isCurrent(token)) onSelected(selected);
    } catch (error) {
      if (isCurrent(token)) onError(error);
    }
  }, [beginRequest, isCurrent, onSelected, onError]);
}
