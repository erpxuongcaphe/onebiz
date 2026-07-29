"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useSettings, useToast } from "@/lib/contexts";
import { Icon } from "@/components/ui/icon";

const themes = [
  {
    id: "light",
    label: "Sáng",
    icon: "light_mode",
    preview: "bg-white border-border",
    previewInner: "bg-muted",
  },
  {
    id: "dark",
    label: "Tối",
    icon: "dark_mode",
    preview: "bg-gray-900 border-gray-700",
    previewInner: "bg-gray-800",
  },
  {
    id: "system",
    label: "Hệ thống",
    icon: "desktop_windows",
    preview:
      "bg-gradient-to-r from-white to-gray-900 border-gray-400",
    previewInner: "bg-gradient-to-r from-gray-100 to-gray-800",
  },
];

// Ô xem trước dùng ĐÚNG màu sẽ được áp (khớp bảng ACCENTS trong
// components/shared/appearance.tsx). Trước 29/07 "Chàm" và "Tím" cùng trỏ
// bg-status-info nên hai ô nhìn y hệt nhau, chọn xong không biết mình chọn gì.
const accentColors = [
  { id: "blue", label: "Xanh dương", hex: "oklch(0.43 0.19 263)" },
  { id: "indigo", label: "Chàm", hex: "oklch(0.45 0.20 285)" },
  { id: "purple", label: "Tím", hex: "oklch(0.48 0.22 305)" },
  { id: "pink", label: "Hồng", hex: "oklch(0.58 0.22 355)" },
  { id: "red", label: "Đỏ", hex: "oklch(0.53 0.21 27)" },
  { id: "orange", label: "Cam", hex: "oklch(0.62 0.18 55)" },
  { id: "green", label: "Xanh lá", hex: "oklch(0.52 0.15 155)" },
  { id: "teal", label: "Xanh ngọc", hex: "oklch(0.55 0.12 195)" },
];

const fontSizes = [
  { id: "small", label: "Nhỏ", size: "text-xs", hint: "Thấy nhiều nội dung nhất" },
  { id: "medium", label: "Vừa", size: "text-sm", hint: "Cỡ chuẩn" },
  { id: "large", label: "Lớn", size: "text-base", hint: "Dễ đọc nhất" },
];

const borderRadii = [
  { id: "none", label: "Không bo", radius: "rounded-none" },
  { id: "sm", label: "Nhẹ", radius: "rounded-sm" },
  { id: "md", label: "Trung bình", radius: "rounded-lg" },
  { id: "lg", label: "Nhiều", radius: "rounded-xl" },
];

export default function AppearanceSettingsPage() {
  const { settings, updateSettings } = useSettings();
  const { toast } = useToast();

  const [theme, setTheme] = useState(settings.appearance.theme);
  const [accentColor, setAccentColor] = useState(settings.appearance.accentColor);
  const [fontSize, setFontSize] = useState(settings.appearance.fontSize);
  const [borderRadius, setBorderRadius] = useState(settings.appearance.borderRadius);

  useEffect(() => {
    setTheme(settings.appearance.theme);
    setAccentColor(settings.appearance.accentColor);
    setFontSize(settings.appearance.fontSize);
    setBorderRadius(settings.appearance.borderRadius);
  }, [settings.appearance]);

  // Màu đang chọn — dùng cho cả ô chọn lẫn khung Xem trước bên dưới.
  const mauDangChon =
    accentColors.find((c) => c.id === accentColor)?.hex ?? accentColors[0].hex;

  const handleSave = () => {
    updateSettings("appearance", {
      theme: theme as "light" | "dark" | "system",
      accentColor,
      // navLayout giữ nguyên giá trị cũ — ô chọn đã bỏ (xem ghi chú bên dưới)
      navLayout: settings.appearance.navLayout,
      fontSize: fontSize as "small" | "medium" | "large",
      borderRadius: borderRadius as "none" | "sm" | "md" | "lg",
    });
    toast({
      title: "Đã lưu",
      description: "Cài đặt giao diện đã được cập nhật",
      variant: "success",
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Giao diện</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Tùy chỉnh giao diện ứng dụng theo sở thích của bạn
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Chủ đề</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            {themes.map((t) => {
              const isSelected = theme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTheme(t.id as "light" | "dark" | "system")}
                  className={cn(
                    "group relative rounded-lg border-2 p-3 text-left transition-all",
                    isSelected
                      ? "border-primary ring-2 ring-primary"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  {/* Theme preview */}
                  <div
                    className={cn(
                      "h-20 rounded-lg border mb-3 p-2",
                      t.preview
                    )}
                  >
                    <div
                      className={cn("h-2 w-12 rounded-full mb-2", t.previewInner)}
                    />
                    <div
                      className={cn("h-2 w-8 rounded-full", t.previewInner)}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Icon name={t.icon} size={16} />
                    <span className="text-sm font-medium">{t.label}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Màu chủ đạo</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {accentColors.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setAccentColor(c.id)}
                className="flex flex-col items-center gap-2"
                title={c.label}
              >
                <div
                  style={{ backgroundColor: c.hex }}
                  className={cn(
                    "h-10 w-10 rounded-full flex items-center justify-center transition-all",
                    accentColor === c.id
                      ? "ring-2 ring-offset-2 ring-foreground/40"
                      : "hover:scale-110"
                  )}
                >
                  {accentColor === c.id && (
                    <Icon name="check" className="text-white" />
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {c.label}
                </span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 29/07: bỏ ô "Bố cục thanh điều hướng". Toàn bộ back-office dựng trên
          thanh dọc bên trái + thanh trên cố định; làm bản "ngang" là dựng lại
          khung của mọi trang, trong khi không ai đổi kiểu điều hướng hằng ngày.
          Để ô đó nằm lại chỉ là một nút bấm không có tác dụng. */}

      <Card>
        <CardHeader>
          <CardTitle>Cỡ chữ</CardTitle>
          <CardDescription>
            Áp cho toàn bộ khu quản lý. Màn bán hàng giữ nguyên cỡ chuẩn để nút
            bấm không bị nhỏ khi dùng máy tính bảng. Bản in luôn cỡ chuẩn.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            {fontSizes.map((fs) => (
              <button
                key={fs.id}
                type="button"
                onClick={() => setFontSize(fs.id as "small" | "medium" | "large")}
                className={cn(
                  "flex-1 rounded-lg border p-3 text-center transition-colors",
                  fontSize === fs.id
                    ? "border-primary bg-primary/5 ring-2 ring-primary"
                    : "border-border hover:border-primary/50"
                )}
              >
                <span className={cn("block font-medium", fs.size)}>{fs.label}</span>
                <span className="mt-0.5 block text-[0.6875rem] text-muted-foreground">
                  {fs.hint}
                </span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bo góc</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            {borderRadii.map((br) => (
              <button
                key={br.id}
                type="button"
                onClick={() => setBorderRadius(br.id as "none" | "sm" | "md" | "lg")}
                className={cn(
                  "flex-1 flex flex-col items-center gap-2 rounded-lg border p-3 transition-colors",
                  borderRadius === br.id
                    ? "border-primary bg-primary/5 ring-2 ring-primary"
                    : "border-border hover:border-primary/50"
                )}
              >
                <div
                  className={cn(
                    "h-8 w-12 border-2 border-primary/60 bg-primary/10",
                    br.radius
                  )}
                />
                <span className="text-xs font-medium">{br.label}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Preview */}
      <Card>
        <CardHeader>
          <CardTitle>Xem trước</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div
                style={{ backgroundColor: mauDangChon }}
                className="h-3 w-20 rounded-full"
              />
              <div className="h-3 w-16 rounded-full bg-muted" />
              <div className="h-3 w-12 rounded-full bg-muted" />
            </div>
            <div
              className={cn(
                "p-3 border bg-background",
                borderRadii.find((b) => b.id === borderRadius)?.radius
              )}
            >
              <div
                style={{ backgroundColor: mauDangChon }}
                className="h-2 w-24 rounded-full mb-2"
              />
              <div className="space-y-2">
                <div className="h-2 w-full rounded-full bg-muted" />
                <div className="h-2 w-3/4 rounded-full bg-muted" />
                <div className="h-2 w-1/2 rounded-full bg-muted" />
              </div>
            </div>
            <div className="flex gap-2">
              <div
                style={{ backgroundColor: mauDangChon }}
                className={cn(
                  "h-7 px-4 flex items-center text-xs text-white font-medium",
                  borderRadii.find((b) => b.id === borderRadius)?.radius
                )}
              >
                Button
              </div>
              <div
                className={cn(
                  "h-7 px-4 flex items-center text-xs border font-medium",
                  borderRadii.find((b) => b.id === borderRadius)?.radius
                )}
              >
                Outline
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Separator />

      <div className="flex justify-end">
        <Button onClick={handleSave}>
          <Icon name="save" size={16} className="mr-1" />
          Lưu thay đổi
        </Button>
      </div>
    </div>
  );
}
