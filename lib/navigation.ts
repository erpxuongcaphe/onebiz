import { BarChart2, LayoutDashboard, Package, ShoppingCart, Users, Wallet } from 'lucide-react';
import { Store } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Tab } from '../types';
import { getAppMode } from './appMode';

export type NavItem = {
  id: Tab;
  label: string;
  icon: LucideIcon;
};

const MAIN_DESKTOP: NavItem[] = [
  { id: Tab.DASHBOARD, label: 'Tổng quan', icon: LayoutDashboard },
  { id: Tab.INVENTORY, label: 'Kho hàng', icon: Package },
  { id: Tab.ORDERS, label: 'Đơn hàng', icon: ShoppingCart },
  { id: Tab.REPORTS, label: 'Báo cáo', icon: BarChart2 },
  { id: Tab.FINANCE, label: 'Tài chính', icon: Wallet },
  { id: Tab.CUSTOMERS, label: 'Khách hàng', icon: Users },
];

const POS_DESKTOP: NavItem[] = [
  { id: Tab.POS, label: 'POS', icon: Store },
];

export function getDesktopNavItems(): NavItem[] {
  return getAppMode() === 'pos' ? POS_DESKTOP : MAIN_DESKTOP;
}

const MAIN_MOBILE: NavItem[] = [
  { id: Tab.DASHBOARD, label: 'Tổng quan', icon: LayoutDashboard },
  { id: Tab.INVENTORY, label: 'Kho hàng', icon: Package },
  { id: Tab.ORDERS, label: 'Đơn hàng', icon: ShoppingCart },
  { id: Tab.REPORTS, label: 'Báo cáo', icon: BarChart2 },
];

const POS_MOBILE: NavItem[] = [
  { id: Tab.POS, label: 'POS', icon: Store },
];

export function getMobileNavItems(): NavItem[] {
  return getAppMode() === 'pos' ? POS_MOBILE : MAIN_MOBILE;
}
