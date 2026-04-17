#!/usr/bin/env node
/**
 * Codemod: lucide-react → Material Symbols (via <Icon /> component).
 *
 * Dùng: `node scripts/migrate-icons.mjs [--dry]` (từ root của repo).
 *
 * Chiến lược:
 *   1. Đọc mapping từ scripts/icon-mapping.ts (PascalName → snake_name).
 *   2. Duyệt mọi file .tsx trong src/ (glob).
 *   3. Với mỗi file có `from "lucide-react"`:
 *        - Xác định tập icon đang import.
 *        - Transform JSX: <Lucide /> → <Icon name="material_name" size={} />.
 *          + Size suy ra từ className h-X w-X (Tailwind: 1 unit = 4px).
 *          + className còn lại được giữ nguyên (trừ h-/w- size classes).
 *        - Nếu TẤT CẢ icon đã map → xoá lucide import, thêm Icon import.
 *        - Nếu CÒN icon chưa map → giữ lucide import cho các icon đó,
 *          thêm Icon import, chỉ transform các JSX đã match.
 *   4. Xuất log chi tiết: file đã đổi, icon chưa có mapping, usage không transform được.
 *
 * Non-JSX usage (VD: `icon: ChevronDown` trong nav-config) KHÔNG được transform
 * để tránh phá type. Codemod sẽ giữ nguyên lucide import cho các trường hợp này.
 */

import pkg from "ts-morph";
const { Project, SyntaxKind } = pkg;
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const srcDir = path.join(rootDir, "src");

const isDry = process.argv.includes("--dry");

// Load mapping table — import thủ công vì .ts file không chạy trực tiếp trong Node.
// Giải pháp: tái định nghĩa mapping ở đây. Giữ đồng bộ với scripts/icon-mapping.ts.
const LUCIDE_TO_MATERIAL = {
  AlertCircle: "error",
  AlertTriangle: "warning",
  CheckCircle2: "check_circle",
  XCircle: "cancel",
  Info: "info",
  ShieldAlert: "gpp_bad",
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
  DollarSign: "attach_money",
  CreditCard: "credit_card",
  Banknote: "payments",
  Wallet: "account_balance_wallet",
  Receipt: "receipt",
  Percent: "percent",
  TrendingUp: "trending_up",
  TrendingDown: "trending_down",
  Calendar: "calendar_today",
  CalendarClock: "event",
  Clock: "schedule",
  History: "history",
  Bell: "notifications",
  Phone: "call",
  Mail: "mail",
  FileText: "description",
  FileQuestion: "quiz",
  FileSpreadsheet: "table_view",
  BookOpen: "menu_book",
  Volume2: "volume_up",
  VolumeX: "volume_off",
  Wifi: "wifi",
  WifiOff: "wifi_off",
  Cloud: "cloud",
  CloudOff: "cloud_off",
  Globe: "public",
  Plug: "electrical_services",
  Webhook: "webhook",
  Sun: "light_mode",
  Moon: "dark_mode",
  Settings: "settings",
  Construction: "construction",
  Ruler: "straighten",
  MapPin: "location_on",
  Zap: "bolt",
  Cog: "settings",
};

// Tailwind size-class → pixel size cho Material Symbols.
// h-3 = 12px, h-4 = 16px, h-5 = 20px, h-6 = 24px, h-8 = 32px, ...
function parseClassNameSize(className) {
  if (!className) return null;
  const match = className.match(/\bh-(\d+(?:\.\d+)?)\b/);
  if (!match) return null;
  const units = parseFloat(match[1]);
  return Math.round(units * 4);
}

function stripSizeClasses(className) {
  if (!className) return className;
  return className
    .split(/\s+/)
    .filter((c) => !/^h-\d/.test(c) && !/^w-\d/.test(c))
    .join(" ")
    .trim();
}

const project = new Project({
  tsConfigFilePath: path.join(rootDir, "tsconfig.json"),
  skipAddingFilesFromTsConfig: true,
});

// Thêm file .tsx trong src/ (bỏ qua test + stories)
project.addSourceFilesAtPaths([
  path.join(srcDir, "**/*.tsx"),
  `!${path.join(srcDir, "**/*.test.tsx")}`,
  `!${path.join(srcDir, "**/*.stories.tsx")}`,
]);

const summary = {
  filesScanned: 0,
  filesModified: 0,
  jsxTransformed: 0,
  unmappedIcons: new Set(),
  skippedNonJsxUsage: [],
};

for (const sourceFile of project.getSourceFiles()) {
  summary.filesScanned++;
  const relPath = path.relative(rootDir, sourceFile.getFilePath());

  const lucideImport = sourceFile.getImportDeclaration(
    (decl) => decl.getModuleSpecifierValue() === "lucide-react",
  );
  if (!lucideImport) continue;

  const namedImports = lucideImport.getNamedImports();
  const iconsInFile = namedImports.map((n) => n.getName());

  // Build sub-sets: icons CÓ mapping vs KHÔNG
  const mapped = iconsInFile.filter((n) => n in LUCIDE_TO_MATERIAL);
  const unmapped = iconsInFile.filter(
    (n) => !(n in LUCIDE_TO_MATERIAL) && n !== "LucideIcon",
  );
  unmapped.forEach((n) => summary.unmappedIcons.add(n));

  if (mapped.length === 0) {
    // File chỉ dùng icon chưa map → bỏ qua file này.
    continue;
  }

  let fileModified = false;

  // Duyệt JSX usage của các icon đã map
  for (const iconName of mapped) {
    const materialName = LUCIDE_TO_MATERIAL[iconName];

    // Tìm mọi JsxSelfClosingElement và JsxOpeningElement có tag = iconName
    const selfClosings = sourceFile
      .getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)
      .filter((el) => el.getTagNameNode().getText() === iconName);
    const openings = sourceFile
      .getDescendantsOfKind(SyntaxKind.JsxOpeningElement)
      .filter((el) => el.getTagNameNode().getText() === iconName);

    for (const jsx of [...selfClosings, ...openings]) {
      // Lấy className attribute value (nếu string literal)
      const classNameAttr = jsx
        .getAttributes()
        .find(
          (attr) =>
            attr.getKind() === SyntaxKind.JsxAttribute &&
            attr.getNameNode().getText() === "className",
        );

      let size = 20; // default
      let classNameInitializerText = null;

      if (classNameAttr) {
        const init = classNameAttr.getInitializer();
        if (init) {
          if (init.getKind() === SyntaxKind.StringLiteral) {
            const raw = init.getLiteralValue();
            const parsedSize = parseClassNameSize(raw);
            if (parsedSize) size = parsedSize;
            const stripped = stripSizeClasses(raw);
            classNameInitializerText = stripped
              ? `"${stripped}"`
              : null;
          } else if (init.getKind() === SyntaxKind.JsxExpression) {
            // className={expr} — không parse, giữ nguyên
            classNameInitializerText = init.getText(); // "{...}"
          }
        }
      }

      // Đổi tag name → Icon
      jsx.getTagNameNode().replaceWithText("Icon");

      // Thêm / sửa attribute name="material_name" và size={N}
      // Dùng setAttribute helper từ ts-morph
      // Xoá attribute className cũ nếu có thay đổi
      const currentAttrs = jsx.getAttributes();
      const existingNameAttr = currentAttrs.find(
        (a) =>
          a.getKind() === SyntaxKind.JsxAttribute &&
          a.getNameNode().getText() === "name",
      );
      if (existingNameAttr) existingNameAttr.remove();

      const existingSizeAttr = currentAttrs.find(
        (a) =>
          a.getKind() === SyntaxKind.JsxAttribute &&
          a.getNameNode().getText() === "size",
      );
      if (existingSizeAttr) existingSizeAttr.remove();

      // Rebuild className if needed
      if (classNameAttr) {
        const nameNode = classNameAttr.getNameNode();
        if (classNameInitializerText === null) {
          classNameAttr.remove();
        } else {
          // Set initializer to new text
          classNameAttr.setInitializer(classNameInitializerText);
        }
      }

      // Thêm name + size lên đầu
      jsx.insertAttribute(0, {
        name: "name",
        initializer: `"${materialName}"`,
      });
      if (size !== 20) {
        jsx.insertAttribute(1, {
          name: "size",
          initializer: `{${size}}`,
        });
      }

      summary.jsxTransformed++;
      fileModified = true;
    }

    // Kiểm tra còn ref ngoài JSX (VD: `const I = ChevronDown; icon: ChevronDown`)
    const identifierRefs = sourceFile
      .getDescendantsOfKind(SyntaxKind.Identifier)
      .filter((id) => id.getText() === iconName);

    // Nếu còn identifier ngoài import + JSX tag name → non-JSX usage
    const nonJsxRefs = identifierRefs.filter((id) => {
      const parent = id.getParent();
      if (!parent) return false;
      // Skip: nằm trong ImportSpecifier
      if (parent.getKind() === SyntaxKind.ImportSpecifier) return false;
      // Skip: nằm trong JsxTagName (đã được đổi)
      if (
        parent.getKind() === SyntaxKind.JsxSelfClosingElement ||
        parent.getKind() === SyntaxKind.JsxOpeningElement ||
        parent.getKind() === SyntaxKind.JsxClosingElement
      ) {
        return false;
      }
      return true;
    });

    if (nonJsxRefs.length > 0) {
      summary.skippedNonJsxUsage.push({
        file: relPath,
        icon: iconName,
        count: nonJsxRefs.length,
      });
    }
  }

  if (!fileModified) continue;

  // Xoá các namedImport đã map HẾT trong JSX
  // (Nếu vẫn còn nonJsxRefs → giữ lại named import cho icon đó)
  const remainingMapped = mapped.filter((n) =>
    summary.skippedNonJsxUsage.some(
      (x) => x.file === relPath && x.icon === n,
    ),
  );
  const newNamedImports = iconsInFile.filter(
    (n) =>
      !(n in LUCIDE_TO_MATERIAL) ||
      remainingMapped.includes(n) ||
      n === "LucideIcon",
  );

  if (newNamedImports.length === 0) {
    lucideImport.remove();
  } else {
    lucideImport.getNamedImports().forEach((ni) => {
      if (!newNamedImports.includes(ni.getName())) ni.remove();
    });
  }

  // Thêm Icon import nếu chưa có
  const iconImport = sourceFile.getImportDeclaration(
    (decl) => decl.getModuleSpecifierValue() === "@/components/ui/icon",
  );
  if (!iconImport) {
    sourceFile.addImportDeclaration({
      moduleSpecifier: "@/components/ui/icon",
      namedImports: ["Icon"],
    });
  } else {
    const existing = iconImport.getNamedImports().map((n) => n.getName());
    if (!existing.includes("Icon")) {
      iconImport.addNamedImport("Icon");
    }
  }

  summary.filesModified++;
}

// Save / dry-run
if (!isDry) {
  await project.save();
}

// Report
console.log("───────────────────────────────────────────");
console.log("Icon migration codemod summary");
console.log("───────────────────────────────────────────");
console.log(`Files scanned:    ${summary.filesScanned}`);
console.log(`Files modified:   ${summary.filesModified}`);
console.log(`JSX transformed:  ${summary.jsxTransformed}`);
console.log(
  `Unmapped icons (${summary.unmappedIcons.size}): ${[...summary.unmappedIcons].join(", ")}`,
);
console.log(`Non-JSX usage kept as lucide:`);
for (const s of summary.skippedNonJsxUsage) {
  console.log(`  - ${s.file}: ${s.icon} (${s.count} refs)`);
}
console.log(isDry ? "\n(DRY RUN — no files written)" : "\nSaved.");
