/**
 * Lucide React → Material Symbols Outlined mapping.
 *
 * Nguồn: quét `grep -rh 'from "lucide-react"' src/ | sed ...` ngày 18/04/2026
 * ra ~100 icon unique.
 *
 * Quy ước đặt tên Material Symbols: https://fonts.google.com/icons
 * Khi 1 icon không có equivalent 1-1, chọn cái gần nhất về mặt hình ảnh.
 */

export const LUCIDE_TO_MATERIAL: Record<string, string> = {
  // Alerts & status
  AlertCircle: "error",
  AlertTriangle: "warning",
  CheckCircle2: "check_circle",
  XCircle: "cancel",
  Info: "info",
  ShieldAlert: "gpp_bad",

  // Navigation & arrows
  ArrowLeft: "arrow_back",
  ArrowRight: "arrow_forward",
  ArrowRightLeft: "swap_horiz",
  ArrowLeftRight: "swap_horiz",
  ArrowDownCircle: "arrow_circle_down",
  ArrowUpCircle: "arrow_circle_up",
  ArrowDownRight: "south_east",
  ArrowUpRight: "north_east",
  ChevronDown: "expand_more",
  ChevronDownIcon: "expand_more",
  ChevronLeft: "chevron_left",
  ChevronRight: "chevron_right",
  ChevronRightIcon: "chevron_right",
  ChevronUpIcon: "expand_less",
  ChevronUp: "expand_less",

  // Actions
  Plus: "add",
  Minus: "remove",
  Check: "check",
  CheckIcon: "check",
  X: "close",
  XIcon: "close",
  Ban: "block",
  Trash2: "delete",
  Pencil: "edit",
  Save: "save",
  Search: "search",
  Filter: "filter_alt",
  Download: "download",
  Upload: "upload",
  RefreshCw: "refresh",
  RotateCcw: "undo",
  Undo2: "undo",
  Repeat: "repeat",
  ExternalLink: "open_in_new",
  Scissors: "content_cut",
  ImagePlus: "add_photo_alternate",

  // Layout & UI
  PanelLeftClose: "left_panel_close",
  PanelLeftOpen: "left_panel_open",
  Kanban: "view_kanban",
  List: "list",
  Layers: "layers",
  Monitor: "desktop_windows",
  Eye: "visibility",
  EyeOff: "visibility_off",
  Printer: "print",
  QrCode: "qr_code",
  Keyboard: "keyboard",
  Sparkles: "auto_awesome",
  Star: "star",
  StickyNote: "sticky_note_2",
  HelpCircle: "help",
  Loader2: "progress_activity",

  // Business entities
  Home: "home",
  Building: "business",
  Building2: "apartment",
  Warehouse: "warehouse",
  Factory: "factory",
  User: "person",
  UserPlus: "person_add",
  UserCheck: "person_check",
  Users: "group",
  ShoppingBag: "shopping_bag",
  ShoppingCart: "shopping_cart",
  Package: "inventory_2",
  PackageCheck: "inventory_2",
  PackagePlus: "add_box",
  PackageSearch: "pageview",
  Boxes: "inventory",
  Truck: "local_shipping",
  Tag: "sell",
  Tags: "label",
  Coffee: "local_cafe",
  ChefHat: "restaurant_menu",
  UtensilsCrossed: "restaurant",
  Armchair: "chair",
  FlaskConical: "science",

  // Finance / money
  DollarSign: "attach_money",
  CreditCard: "credit_card",
  Banknote: "payments",
  Wallet: "account_balance_wallet",
  Receipt: "receipt",
  Percent: "percent",
  TrendingUp: "trending_up",
  TrendingDown: "trending_down",

  // Time & calendar
  Calendar: "calendar_today",
  CalendarClock: "event",
  Clock: "schedule",
  History: "history",

  // Communication
  Bell: "notifications",
  Phone: "call",
  Mail: "mail",

  // Files & docs
  FileText: "description",
  FileQuestion: "quiz",
  FileSpreadsheet: "table_view",
  BookOpen: "menu_book",

  // Media
  Volume2: "volume_up",
  VolumeX: "volume_off",

  // Network & system
  Wifi: "wifi",
  WifiOff: "wifi_off",
  Cloud: "cloud",
  CloudOff: "cloud_off",
  Globe: "public",
  Plug: "electrical_services",
  Webhook: "webhook",

  // Theme toggles
  Sun: "light_mode",
  Moon: "dark_mode",

  // Misc
  Settings: "settings",
  Construction: "construction",
  Ruler: "straighten",
  MapPin: "location_on",
  Zap: "bolt",
  Cog: "settings",
};

/**
 * Icon không có mapping trong bảng trên → giữ nguyên lucide-react.
 * Codemod sẽ SKIP các usage này, không transform.
 */
export function hasMapping(lucideName: string): boolean {
  return lucideName in LUCIDE_TO_MATERIAL;
}

export function getMaterialName(lucideName: string): string | undefined {
  return LUCIDE_TO_MATERIAL[lucideName];
}
