// Common types
export type { QueryParams, QueryResult, StatusChange, BaseLineItem, DateRange } from "./common";

// Product/Inventory domain
export type {
  Product,
  ProductDetail,
  StockMovement,
  SalesHistory,
  PriceBook,
  InventoryCheck,
  ManufacturingOrder,
  DisposalExport,
  InternalExport,
} from "./products";

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
} from "./shipping";

// Finance domain
export type { CashBookEntry, CashTransaction } from "./finance";

// Online sales domain
export type { SalesChannel, OnlineOrder } from "./online";

// Settings domain
export type {
  Permission,
  Role,
  NotificationType,
  Notification,
  TenantSettings,
} from "./settings";

// POS domain
export type { CartItem, OrderTab, SaleMode, PaymentMethod } from "./pos";

// Auth domain
export type { UserProfile, Tenant, Branch } from "./auth";
