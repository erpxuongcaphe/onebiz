"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Upload, Save } from "lucide-react";
import { useSettings, useToast } from "@/lib/contexts";

export default function StoreSettingsPage() {
  const { settings, updateSettings } = useSettings();
  const { toast } = useToast();

  const [storeName, setStoreName] = useState(settings.store.name);
  const [phone, setPhone] = useState(settings.store.phone);
  const [email, setEmail] = useState(settings.store.email);
  const [address, setAddress] = useState(settings.store.address);
  const [taxCode, setTaxCode] = useState(settings.store.taxCode);
  const [businessType, setBusinessType] = useState(settings.store.businessType);
  const [foundingDate, setFoundingDate] = useState(settings.store.foundingDate);

  // Sync local state when settings change (e.g. after hydration from localStorage)
  useEffect(() => {
    setStoreName(settings.store.name);
    setPhone(settings.store.phone);
    setEmail(settings.store.email);
    setAddress(settings.store.address);
    setTaxCode(settings.store.taxCode);
    setBusinessType(settings.store.businessType);
    setFoundingDate(settings.store.foundingDate);
  }, [settings.store]);

  const handleSave = () => {
    updateSettings("store", {
      name: storeName,
      phone,
      email,
      address,
      taxCode,
      businessType,
      foundingDate,
    });
    toast({
      title: "Đã lưu thay đổi",
      description: "Thông tin cửa hàng đã được cập nhật thành công.",
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cài đặt cửa hàng</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Quản lý thông tin cửa hàng của bạn
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Thông tin cửa hàng</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Tên cửa hàng</label>
              <Input
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Số điện thoại</label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Mã số thuế</label>
              <Input
                value={taxCode}
                onChange={(e) => setTaxCode(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2 space-y-2">
              <label className="text-sm font-medium">Địa chỉ</label>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Logo</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer">
            <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm font-medium">
              Kéo thả hoặc nhấn để tải lên
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              PNG, JPG tối đa 2MB. Kích thước khuyến nghị: 200x200px
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Thông tin bổ sung</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Loại hình kinh doanh</label>
              <Select value={businessType} onValueChange={(v) => v && setBusinessType(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="retail">Bán lẻ</SelectItem>
                  <SelectItem value="wholesale">Bán sỉ</SelectItem>
                  <SelectItem value="fnb">F&B - Nhà hàng / Café</SelectItem>
                  <SelectItem value="service">Dịch vụ</SelectItem>
                  <SelectItem value="other">Khác</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Ngày thành lập</label>
              <Input
                type="date"
                value={foundingDate}
                onChange={(e) => setFoundingDate(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Separator />

      <div className="flex justify-end">
        <Button onClick={handleSave}>
          <Save className="h-4 w-4 mr-1.5" />
          Lưu thay đổi
        </Button>
      </div>
    </div>
  );
}
