"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sun, Moon, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettings, useToast } from "@/lib/contexts";
import { Icon } from "@/components/ui/icon";

const themes = [
  {
    id: "light",
    label: "Sáng",
    icon: Sun,
    preview: "bg-white border-border",
    previewInner: "bg-muted",
  },
  {
    id: "dark",
    label: "Tối",
    icon: Moon,
    preview: "bg-gray-900 border-gray-700",
    previewInner: "bg-gray-800",
  },
  {
    id: "system",
    label: "Hệ thống",
    icon: Monitor,
    preview:
      "bg-gradient-to-r from-white to-gray-900 border-gray-400",
    previewInner: "bg-gradient-to-r from-gray-100 to-gray-800",
  },
];

const accentColors = [
  { id: "blue", label: "Xanh dương", color: "bg-primary" },
  { id: "indigo", label: "Chàm", color: "bg-status-info" },
  { id: "purple", label: "Tím", color: "bg-status-info" },
  { id: "pink", label: "Hồng", color: "bg-pink-500" },
  { id: "red", label: "Đỏ", color: "bg-status-error" },
  { id: "orange", label: "Cam", color: "bg-status-warning" },
  { id: "green", label: "Xanh lá", color: "bg-status-success" },
  { id: "teal", label: "Xanh ngọc", color: "bg-teal-500" },
];

const fontSizes = [
  { id: "small", label: "Nhỏ", size: "text-xs" },
  { id: "medium", label: "Trung bình", size: "text-sm" },
  { id: "large", label: "Lớn", size: "text-base" },
];

const borderRadii = [
  { id: "none", label: "Không bo", radius: "rounded-none" },
  { id: "sm", label: "Nhẹ", radius: "rounded-sm" },
  { id: "md", label: "Trung bình", radius: "rounded-md" },
  { id: "lg", label: "Nhiều", radius: "rounded-xl" },
];

export default function AppearanceSettingsPage() {
  const { settings, updateSettings } = useSettings();
  const { toast } = useToast();

  const [theme, setTheme] = useState(settings.appearance.theme);
  const [accentColor, setAccentColor] = useState(settings.appearance.accentColor);
  const [navLayout, setNavLayout] = useState(settings.appearance.navLayout);
  const [fontSize, setFontSize] = useState(settings.appearance.fontSize);
  const [borderRadius, setBorderRadius] = useState(settings.appearance.borderRadius);

  useEffect(() => {
    setTheme(settings.appearance.theme);
    setAccentColor(settings.appearance.accentColor);
    setNavLayout(settings.appearance.navLayout);
    setFontSize(settings.appearance.fontSize);
    setBorderRadius(settings.appearance.borderRadius);
  }, [settings.appearance]);

  const handleSave = () => {
    updateSettings("appearance", {
      theme: theme as "light" | "dark" | "system",
      accentColor,
      navLayout: navLayout as "horizontal" | "vertical",
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
              const Icon = t.icon;
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
                      "h-20 rounded-md border mb-3 p-2",
                      t.preview
                    )}
                  >
                    <div
                      className={cn("h-2 w-12 rounded-full mb-1.5", t.previewInner)}
                    />
                    <div
                      className={cn("h-2 w-8 rounded-full", t.previewInner)}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4" />
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
                className="flex flex-col items-center gap-1.5"
                title={c.label}
              >
                <div
                  className={cn(
                    "h-10 w-10 rounded-full flex items-center justify-center transition-all",
                    c.color,
                    accentColor === c.id
                      ? "ring-2 ring-offset-2 ring-gray-400"
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

      <Card>
        <CardHeader>
          <CardTitle>Bố cục thanh điều hướng</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { id: "horizontal", label: "Ngang", desc: "Thanh điều hướng nằm ngang phía trên" },
              { id: "vertical", label: "Dọc", desc: "Thanh điều hướng dọc bên trái" },
            ].map((layout) => (
              <button
                key={layout.id}
                type="button"
                onClick={() => setNavLayout(layout.id as "horizontal" | "vertical")}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-4 text-left transition-colors",
                  navLayout === layout.id
                    ? "border-primary bg-primary/5 ring-2 ring-primary"
                    : "border-border hover:border-primary/50"
                )}
              >
                <div
                  className={cn(
                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                    navLayout === layout.id
                      ? "border-primary bg-primary"
                      : "border-muted-foreground"
                  )}
                >
                  {navLayout === layout.id && (
                    <div className="h-2 w-2 rounded-full bg-white" />
                  )}
                </div>
                <div>
                  <div className="text-sm font-medium">{layout.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {layout.desc}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Kích thước chữ</CardTitle>
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
                <span className={cn("font-medium", fs.size)}>{fs.label}</span>
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
                className={cn(
                  "h-3 w-20 rounded-full",
                  accentColors.find((c) => c.id === accentColor)?.color
                )}
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
                className={cn(
                  "h-2 w-24 rounded-full mb-2",
                  accentColors.find((c) => c.id === accentColor)?.color
                )}
              />
              <div className="space-y-1.5">
                <div className="h-2 w-full rounded-full bg-muted" />
                <div className="h-2 w-3/4 rounded-full bg-muted" />
                <div className="h-2 w-1/2 rounded-full bg-muted" />
              </div>
            </div>
            <div className="flex gap-2">
              <div
                className={cn(
                  "h-7 px-4 flex items-center text-xs text-white font-medium",
                  accentColors.find((c) => c.id === accentColor)?.color,
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
          <Icon name="save" size={16} className="mr-1.5" />
          Lưu thay đổi
        </Button>
      </div>
    </div>
  );
}
