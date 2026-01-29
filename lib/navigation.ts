import { BarChart2, LayoutDashboard, Package, ShoppingCart, Users, Wallet } from 'lucide-react';
import { Store } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Tab } from '../types';
import { getAppMode } from './appMode';

export type NavItem = {
  id: Tab;
  label: string;
  icon: LucideIcon;
  path: string;
};

const MAIN_DESKTOP: NavItem[] = [
  { id: Tab.DASHBOARD, label: 'Tổng quan', icon: LayoutDashboard, path: '/dashboard' },
  { id: Tab.INVENTORY, label: 'Kho hàng', icon: Package, path: '/inventory' },
  { id: Tab.ORDERS, label: 'Đơn hàng', icon: ShoppingCart, path: '/orders' },
  { id: Tab.REPORTS, label: 'Báo cáo', icon: BarChart2, path: '/reports' },
  { id: Tab.FINANCE, label: 'Tài chính', icon: Wallet, path: '/finance' },
  { id: Tab.CUSTOMERS, label: 'Khách hàng', icon: Users, path: '/customers' },
];

const POS_DESKTOP: NavItem[] = [
  { id: Tab.POS, label: 'POS', icon: Store, path: '/pos' },
];

export function getDesktopNavItems(): NavItem[] {
  return getAppMode() === 'pos' ? POS_DESKTOP : MAIN_DESKTOP;
}

const MAIN_MOBILE: NavItem[] = [
  { id: Tab.DASHBOARD, label: 'Tổng quan', icon: LayoutDashboard, path: '/dashboard' },
  { id: Tab.INVENTORY, label: 'Kho hàng', icon: Package, path: '/inventory' },
  { id: Tab.ORDERS, label: 'Đơn hàng', icon: ShoppingCart, path: '/orders' },
  { id: Tab.REPORTS, label: 'Báo cáo', icon: BarChart2, path: '/reports' },
];

const POS_MOBILE: NavItem[] = [
  { id: Tab.POS, label: 'POS', icon: Store, path: '/pos' },
];

export function getMobileNavItems(): NavItem[] {
  return getAppMode() === 'pos' ? POS_MOBILE : MAIN_MOBILE;
}
