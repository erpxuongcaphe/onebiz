"use client";

import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { Icon } from "@/components/ui/icon";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  clearReportTablePreferences,
  readReportTablePreferences,
  writeReportTablePreferences,
  type ReportTablePreferences,
} from "@/lib/reports/preferences";

export const DEFAULT_REPORT_TABLE_PREFERENCES: ReportTablePreferences = {
  density: "standard",
  wrapText: true,
  freezeFirstColumn: false,
  stripedRows: true,
  hiddenColumnKeys: [],
};

export interface ReportTableDisplayColumn {
  id: string;
  label: string;
  required?: boolean;
}

export function useReportTableDisplayPreferences(
  preferenceKey: string,
  enabled = true,
) {
  const [preferences, setPreferences] = useState<ReportTablePreferences>(
    DEFAULT_REPORT_TABLE_PREFERENCES,
  );
  const [loadedPreferenceKey, setLoadedPreferenceKey] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => {
      const saved = readReportTablePreferences(preferenceKey);
      setPreferences({
        ...DEFAULT_REPORT_TABLE_PREFERENCES,
        ...saved,
        hiddenColumnKeys: saved.hiddenColumnKeys ?? [],
      });
      setLoadedPreferenceKey(preferenceKey);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [enabled, preferenceKey]);

  useEffect(() => {
    if (!enabled || loadedPreferenceKey !== preferenceKey) return;
    writeReportTablePreferences(preferenceKey, preferences);
  }, [enabled, loadedPreferenceKey, preferenceKey, preferences]);

  const hiddenColumnKeys = useMemo(
    () => new Set(preferences.hiddenColumnKeys),
    [preferences.hiddenColumnKeys],
  );

  const resetDisplay = () => {
    clearReportTablePreferences(preferenceKey);
    setPreferences(DEFAULT_REPORT_TABLE_PREFERENCES);
  };

  return {
    preferences,
    setPreferences,
    hiddenColumnKeys,
    resetDisplay,
  };
}

interface ReportTableDisplayMenuProps {
  columns: ReportTableDisplayColumn[];
  preferences: ReportTablePreferences;
  setPreferences: Dispatch<SetStateAction<ReportTablePreferences>>;
  onReset: () => void;
  disableFreeze?: boolean;
}

const LABEL = {
  trigger: "Hi\u1ec3n th\u1ecb b\u1ea3ng",
  density: "M\u1eadt \u0111\u1ed9 b\u1ea3ng",
  standard: "Ti\u00eau chu\u1ea9n",
  compact: "G\u1ecdn",
  layout: "C\u00e1ch tr\u00ecnh b\u00e0y",
  wrap: "Xu\u1ed1ng d\u00f2ng n\u1ed9i dung d\u00e0i",
  freeze: "C\u1ed1 \u0111\u1ecbnh c\u1ed9t \u0111\u1ea7u",
  stripes: "K\u1ebb d\u00f2ng xen k\u1ebd",
  visibleColumns: "C\u1ed9t hi\u1ec3n th\u1ecb",
  chooseColumns: "Ch\u1ecdn c\u1ed9t tr\u00ean b\u1ea3ng",
  required: "B\u1eaft bu\u1ed9c",
  searchColumns: "T\u00ecm c\u1ed9t",
  noColumns: "Kh\u00f4ng c\u00f3 c\u1ed9t ph\u00f9 h\u1ee3p",
  showAll: "Hi\u1ec7n t\u1ea5t c\u1ea3 c\u1ed9t",
  reset: "Kh\u00f4i ph\u1ee5c m\u1eb7c \u0111\u1ecbnh",
};

export function ReportTableDisplayMenu({
  columns,
  preferences,
  setPreferences,
  onReset,
  disableFreeze = false,
}: ReportTableDisplayMenuProps) {
  const [columnSearch, setColumnSearch] = useState("");
  const hiddenColumnKeys = useMemo(
    () => new Set(preferences.hiddenColumnKeys),
    [preferences.hiddenColumnKeys],
  );
  const visibleCount = columns.filter(
    (column) => column.required || !hiddenColumnKeys.has(column.id),
  ).length;
  const filteredColumns = useMemo(() => {
    const query = columnSearch.trim().toLocaleLowerCase("vi-VN");
    if (!query) return columns;
    return columns.filter((column) =>
      column.label.toLocaleLowerCase("vi-VN").includes(query),
    );
  }, [columnSearch, columns]);

  const setColumnVisible = (columnId: string, visible: boolean) => {
    setPreferences((current) => {
      const hidden = new Set(current.hiddenColumnKeys);
      if (visible) hidden.delete(columnId);
      else hidden.add(columnId);
      return { ...current, hiddenColumnKeys: Array.from(hidden) };
    });
  };

  return (
    <div className="sticky left-0 z-20 flex min-h-9 min-w-full items-center justify-end border-b border-border/60 px-2 py-1">
      <DropdownMenu>
        <DropdownMenuTrigger className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none hover:bg-surface-container hover:text-foreground">
          <Icon name="tune" size={14} />
          {LABEL.trigger}
          <Icon name="expand_more" size={14} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuLabel>{LABEL.density}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={preferences.density}
            onValueChange={(value) => {
              if (value === "standard" || value === "compact") {
                setPreferences((current) => ({
                  ...current,
                  density: value,
                }));
              }
            }}
          >
            <DropdownMenuRadioItem value="standard">
              {LABEL.standard}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="compact">
              {LABEL.compact}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{LABEL.layout}</DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            checked={preferences.wrapText}
            onCheckedChange={(checked) =>
              setPreferences((current) => ({
                ...current,
                wrapText: checked === true,
              }))
            }
          >
            {LABEL.wrap}
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={preferences.freezeFirstColumn}
            disabled={disableFreeze}
            onCheckedChange={(checked) =>
              setPreferences((current) => ({
                ...current,
                freezeFirstColumn: checked === true,
              }))
            }
          >
            {LABEL.freeze}
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={preferences.stripedRows}
            onCheckedChange={(checked) =>
              setPreferences((current) => ({
                ...current,
                stripedRows: checked === true,
              }))
            }
          >
            {LABEL.stripes}
          </DropdownMenuCheckboxItem>
          {columns.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Icon name="view_column" size={14} />
                  {LABEL.visibleColumns}
                  <span className="ml-auto mr-1 text-xs text-muted-foreground">
                    {visibleCount}/{columns.length}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-72 p-1">
                  <DropdownMenuLabel>{LABEL.chooseColumns}</DropdownMenuLabel>
                  <div className="px-1 pb-1">
                    <div className="relative">
                      <Icon
                        name="search"
                        size={14}
                        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                      />
                      <input
                        value={columnSearch}
                        onChange={(event) => setColumnSearch(event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                        placeholder={LABEL.searchColumns}
                        className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-2 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                      />
                    </div>
                  </div>
                  <div className="max-h-[52vh] overflow-y-auto pr-1">
                    {filteredColumns.map((column) => {
                      const visible =
                        column.required || !hiddenColumnKeys.has(column.id);
                      return (
                        <DropdownMenuCheckboxItem
                          key={column.id}
                          checked={visible}
                          disabled={column.required}
                          closeOnClick={false}
                          onCheckedChange={(checked) =>
                            setColumnVisible(column.id, checked === true)
                          }
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {column.label}
                          </span>
                          {column.required && (
                            <span className="text-[10px] text-muted-foreground">
                              {LABEL.required}
                            </span>
                          )}
                        </DropdownMenuCheckboxItem>
                      );
                    })}
                    {filteredColumns.length === 0 && (
                      <div className="px-2 py-3 text-xs text-muted-foreground">
                        {LABEL.noColumns}
                      </div>
                    )}
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={preferences.hiddenColumnKeys.length === 0}
                    closeOnClick={false}
                    onSelect={() =>
                      setPreferences((current) => ({
                        ...current,
                        hiddenColumnKeys: [],
                      }))
                    }
                  >
                    <Icon name="select_all" size={14} />
                    {LABEL.showAll}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onReset}>
            <Icon name="restart_alt" size={14} />
            {LABEL.reset}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

