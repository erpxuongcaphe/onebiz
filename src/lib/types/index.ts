// Common types
export type { QueryParams, QueryResult, StatusChange, BaseLineItem, DateRange } from "./common";

// Product/Inventory domain
export type {
  Product,
  ProductDetail,
  ProductType,
  ProductCategory,
  StockMovement,
  SalesHistory,
  PriceBook,
  InventoryCheck,
  ManufacturingOrder,
  DisposalExport,
  InternalExport,
} from "./products";

// Pipeline Engine
export type {
  Pipeline,
  PipelineStage,
  PipelineTransition,
  PipelineItem,
  PipelineHistory,
  PipelineBoard,
  PipelineBoardColumn,
  PipelineBoardItem,
  AllowedTransition,
  TimelineEntry,
  PipelineAutomation,
} from "./pipeline";

// Production / BOM / Lot
export type {
  BOM,
  BOMItem,
  ProductionOrder,
  ProductionOrderStatus,
  ProductionOrderMaterial,
  ProductLot,
  LotAllocation,
  BOMCostBreakdown,
  ExpiringLot,
} from "./production";

// Pricing / Variants / UOM
export type {
  PriceTier,
  PriceTierItem,
  PriceTierScope,
  ProductVariant,
  UOMConversion,
  BranchStock,
  PackagingType,
} from "./pricing";

// Customer domain
export type { Customer, PurchaseHistory } from "./customers";

// Supplier domain
export type {
  Supplier,
  SupplierDetail,
  PurchaseHistoryItem,
  PaymentHistoryItem,
  ReturnHistoryItem,
  PurchaseOrderEntry,
  PurchaseReturn,
  InputInvoice,
} from "./suppliers";

// Orders domain
export type {
  Invoice,
  InvoiceLineItem,
  InvoiceDetail,
  PurchaseOrder,
  PurchaseOrderStatus,
  POLineItem,
  ImportHistory,
  PurchaseOrderDetail,
  SalesOrder,
  OrderLineItem,
  SalesOrderDetail,
  ReturnOrder,
  ReturnLineItem,
  ReturnDetail,
} from "./orders";

// Shipping domain
export type {
  DeliveryPartner,
  ShippingOrder,
  ShippingOrderDetail,
  ShippingStatus,
} from "./shipping";

// Finance domain
export type { CashBookEntry, CashTransaction } from "./finance";

// Online sales domain
export type { SalesChannel, OnlineOrder } from "./online";

// Coupons domain
export type { Coupon, CouponUsage, CouponValidation } from "./coupons";

// Promotions domain
export type { Promotion, PromotionChannel, PromotionSettings } from "./promotions";

// Loyalty domain
export type { LoyaltySettings, LoyaltyTier, LoyaltyTransaction } from "./loyalty";

// Favorites domain
export type { Favorite } from "./favorites";

// Conversations domain
export type { Conversation, ConversationMessage } from "./conversations";

// Settings domain
export type {
  Permission,
  Role,
  NotificationType,
  Notification,
  TenantSettings,
} from "./settings";

// POS domain
export type {
  CartItem,
  OrderTab,
  ShippingInfo,
  PosDeliveryPartner,
  CouponInfo,
  SaleMode,
  PaymentMethod,
} from "./pos";

// Internal Sales domain
export type { InternalSale, InternalSaleItem } from "./internal-sales";

// Auth domain
export type { UserProfile, Tenant, Branch, BranchType } from "./auth";

// F&B domain
export type {
  TableStatus, RestaurantTable,
  KitchenOrderStatus, KitchenItemStatus, OrderType,
  ToppingAttachment, KitchenOrderItem, KitchenOrder,
  FnbCartTopping, FnbOrderLine, FnbTabSnapshot,
} from "./fnb";
