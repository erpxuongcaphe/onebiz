"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

interface PriceBook {
  id: string;
  name: string;
  isDefault: boolean;
  productCount: number;
  status: "active" | "paused";
}

const mockPriceBooks: PriceBook[] = [
  {
    id: "1",
    name: "Giá bán lẻ",
    isDefault: true,
    productCount: 156,
    status: "active",
  },
  {
    id: "2",
    name: "Giá sỉ",
    isDefault: false,
    productCount: 89,
    status: "active",
  },
  {
    id: "3",
    name: "Giá đại lý",
    isDefault: false,
    productCount: 45,
    status: "paused",
  },
];

export default function PriceBookSettingsPage() {
  const [priceRule, setPriceRule] = useState<
    "customer" | "branch" | "lowest"
  >("customer");

  const rules = [
    {
      value: "customer" as const,
      label: "Ưu tiên bảng giá khách hàng",
      description:
        "Áp dụng bảng giá được gán cho nhóm khách hàng trước tiên",
    },
    {
      value: "branch" as const,
      label: "Ưu tiên bảng giá chi nhánh",
      description:
        "Áp dụng bảng giá được gán cho chi nhánh bán hàng trước tiên",
    },
    {
      value: "lowest" as const,
      label: "Áp dụng giá thấp nhất",
      description:
        "Tự động chọn mức giá thấp nhất giữa các bảng giá áp dụng",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Quản lý bảng giá</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Tạo bảng giá riêng cho từng nhóm khách hàng hoặc chi nhánh
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bảng giá hiện có</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {mockPriceBooks.map((book) => (
              <div
                key={book.id}
                className="flex items-center justify-between rounded-lg border p-4"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{book.name}</span>
                    {book.isDefault && (
                      <Badge
                        variant="default"
                        className="bg-primary-fixed text-primary hover:bg-primary-fixed text-xs"
                      >
                        Mặc định
                      </Badge>
                    )}
                    <Badge
                      variant={
                        book.status === "active" ? "default" : "secondary"
                      }
                      className={cn(
                        "text-xs",
                        book.status === "active"
                          ? "bg-status-success/10 text-status-success hover:bg-status-success/10"
                          : "bg-muted text-muted-foreground hover:bg-muted"
                      )}
                    >
                      {book.status === "active" ? "Đang áp dụng" : "Tạm ngưng"}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {book.productCount} sản phẩm
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm">
                    <Icon name="edit" size={14} className="mr-1" />
                    Chỉnh sửa
                  </Button>
                  <Button variant="ghost" size="sm">
                    <Icon name="visibility" size={14} className="mr-1" />
                    Xem giá
                  </Button>
                </div>
              </div>
            ))}

            <Button variant="outline" className="w-full">
              <Icon name="add" size={16} className="mr-1.5" />
              Thêm bảng giá
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quy tắc áp dụng</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {rules.map((rule) => (
              <label
                key={rule.value}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors",
                  priceRule === rule.value
                    ? "border-primary bg-primary/5"
                    : "hover:bg-muted/50"
                )}
              >
                <input
                  type="radio"
                  name="priceRule"
                  value={rule.value}
                  checked={priceRule === rule.value}
                  onChange={() => setPriceRule(rule.value)}
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">{rule.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {rule.description}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <Separator />

      <div className="flex justify-end">
        <Button>
          <Icon name="save" size={16} className="mr-1.5" />
          Lưu cài đặt
        </Button>
      </div>
    </div>
  );
}
