"use client";

import { useState } from "react";
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
import { Save, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

function Toggle({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange: (val: boolean) => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm font-medium">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
          checked ? "bg-primary" : "bg-muted"
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-4" : "translate-x-0"
          )}
        />
      </button>
    </div>
  );
}

const templates = [
  { id: "58mm", label: "Mẫu 58mm", desc: "Máy in bill nhỏ" },
  { id: "80mm", label: "Mẫu 80mm", desc: "Máy in bill tiêu chuẩn" },
  { id: "a4", label: "Mẫu A4", desc: "In giấy A4" },
  { id: "a5", label: "Mẫu A5", desc: "In giấy A5" },
];

export default function PrintSettingsPage() {
  const [selectedTemplate, setSelectedTemplate] = useState("80mm");
  const [showLogo, setShowLogo] = useState(true);
  const [showStoreName, setShowStoreName] = useState(true);
  const [showAddress, setShowAddress] = useState(true);
  const [showPhone, setShowPhone] = useState(true);
  const [showBarcode, setShowBarcode] = useState(true);
  const [showNote, setShowNote] = useState(false);
  const [defaultPrinter, setDefaultPrinter] = useState("printer1");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cài đặt in ấn</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Tùy chỉnh mẫu in và máy in
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Mẫu in hóa đơn</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {templates.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => setSelectedTemplate(tpl.id)}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-4 text-left transition-colors",
                  selectedTemplate === tpl.id
                    ? "border-primary bg-primary/5 ring-2 ring-primary"
                    : "border-border hover:border-primary/50"
                )}
              >
                <div
                  className={cn(
                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                    selectedTemplate === tpl.id
                      ? "border-primary bg-primary"
                      : "border-muted-foreground"
                  )}
                >
                  {selectedTemplate === tpl.id && (
                    <div className="h-2 w-2 rounded-full bg-white" />
                  )}
                </div>
                <div>
                  <div className="text-sm font-medium">{tpl.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {tpl.desc}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Preview placeholder */}
          <div className="mt-4 rounded-lg border bg-muted/30 p-6 text-center">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              Xem trước mẫu {templates.find((t) => t.id === selectedTemplate)?.label}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nội dung in</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            <Toggle checked={showLogo} onCheckedChange={setShowLogo} label="Logo" />
            <Toggle
              checked={showStoreName}
              onCheckedChange={setShowStoreName}
              label="Tên cửa hàng"
            />
            <Toggle
              checked={showAddress}
              onCheckedChange={setShowAddress}
              label="Địa chỉ"
            />
            <Toggle checked={showPhone} onCheckedChange={setShowPhone} label="SĐT" />
            <Toggle
              checked={showBarcode}
              onCheckedChange={setShowBarcode}
              label="Mã vạch"
            />
            <Toggle
              checked={showNote}
              onCheckedChange={setShowNote}
              label="Ghi chú"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Máy in mặc định</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-w-sm space-y-2">
            <label className="text-sm font-medium">Chọn máy in</label>
            <Select value={defaultPrinter} onValueChange={(v) => v && setDefaultPrinter(v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="printer1">EPSON TM-T82 (USB)</SelectItem>
                <SelectItem value="printer2">Xprinter XP-58 (Bluetooth)</SelectItem>
                <SelectItem value="printer3">HP LaserJet Pro (Network)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Separator />

      <div className="flex justify-end">
        <Button>
          <Save className="h-4 w-4 mr-1.5" />
          Lưu thay đổi
        </Button>
      </div>
    </div>
  );
}
