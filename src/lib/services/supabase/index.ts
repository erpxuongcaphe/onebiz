export { getProducts, getAllMatchingProductIds, getProductStats, getProductCategories, getProductCategoriesAsync, getProductBrands, getProductById, getAllStockMovements, getStockMovements as getProductStockMovements, getSalesHistory, createProduct, updateProduct, deleteProduct, duplicateProduct, moveProductSortOrder, bulkUpdateCategory, bulkUpdatePrice, bulkDeleteProducts, restoreProduct, bulkRestoreProducts, forceDeleteProduct, bulkForceDeleteProducts, cleanupTestProduct, bulkCleanupTestProducts, verifyCurrentUserPassword } from "./products";
export type { AllStockMovementRow } from "./products";
export { getCustomers, getCustomerGroups, getCustomerGroupsAsync, getCustomerById, createCustomer, updateCustomer, deleteCustomer, getOrCreateWalkInCustomer, adjustCustomerDebt } from "./customers";
// Sprint UX-1 Stage 3: duplicate services for "Sao chép" row action
export { duplicateInvoice } from "./orders";
export { duplicatePurchaseOrder } from "./purchase-orders";
// Stage 8 (CEO 06/05/2026): duplicate services 5 kind warehouse + production
export {
  duplicateInventoryCheck,
  duplicateStockTransfer,
  duplicateDisposalExport,
  duplicateInternalSale,
  duplicateProductionOrder,
} from "./duplicate-services";
export { getSuppliers, getSupplierById, createSupplier, updateSupplier, deleteSupplier } from "./suppliers";
export {
  getInvoices,
  getInvoiceStatuses,
  getInvoiceItems,
  cancelInvoice,
  updateInvoice,
  getInvoicesForCustomer,
  getReturnsForCustomer,
} from "./invoices";
export type { CustomerReturn, UpdateInvoicePatch, InvoiceItemRow } from "./invoices";
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
  closePurchaseOrderShort,
} from "./purchase-orders";
export type {
  PurchaseOrderItemRow,
  PartialReceiveLine,
  ClosePurchaseOrderShortResult,
} from "./purchase-orders";
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
  getSalesOrderItems,
} from "./orders";
export type { DraftOrderSummary, DraftOrderDetail, SalesOrderItemRow } from "./orders";
export { getReturns, getReturnStatuses, getReturnItems } from "./returns";
export type { ReturnItemRow } from "./returns";
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
export { getCashBookEntries, getCashBookTypes, getCashBookSummary, getCashBookSummaryAsync, createCashTransaction, deleteCashTransaction, cancelCashTransaction } from "./cash-book";
export {
  getInventoryChecks, getInventoryCheckStatuses, applyInventoryCheck, cancelInventoryCheck,
  getInventoryCheckItems,
  getDisposalExports, getDisposalStatuses, completeDisposalExport, cancelDisposalExport,
  getInternalExports, getInternalExportStatuses, completeInternalExport, cancelInternalExport,
  getProductsWithBranchStock, bulkCreateAdjustmentLots,
} from "./inventory";
export type {
  InventoryCheckItemRow,
  ProductWithBranchStock,
  BulkAdjustmentLotItem,
  BulkAdjustmentLotFailure,
  BulkAdjustmentLotsResult,
} from "./inventory";
// Phase A 16/05/2026: báo cáo KHO chi tiết
export {
  getInventoryAgingReport,
  getDisposalLossReport,
  getInventoryVarianceReport,
} from "./inventory-reports";
export type {
  InventoryAgingRow,
  InventoryAgingReport,
  DisposalLossRow,
  DisposalLossReport,
  InventoryVarianceRow,
  InventoryVarianceReport,
} from "./inventory-reports";
// Phase B 16/05/2026: báo cáo BÁN HÀNG chi tiết
export {
  getSalesReturnReport,
  getStaffRevenueReport,
  getPlatformCommissionReport,
} from "./sales-reports";
export type {
  SalesReturnRow,
  SalesReturnReport,
  StaffRevenueRow,
  StaffRevenueReport,
  PlatformCommissionRow,
  PlatformCommissionSummary,
  PlatformCommissionReport,
} from "./sales-reports";
// Phase C 16/05/2026: báo cáo Tài chính + Marketing chuyên sâu
export {
  getReceivableAgingReport,
  getVatReport,
  getRfmReport,
  getFnbServeTimeReport,
} from "./finance-marketing-reports";
export type {
  ReceivableAgingRow,
  ReceivableAgingReport,
  VatSummary,
  VatInvoiceDetail,
  VatPoDetail,
  VatReport,
  RfmSegment,
  RfmRow,
  RfmReport,
  ServeTimeSummary,
  ServeTimeByBranch,
  ServeTimeByHour,
  ServeTimeByProduct,
  FnbServeTimeReport,
  VatByRate,
} from "./finance-marketing-reports";
// Manufacturing handled by production.ts (getProductionOrders)
export { getPurchaseOrderEntries, getPurchaseOrdersForExport, getPurchaseEntryStatuses, getPurchaseReturns, getPurchaseReturnStatuses, getInputInvoices, getInputInvoiceStatuses, deleteInputInvoice, cancelInputInvoice, recordInputInvoice, completeSupplierReturn, cancelPurchaseOrderEntry } from "./purchase-entries";
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
  // Cross-channel roll-up (Retail vs FnB)
  getCrossChannelKpis, getCrossChannelTrend, getCrossChannelTopProducts,
  // Customers
  getCustomerKpis, getNewCustomersMonthly, getCustomerSegments, getTopCustomersByRevenue, getTopDebtors,
  // CEO 14/05: Khách hàng × Sản phẩm (cross-table analytics)
  getRevenueByCustomerAndCategory, getRevenueByCustomerAndProduct,
  // Suppliers
  getSupplierKpis, getPurchaseByMonth, getTopSuppliersByPurchase, getSupplierPaymentStatus, getSupplierSummary,
  // Finance
  getFinanceKpis, getRevenueVsExpense, getExpenseBreakdown, getMonthlyProfit, getCashFlow, getCashFlowDetailed,
} from "./analytics";
export { posCheckout, recordDiscountAudit } from "./pos-checkout";
export type {
  PosCheckoutInput,
  PosCheckoutResult,
  PosCheckoutItem,
  PaymentBreakdownItem,
  RecordDiscountAuditInput,
} from "./pos-checkout";

// Manual stock adjustments (warehouse dialogs: internal export, disposal, return, manufacturing)
export { applyManualStockMovement, nextEntityCode, adjustStockToValue } from "./stock-adjustments";
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
export { getCategoriesByScope, getAllCategories, getCategoriesWithCounts, getCategoriesWithChannelBreakdown, createCategory, updateCategory, deleteCategory, moveCategorySortOrder, getProductsByCategoryId, suggestCategoryCode, previewProductCodeFromGroup } from "./categories";
export type { CategoryWithChannelBreakdown } from "./categories";

// Packaging Variants
export { getVariantsByProduct, createVariant, updateVariant, deleteVariant } from "./variants";

// BOM (Production Formulas)
export { getAllBOMs, getBOMByCode, getBOMsByProduct, getBOMById, createBOM, updateBOM, deleteBOM, calculateBOMCost, getBOMProductionHistory, getActiveBOMForBranch, cloneBOMForBranch, getProductIdsWithActiveBom } from "./bom";

// Production Orders + Lot Tracking
export {
  getProductionOrders, getProductionOrderById, createProductionOrder, completeProductionOrder, consumeProductionMaterials,
  cancelProductionOrder,
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

// XNT Report — Xuất-Nhập-Tồn (Sprint REP-1, CEO 06/05/2026)
// Format chuẩn KiotViet với 13 cột detail breakdown NHẬP/XUẤT
export { getXntReport } from "./xnt-report";
export type { XntRow, XntBranchBreakdown, XntReportResult } from "./xnt-report";

// ABC Analysis + Slow Movers (Sprint REP-3, CEO 06/05/2026)
export { getAbcReport } from "./abc-analysis";
export type { AbcRow, AbcClass, AbcReportResult } from "./abc-analysis";

// Customer Cohort Retention (Sprint REP-3, CEO 06/05/2026)
export { getCustomerCohortReport } from "./customer-cohort";
export type { CohortRow, CohortReportResult } from "./customer-cohort";

// UOM Conversions + Unit Name Management
export { getUOMConversions, getUOMConversionsByProductIds, createUOMConversion, updateUOMConversion, deleteUOMConversion, convertQuantity, getAllUnits, renameUnit, mergeUnits, findSimilarUnit } from "./uom";

// Branch Stock
export { getBranchStock, getBranchStockRows, getBranchStockPage, getBranchStockAggregates, getProductStockByBranch, getProductStockBreakdown } from "./branch-stock";
export type { BranchStockRow } from "./branch-stock";
export { getManagerLowStockProducts, getStockoutForecast } from "./stock-forecast";
export type { ManagerLowStockProduct, StockForecastRow, StockoutUrgency } from "./stock-forecast";

// Branches (enhanced)
export { getBranches, createBranch, updateBranch, setBranchDefault, syncInternalEntities, getBranchSettings, updateBranchSettings, type BranchSettings } from "./branches";
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
export { getAuditLogs, getAuditLogsByEntity, recordAuditLog, getAuditStats, getActionOptions, getEntityTypeOptions, getProfilesForPersonFilter } from "./audit";
export { getTenantBusinessInfo, updateTenantBusinessInfo, getTenantSetting, setTenantSetting, listTenantSettings, isAllowNegativeStock, setAllowNegativeStock, isRequireBomForSku, setRequireBomForSku, getInventoryLockState, isInventoryLocked, setInventoryLocked } from "./tenant-settings";
export type { TenantBusinessInfo, TenantSettingRow, SettingValue, InventoryLockState } from "./tenant-settings";
export type { BomConsumeResult, BomConsumedMaterial, BomConsumeWarning } from "./pos-checkout";
export { getNvlConsumptionByBranch, getCogsByBom } from "./bom-reports";
export type { NvlConsumptionRow, CogsByBomRow } from "./bom-reports";
export {
  getNotifications,
  getUnreadNotificationCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  createNotification,
} from "./notifications";
export type { NotificationKind, NotificationRow } from "./notifications";
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
  cancelKitchenOrder, cancelUnpaidKitchenOrder, transferTable, mergeKitchenOrders,
  applyOrderDiscount, setDeliveryPlatform,
  // Day 21/05/2026 (CEO): delivery staff tracking + tier picker
  assignDeliveryStaff, unassignDeliveryStaff, completeDelivery, setDeliveryDistanceTier,
} from "./kitchen-orders";
export type { CreateKitchenOrderInput, CancelUnpaidKitchenOrderInput } from "./kitchen-orders";

// F&B Delivery Fee Tiers (CEO 21/05/2026 — policy phí theo km)
export {
  getDeliveryFeeTiersForBranch,
  getAllDeliveryFeeTiers,
  updateDeliveryFeeTier,
  upsertBranchTierOverride,
  deleteBranchTierOverride,
} from "./fnb-delivery-tiers";
export type {
  DeliveryFeeTier,
  DeliveryTierCode,
} from "./fnb-delivery-tiers";

// F&B Checkout (2-step flow)
export { sendToKitchen, fnbPayment, addItemsToExistingOrder, voidFnbInvoice } from "./fnb-checkout";

// Manager OTP — duyệt từ xa các action nhạy cảm POS (CEO 12/05)
export {
  issueManagerOtp,
  verifyAndUseManagerOtp,
  getRecentManagerOtps,
  OTP_ACTION_CODES,
  OTP_ACTION_LABELS,
} from "./manager-otp";
export type {
  IssueManagerOtpInput,
  IssuedOtp,
  VerifyManagerOtpInput,
  VerifiedOtp,
  RecentManagerOtp,
  OtpActionCode,
} from "./manager-otp";

// Sprint B (CEO 12/05): PIN POS per-user (Approach Z)
export {
  setUserPosPin,
  removeUserPosPin,
  listPosPinUsers,
  verifyPosPinAndSwitch,
} from "./pos-pin";
export type { PosPinUser, PosPinSwitchResult } from "./pos-pin";

// CEO 13/05: Stock integrity reconciliation (migration 00073)
export { verifyStockInvariants } from "./stock-integrity";
export type {
  StockInvariantsResult,
  StockInvariantViolation1,
  StockInvariantViolation23,
} from "./stock-integrity";

// CEO 13/05: Giá theo nền tảng (Fabi/iPos pattern)
export {
  getPlatformPricesForProduct,
  getProductsWithPlatformPrices,
  upsertPlatformPrices,
  deletePlatformPrices,
  resolveProductPrice,
} from "./platform-prices";
export type {
  ProductPlatformPrice,
  ProductPlatformPriceUpsert,
  ProductWithPlatformPrices,
} from "./platform-prices";

// Sprint POS-FNB-EXT-1 (CEO 08/05): Delivery platforms + Discount presets
export {
  getDeliveryPlatformSettings,
  updateDeliveryPlatformSettings,
  DEFAULT_DELIVERY_PLATFORM_SETTINGS,
  getDiscountPresets,
  saveDiscountPresets,
  type DeliveryPlatformConfig,
  type DeliveryPlatformSettings,
  type DiscountPreset,
} from "./fnb-platform-settings";

// Sprint KITCHEN-1 (CEO 07/05): Kitchen stations multi-routing
export {
  getKitchenStationsByBranch,
  getAllKitchenStations,
  createKitchenStation,
  updateKitchenStation,
  deleteKitchenStation,
  assignCategoryToStation,
  getStationsByProductIds,
  type KitchenStation,
  type KitchenStationSettings,
  type CreateKitchenStationInput,
  type UpdateKitchenStationInput,
} from "./kitchen-stations";
export type { SendToKitchenInput, SendToKitchenResult, FnbPaymentInput, FnbPaymentResult } from "./fnb-checkout";

// Shift Management
export { getOpenShift, getAnyOpenShift, openShift, closeShift, getShiftHistory } from "./shifts";

// Split Bill
export { splitByItems, splitEqually, areAllTableOrdersCompleted } from "./split-bill";

// F&B Analytics
export {
  getFnbKpis, getRevenueByMenuItem, getRevenueByTable, getRevenueByHourFnb,
  getCashierPerformance, getTableTurnover,
  // Day 21/05/2026 (CEO): delivery staff performance + count today
  getDeliveryStaffPerformance, getOrdersByDeliveryStaff,
  getDeliveryCountToday,
} from "./fnb-analytics";
export type {
  DeliveryStaffPerformance, ShipperOrderRow,
} from "./fnb-analytics";

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

// CEO 22/05/2026 (Phase 2): per-user permission overrides
export {
  getUserPermissionOverrides,
  setUserPermissionOverride,
  deleteUserPermissionOverride,
  getUserEffectivePermissions,
} from "./permission-overrides";
export type { PermissionOverride, OverrideType } from "./permission-overrides";

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
