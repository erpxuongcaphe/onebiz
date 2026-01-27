export enum OrderStatus {
  PENDING = 'Chờ xử lý',
  PROCESSING = 'Đang xử lý',
  COMPLETED = 'Hoàn thành',
  CANCELLED = 'Đã hủy'
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  stock: number;
  price: number;
  status: 'In Stock' | 'Low Stock' | 'Out of Stock';
  image: string;
  archived?: boolean;
}

export interface Order {
  id: string;
  customer: string;
  date: string;
  total: number;
  status: OrderStatus;
  items: number;
}

export interface KPI {
  label: string;
  value: string;
  change: string;
  trend: 'up' | 'down' | 'neutral';
  icon: any; // Lucide icon type
}

export interface Activity {
  id: string;
  user: string;
  action: string;
  target: string;
  time: string;
  type: 'order' | 'inventory' | 'system' | 'warning';
}

export enum Tab {
  DASHBOARD = 'dashboard',
  INVENTORY = 'inventory',
  ORDERS = 'orders',
  POS = 'pos',
  REPORTS = 'reports',
  FINANCE = 'finance',
  CUSTOMERS = 'customers',
  SETTINGS = 'settings'
}

export type ViewMode = 'comfort' | 'compact';
