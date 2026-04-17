"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useSettings, useToast } from "@/lib/contexts";
import { Icon } from "@/components/ui/icon";

const languages = [
  { id: "vi", label: "Tiếng Việt", flag: "\u{1F1FB}\u{1F1F3}" },
  { id: "en", label: "English", flag: "\u{1F1EC}\u{1F1E7}" },
  { id: "ja", label: "\u65E5\u672C\u8A9E", flag: "\u{1F1EF}\u{1F1F5}" },
];

// Mapping between UI date format values and settings date format values
const dateFormatToSettings: Record<string, "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD"> = {
  "dd/MM/yyyy": "DD/MM/YYYY",
  "MM/dd/yyyy": "MM/DD/YYYY",
  "yyyy-MM-dd": "YYYY-MM-DD",
};

const dateFormatFromSettings: Record<string, string> = {
  "DD/MM/YYYY": "dd/MM/yyyy",
  "MM/DD/YYYY": "MM/dd/yyyy",
  "YYYY-MM-DD": "yyyy-MM-dd",
};

// Mapping between UI timezone values and settings timezone values
const timezoneToSettings: Record<string, string> = {
  "asia-hcm": "Asia/Ho_Chi_Minh",
  "asia-tokyo": "Asia/Tokyo",
  "utc": "UTC",
};

const timezoneFromSettings: Record<string, string> = {
  "Asia/Ho_Chi_Minh": "asia-hcm",
  "Asia/Tokyo": "asia-tokyo",
  "UTC": "utc",
};

export default function LanguageSettingsPage() {
  const { settings, updateSettings } = useSettings();
  const { toast } = useToast();

  // Initialize local form state from settings
  const [language, setLanguage] = useState(settings.language.locale);
  const [numberFormat, setNumberFormat] = useState("vi");
  const [dateFormat, setDateFormat] = useState(
    dateFormatFromSettings[settings.language.dateFormat] ?? "dd/MM/yyyy"
  );
  const [timezone, setTimezone] = useState(
    timezoneFromSettings[settings.language.timezone] ?? "asia-hcm"
  );
  const [currency, setCurrency] = useState(settings.language.currency);

  // Sync local state when settings change externally
  useEffect(() => {
    setLanguage(settings.language.locale);
    setCurrency(settings.language.currency);
    setDateFormat(
      dateFormatFromSettings[settings.language.dateFormat] ?? "dd/MM/yyyy"
    );
    setTimezone(
      timezoneFromSettings[settings.language.timezone] ?? "asia-hcm"
    );
  }, [settings.language]);

  const handleSave = () => {
    updateSettings("language", {
      locale: language as "vi" | "en",
      currency: currency as "VND" | "USD",
      dateFormat: dateFormatToSettings[dateFormat] ?? "DD/MM/YYYY",
      timezone: timezoneToSettings[timezone] ?? "Asia/Ho_Chi_Minh",
    });
    toast({
      title: "Đã lưu thay đổi",
      description: "Cài đặt ngôn ngữ & vùng đã được cập nhật.",
      variant: "success",
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Ngôn ngữ & Vùng</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Tùy chỉnh ngôn ngữ, định dạng và múi giờ
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ngôn ngữ hiển thị</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            {languages.map((lang) => (
              <button
                key={lang.id}
                type="button"
                onClick={() => setLanguage(lang.id as "vi" | "en")}
                className={cn(
                  "flex items-center gap-3 rounded-lg border p-4 text-left transition-colors",
                  language === lang.id
                    ? "border-primary bg-primary/5 ring-2 ring-primary"
                    : "border-border hover:border-primary/50"
                )}
              >
                <span className="text-2xl">{lang.flag}</span>
                <span className="text-sm font-medium">{lang.label}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Định dạng</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Định dạng số</label>
              <Select value={numberFormat} onValueChange={(v) => v && setNumberFormat(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vi">1.000.000 (Việt Nam)</SelectItem>
                  <SelectItem value="en">1,000,000 (English)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Định dạng ngày</label>
              <Select value={dateFormat} onValueChange={(v) => v && setDateFormat(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dd/MM/yyyy">dd/MM/yyyy</SelectItem>
                  <SelectItem value="MM/dd/yyyy">MM/dd/yyyy</SelectItem>
                  <SelectItem value="yyyy-MM-dd">yyyy-MM-dd</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Múi giờ</label>
              <Select value={timezone} onValueChange={(v) => v && setTimezone(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="asia-hcm">
                    Asia/Ho_Chi_Minh (UTC+7)
                  </SelectItem>
                  <SelectItem value="asia-tokyo">
                    Asia/Tokyo (UTC+9)
                  </SelectItem>
                  <SelectItem value="utc">UTC (UTC+0)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Đơn vị tiền tệ</label>
              <Select value={currency} onValueChange={(v) => v && setCurrency(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="VND">VND - Việt Nam Đồng</SelectItem>
                  <SelectItem value="USD">USD - US Dollar</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Separator />

      <div className="flex justify-end">
        <Button onClick={handleSave}>
          <Icon name="save" size={16} className="mr-1.5" />
          Lưu thay đổi
        </Button>
      </div>
    </div>
  );
}
