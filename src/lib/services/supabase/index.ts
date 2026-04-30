export { getProducts, getProductStats, getProductCategories, getProductCategoriesAsync, getProductBrands, getProductById, getAllStockMovements, getStockMovements as getProductStockMovements, getSalesHistory, createProduct, updateProduct, deleteProduct, bulkUpdateCategory, bulkUpdatePrice, bulkDeleteProducts } from "./products";
export type { AllStockMovementRow } from "./products";
export { getCustomers, getCustomerGroups, getCustomerById, createCustomer, updateCustomer, deleteCustomer } from "./customers";
export { getSuppliers, getSupplierById, createSupplier, updateSupplier, deleteSupplier } from "./suppliers";
export {
  getInvoices,
  getInvoiceStatuses,
  cancelInvoice,
  updateInvoice,
  getInvoicesForCustomer,
  getReturnsForCustomer,
} from "./invoices";
export type { CustomerReturn, UpdateInvoicePatch } from "./invoices";
export {
  getPurchaseOrders,
  getPurchaseOrderStatuses,
  getPurchaseOrderStatusMeta,
  updatePurchaseOrderStatus,
  receivePurchaseOrder,
  canTransitionPurchaseStatus,
  getPurchaseOrderItems,
  receivePurchaseOrderPartial,
  getPurchaseOrdersForSupplier,
} from "./purchase-orders";
export type { PurchaseOrderItemRow, PartialReceiveLine } from "./purchase-orders";
export {
  getOrders,
  getOrderStatuses,
  saveDraftOrder,
  listDraftOrders,
  getDraftOrderById,
  completeDraftOrder,
  deleteDraftOrder,
  completeSalesOrder,
  cancelSalesOrder,
} from "./orders";
export type { DraftOrderSummary, DraftOrderDetail } from "./orders";
export { getReturns, getReturnStatuses } from "./returns";
export { completeReturn } from "./returns-completion";
export {
  getShippingOrders,
  getShippingStatuses,
  getDeliveryPartners,
  getPartnerOptions,
  getPartnerOptionsAsync,
  updateDeliveryPartner,
  deactivateDeliveryPartner,
  updateShippingOrderStatus,
  canTransitionShippingStatus,
  getNextShippingStatuses,
  SHIPPING_STATUS_LABEL,
} from "./shipping";
export { getCashBookEntries, getCashBookTypes, getCashBookSummary, createCashTransaction, deleteCashTransaction } from "./cash-book";
export {
  getInventoryChecks, getInventoryCheckStatuses, applyInventoryCheck, cancelInventoryCheck,
  getInventoryCheckItems,
  getDisposalExports, getDisposalStatuses, completeDisposalExport, cancelDisposalExport,
  getInternalExports, getInternalExportStatuses, completeInternalExport, cancelInternalExport,
} from "./inventory";
export type { InventoryCheckItemRow } from "./inventory";
// Manufacturing handled by production.ts (getProductionOrders)
export { getPurchaseOrderEntries, getPurchaseOrdersForExport, getPurchaseEntryStatuses, getPurchaseReturns, getPurchaseReturnStatuses, getInputInvoices, getInputInvoiceStatuses, deleteInputInvoice, recordInputInvoice, completeSupplierReturn, cancelPurchaseOrderEntry } from "./purchase-entries";
export { recordInvoicePayment, recordPurchasePayment, getPaymentHistory } from "./payments";
export type { RecordPaymentInput, RecordPaymentResult } from "./payments";
export { getFavorites, isFavorite, toggleFavorite, getFavoriteIds } from "./favorites";
export { getCoupons, getCouponById, createCoupon, updateCoupon, deleteCoupon, validateCoupon, getCouponUsages } from "./coupons";
export {
  getPromotions,
  getActivePromotions,
  createPromotion,
  updatePromotion,
  deletePromotion,
  getPromotionSettings,
  upsertPromotionSettings,
  tagInvoicePromotion,
} from "./promotions";
export {
  getLoyaltySettings,
  upsertLoyaltySettings,
  getLoyaltyTiers,
  createLoyaltyTier,
  updateLoyaltyTier,
  deleteLoyaltyTier,
  getLoyaltyTransactions,
  earnLoyaltyPoints,
  redeemLoyaltyPoints,
  calculateRedeemDiscount,
} from "./loyalty";
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
  getFinanceKpis, getRevenueVsExpense, getExpenseBreakdown, getMonthlyProfit, getCashFlow, getCashFlowDetailed,
} from "./analytics";
export { posCheckout } from "./pos-checkout";
export type { PosCheckoutInput, PosCheckoutResult, PosCheckoutItem, PaymentBreakdownItem } from "./pos-checkout";

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
export { getCategoriesByScope, getAllCategories, getCategoriesWithCounts, createCategory, updateCategory, deleteCategory, moveCategorySortOrder, getProductsByCategoryId, suggestCategoryCode } from "./categories";

// Packaging Variants
export { getVariantsByProduct, createVariant, updateVariant, deleteVariant } from "./variants";

// BOM (Production Formulas)
export { getAllBOMs, getBOMsByProduct, getBOMById, createBOM, updateBOM, deleteBOM, calculateBOMCost, getBOMProductionHistory } from "./bom";

// Production Orders + Lot Tracking
export {
  getProductionOrders, getProductionOrderById, createProductionOrder, completeProductionOrder, consumeProductionMaterials,
  updateProductionStatus, canTransitionProductionStatus,
  checkMaterialsAvailability,
  getProductLots, getAllProductLots, allocateLotsFIFO, getExpiringLots, createPurchaseLot,
} from "./production";
export type { MaterialCheckInput, MaterialCheckResult } from "./production";

// Pricing (Price Tiers)
export {
  getPriceTiers, getPriceTierItems,
  createPriceTier, updatePriceTier, deletePriceTier, duplicatePriceTier,
  addPriceTierItem, bulkAddPriceTierItems, updatePriceTierItem, deletePriceTierItem,
  getProductPriceForCustomer, getTierPricesBatch,
  getApplicableTier, resolveAppliedTier,
} from "./pricing";

// Reports & Financial Intelligence
export {
  getProfitAndLoss, getCOGSBreakdown, getGrossMarginTrend,
  getInventoryTurnover, getDSO, getFinancialAlerts, getStockAlerts,
  getConsolidatedPnL, getBranchPnLComparison,
} from "./reports";
export type { ConsolidatedPnL, BranchPnLRow } from "./reports";

// UOM Conversions + Unit Name Management
export { getUOMConversions, createUOMConversion, updateUOMConversion, deleteUOMConversion, convertQuantity, getAllUnits, renameUnit, mergeUnits, findSimilarUnit } from "./uom";

// Branch Stock
export { getBranchStock, getBranchStockRows, getBranchStockPage, getBranchStockAggregates, getProductStockByBranch, getProductStockBreakdown } from "./branch-stock";
export type { BranchStockRow } from "./branch-stock";

// Branches (enhanced)
export { getBranches, createBranch, updateBranch, setBranchDefault, syncInternalEntities } from "./branches";
export type { BranchDetail } from "./branches";
export { BRANCH_TYPE_LABELS, BRANCH_CODE_PREFIX } from "./branches";

// ============================================================
// v7 Toàn Cảnh — Sprint 7 services
// ============================================================

// Stock Transfers (Chuyển kho giữa chi nhánh)
export {
  getStockTransfers, getStockTransferById, getTransferStatuses, getTransferStatusMeta,
  createStockTransfer, completeStockTransfer, cancelStockTransfer,
  updateTransferStatus, canTransitionTransfer,
} from "./transfers";
export type { StockTransfer, StockTransferStatus, StockTransferItem, CreateStockTransferInput } from "./transfers";

// Audit Log (Lịch sử thao tác)
export { getAuditLogs, getAuditLogsByEntity, getAuditStats, getActionOptions, getEntityTypeOptions } from "./audit";
export type { AuditLogEntry, AuditFilters } from "./audit";

// Debt Aging (Phân tích tuổi nợ)
export { getDebtAging, getTopDebtors as getDebtAgingDebtors } from "./debt";
export type { DebtAgingReport, AgingBucket, DebtorDetail } from "./debt";

// ============================================================
// F&B POS — Sprint A
// ============================================================

// Restaurant Tables
export {
  getTablesByBranch, createTable, updateTable, deleteTable,
  updateTableStatus, claimTable, releaseTable, markTableAvailable,
  getZonesByBranch, bulkCreateTables, renameZone, deleteZone,
} from "./fnb-tables";

// Kitchen Orders
export {
  getKitchenOrders, getKitchenOrderById,
  createKitchenOrder, addItemsToOrder,
  updateKitchenOrderStatus, updateKitchenItemStatus,
  linkInvoiceToOrder,
  updateOrderItemQty, removeOrderItem,
  cancelKitchenOrder, transferTable, mergeKitchenOrders,
  applyOrderDiscount, setDeliveryPlatform,
} from "./kitchen-orders";
export type { CreateKitchenOrderInput } from "./kitchen-orders";

// F&B Checkout (2-step flow)
export { sendToKitchen, fnbPayment, addItemsToExistingOrder, voidFnbInvoice } from "./fnb-checkout";
export type { SendToKitchenInput, SendToKitchenResult, FnbPaymentInput, FnbPaymentResult } from "./fnb-checkout";

// Shift Management
export { getOpenShift, getAnyOpenShift, openShift, closeShift, getShiftHistory } from "./shifts";

// Split Bill
export { splitByItems, splitEqually, areAllTableOrdersCompleted } from "./split-bill";

// F&B Analytics
export { getFnbKpis, getRevenueByMenuItem, getRevenueByTable, getRevenueByHourFnb, getCashierPerformance, getTableTurnover } from "./fnb-analytics";

// Internal Sales (Bán hàng nội bộ giữa chi nhánh)
export { getInternalSales, getInternalSaleById, getInternalSalesForExport, createInternalSale, cancelInternalSale } from "./internal-sales";
export type { InternalSaleItemInput, CreateInternalSaleInput, InternalSaleResult } from "./internal-sales";

// Production Dashboard
export { getProductionKpis, getNvlStock, getProductionTrend, getTopOutputProducts, getActiveProductionOrders } from "./production-dashboard";
export type { ProductionKpis, NvlStockRow, ProductionTrend, TopOutputProduct, ActiveProductionOrder } from "./production-dashboard";

// RBAC Roles & Permissions
export {
  getRoles, getRoleById, createRole, updateRole, deleteRole,
  setRolePermissions, getUserPermissions, assignRoleToUser, getTenantUsers,
} from "./roles";
export type { DbRole, DbRoleDetail, CreateRoleInput, UpdateRoleInput } from "./roles";

// ============================================================
// Phase Next — AI Agents (n8n integration)
// ============================================================
export {
  getAgents, getAgentById, createAgent, updateAgent, deleteAgent, seedDefaultAgents,
  getKpiBreakdowns, getKpiBreakdownTree, createKpiBreakdown, updateKpiActual, deleteKpiBreakdown,
  getAgentTasks, createAgentTask, updateAgentTask, updateAgentTaskStatus, deleteAgentTask,
  getAgentExecutions, recordAgentExecution, triggerAgent,
} from "./ai-agents";

// KPI Engine — Auto-breakdown + Actual sync (Sprint AI-1)
export {
  autoBreakdownKpi,
  syncKpiActualsFromDb,
  splitPeriod,
} from "./kpi-engine";
export type {
  AutoBreakdownInput,
  AutoBreakdownResult,
  SyncKpiActualsResult,
  BreakdownStrategy,
  BranchDistribution,
} from "./kpi-engine";

// Playbook Engine — Rule-based task auto-generation (Sprint AI-2)
export {
  evaluateRule,
  runPlaybookForAgent,
  runAllPlaybooks,
  getPlaybookRules,
  savePlaybookRules,
  defaultPlaybookForRole,
} from "./playbook-engine";

// Agent SLA — Task urgency + workload summary (Sprint AI-3)
export {
  taskUrgency,
  summarizeWorkload,
  summarizeKpiForAgent,
  TASK_URGENCY_TONE,
  TASK_URGENCY_LABELS,
  TASK_URGENCY_ICON,
} from "./agent-sla";
export type {
  TaskUrgency,
  AgentWorkload,
  AgentKpiSummary,
} from "./agent-sla";
