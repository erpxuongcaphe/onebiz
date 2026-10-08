import type { PreBillData } from "./print-fnb";

/** Default bills must use the same branch print information as custom templates. */
export async function withFnbReceiptBrand<T extends PreBillData & { isOffline?: boolean }>(data: T): Promise<T> {
  if (!data.branchId || data.isOffline) return data;
  try {
    const { getResolvedBrand } = await import("./services");
    const brand = await getResolvedBrand(data.branchId);
    return {
      ...data,
      // Undefined means the POS explicitly disabled this header field.
      storeName: data.storeName === undefined ? undefined : brand.branchName || brand.businessName || data.storeName,
      storeAddress: data.storeAddress === undefined ? undefined : brand.address || data.storeAddress,
      storePhone: data.storePhone === undefined ? undefined : brand.phone || data.storePhone,
    };
  } catch (error) {
    console.warn("[withFnbReceiptBrand] Using cached POS header:", error);
    return data;
  }
}
