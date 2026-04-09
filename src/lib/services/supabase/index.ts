export { getProducts, getProductCategories, getProductCategoriesAsync, getProductById, getStockMovements as getProductStockMovements, getSalesHistory, createProduct, updateProduct, deleteProduct, bulkUpdateCategory, bulkUpdatePrice, bulkDeleteProducts } from "./products";
export { getCustomers, getCustomerGroups, getCustomerById, createCustomer, updateCustomer, deleteCustomer } from "./customers";
export { getSuppliers, getSupplierById, createSupplier, updateSupplier, deleteSupplier } from "./suppliers";
export { getInvoices, getInvoiceStatuses } from "./invoices";
export {
  getPurchaseOrders,
  getPurchaseOrderStatuses,
  getPurchaseOrderStatusMeta,
  updatePurchaseOrderStatus,
  receivePurchaseOrder,
  canTransitionPurchaseStatus,
} from "./purchase-orders";
export {
  getOrders,
  getOrderStatuses,
  saveDraftOrder,
  listDraftOrders,
  getDraftOrderById,
  completeDraftOrder,
  deleteDraftOrder,
} from "./orders";
export type { DraftOrderSummary, DraftOrderDetail } from "./orders";
export { getReturns, getReturnStatuses } from "./returns";
export { getShippingOrders, getShippingStatuses, getDeliveryPartners, getPartnerOptions } from "./shipping";
export { getCashBookEntries, getCashBookTypes, getCashBookSummary, createCashTransaction } from "./cash-book";
export { getInventoryChecks, getInventoryCheckStatuses, applyInventoryCheck, getManufacturingOrders, getManufacturingStatuses, getDisposalExports, getDisposalStatuses, getInternalExports, getInternalExportStatuses } from "./inventory";
export { getPurchaseOrderEntries, getPurchaseEntryStatuses, getPurchaseReturns, getPurchaseReturnStatuses, getInputInvoices, getInputInvoiceStatuses } from "./purchase-entries";
export { getFavorites, isFavorite, toggleFavorite, getFavoriteIds } from "./favorites";
export { getCoupons, getCouponById, createCoupon, updateCoupon, deleteCoupon, validateCoupon, getCouponUsages } from "./coupons";
export { getPromotions, getActivePromotions, createPromotion, updatePromotion, deletePromotion } from "./promotions";
export { getLoyaltySettings, upsertLoyaltySettings, getLoyaltyTiers, createLoyaltyTier, updateLoyaltyTier, deleteLoyaltyTier, getLoyaltyTransactions, earnLoyaltyPoints } from "./loyalty";
export { getOnlineOrders, getOnlineOrderById, updateOnlineOrderStatus, updateOnlineOrderPaymentStatus, getOnlineOrderStats } from "./online-orders";
export { getConversations, getConversationMessages, sendMessage, markConversationRead } from "./conversations";
export { getDashboardKpis, getRevenueByDay, getRevenueByHour, getRevenueByWeekday, getOrdersByWeekday, getTopProducts, getLowStockProducts, getRecentActivities } from "./dashboard";
export {
  // Overview
  getOverviewKpis, getDailyRevenue, getRevenueByCategory,
  // Sales
  getSalesKpis, getRevenueByWeekday as getSalesRevenueByWeekday, getRevenueByHour as getSalesRevenueByHour, getTopInvoices,
  // End of day
  getEndOfDayStats, getTodayTopProducts,
  // Orders
  getOrdersKpis, getDailyOrderVolume, getOrderStatusDistribution, getRecentOrders,
  // Inventory
  getInventoryKpis, getTopProductsByRevenue, getCategoryDistribution, getStockMovements, getLowStockProducts as getAnalyticsLowStock,
  // Channels
  getChannelRevenue, getChannelPerformance,
  // Customers
  getCustomerKpis, getNewCustomersMonthly, getCustomerSegments, getTopCustomersByRevenue, getTopDebtors,
  // Suppliers
  getSupplierKpis, getPurchaseByMonth, getTopSuppliersByPurchase, getSupplierPaymentStatus, getSupplierSummary,
  // Finance
  getFinanceKpis, getRevenueVsExpense, getExpenseBreakdown, getMonthlyProfit, getCashFlow,
} from "./analytics";
export { posCheckout } from "./pos-checkout";
export type { PosCheckoutInput, PosCheckoutResult, PosCheckoutItem } from "./pos-checkout";

// Manual stock adjustments (warehouse dialogs: internal export, disposal, return, manufacturing)
export { applyManualStockMovement, nextEntityCode } from "./stock-adjustments";
export type { ManualStockMovementInput, ManualStockMovementContext } from "./stock-adjustments";

// Auth/tenant helpers (DEV + production)
export { getCurrentTenantId, getCurrentContext } from "./base";
export type { CurrentContext } from "./base";

// ============================================================
// v4 Foundation — New services
// ============================================================

// Pipeline Engine
export {
  getPipelines, getPipelineByEntityType, getPipelineStages,
  createPipelineItem, getPipelineItemByEntity,
  transitionPipelineItem, getAllowedTransitions,
  getPipelineBoard, getPipelineTimeline,
} from "./pipeline";

// Categories (scoped: nvl, sku, customer, supplier)
export { getCategoriesByScope, getAllCategories, createCategory, updateCategory, deleteCategory } from "./categories";

// Packaging Variants
export { getVariantsByProduct, createVariant, updateVariant, deleteVariant } from "./variants";

// BOM (Production Formulas)
export { getAllBOMs, getBOMsByProduct, getBOMById, createBOM, updateBOM, deleteBOM, calculateBOMCost } from "./bom";

// Production Orders + Lot Tracking
export {
  getProductionOrders, getProductionOrderById, createProductionOrder, completeProductionOrder, consumeProductionMaterials,
  updateProductionStatus, canTransitionProductionStatus,
  getProductLots, allocateLotsFIFO, getExpiringLots, createPurchaseLot,
} from "./production";

// Pricing (Price Tiers)
export {
  getPriceTiers, getPriceTierItems,
  createPriceTier, updatePriceTier, deletePriceTier,
  addPriceTierItem, updatePriceTierItem, deletePriceTierItem,
} from "./pricing";

// UOM Conversions
export { getUOMConversions, createUOMConversion, updateUOMConversion, deleteUOMConversion, convertQuantity } from "./uom";

// Branch Stock
export { getBranchStock, getBranchStockRows, getProductStockByBranch } from "./branch-stock";
export type { BranchStockRow } from "./branch-stock";

// Branches (enhanced)
export { getBranches, createBranch, updateBranch } from "./branches";
export type { BranchDetail } from "./branches";
export { BRANCH_TYPE_LABELS, BRANCH_CODE_PREFIX } from "./branches";
