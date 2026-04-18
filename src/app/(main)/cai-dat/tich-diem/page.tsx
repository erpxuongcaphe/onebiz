"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { Icon } from "@/components/ui/icon";

function Toggle({
  checked,
  onCheckedChange,
  label,
  description,
}: {
  checked: boolean;
  onCheckedChange: (val: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="space-y-0.5">
        <div className="text-sm font-medium">{label}</div>
        {description && (
          <div className="text-xs text-muted-foreground">{description}</div>
        )}
      </div>
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

interface MemberTier {
  name: string;
  pointsRequired: number;
  discount: number;
  status: "active" | "inactive";
}

const memberTiers: MemberTier[] = [
  { name: "Thành viên", pointsRequired: 0, discount: 0, status: "active" },
  { name: "Thân thiết", pointsRequired: 500, discount: 3, status: "active" },
  { name: "VIP", pointsRequired: 2000, discount: 5, status: "active" },
  { name: "Kim cương", pointsRequired: 5000, discount: 10, status: "active" },
];

export default function LoyaltyPointsSettingsPage() {
  const [enableLoyalty, setEnableLoyalty] = useState(true);
  const [earnRate, setEarnRate] = useState("10000");
  const [earnPoints, setEarnPoints] = useState("1");
  const [redeemPoints, setRedeemPoints] = useState("100");
  const [redeemValue, setRedeemValue] = useState("10000");
  const [maxRedeemPercent, setMaxRedeemPercent] = useState("50");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cài đặt tích điểm</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Chương trình tích điểm cho khách hàng thân thiết
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Quy tắc tích điểm</CardTitle>
            <Toggle
              checked={enableLoyalty}
              onCheckedChange={setEnableLoyalty}
              label=""
            />
          </div>
        </CardHeader>
        <CardContent>
          {enableLoyalty ? (
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium">Tỷ lệ tích điểm</label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    Mỗi
                  </span>
                  <Input
                    type="number"
                    value={earnRate}
                    onChange={(e) => setEarnRate(e.target.value)}
                    className="w-28"
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    đ =
                  </span>
                  <Input
                    type="number"
                    value={earnPoints}
                    onChange={(e) => setEarnPoints(e.target.value)}
                    className="w-20"
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    điểm
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Quy đổi điểm</label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={redeemPoints}
                    onChange={(e) => setRedeemPoints(e.target.value)}
                    className="w-20"
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    điểm =
                  </span>
                  <Input
                    type="number"
                    value={redeemValue}
                    onChange={(e) => setRedeemValue(e.target.value)}
                    className="w-28"
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    đ giảm giá
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Điểm tối đa sử dụng
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={maxRedeemPercent}
                    onChange={(e) => setMaxRedeemPercent(e.target.value)}
                    className="w-20"
                    min={0}
                    max={100}
                  />
                  <span className="text-sm text-muted-foreground">
                    % giá trị đơn hàng
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Tích điểm đã được tắt. Bật lại để cấu hình chương trình.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hạng thành viên</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 font-medium">Hạng</th>
                  <th className="pb-2 font-medium">Điểm yêu cầu</th>
                  <th className="pb-2 font-medium">Ưu đãi</th>
                  <th className="pb-2 font-medium">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {memberTiers.map((tier) => (
                  <tr key={tier.name}>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <Icon name="star" size={16} className="text-status-warning" />
                        <span className="font-medium">{tier.name}</span>
                      </div>
                    </td>
                    <td className="py-3">
                      {tier.pointsRequired.toLocaleString("vi-VN")} điểm
                    </td>
                    <td className="py-3">
                      {tier.discount > 0
                        ? `Giảm ${tier.discount}%`
                        : "Tích điểm cơ bản"}
                    </td>
                    <td className="py-3">
                      <Badge
                        variant="default"
                        className="bg-status-success/10 text-status-success hover:bg-status-success/10 text-xs"
                      >
                        Đang áp dụng
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lịch sử tích điểm</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Xem chi tiết lịch sử tích điểm và sử dụng điểm của khách hàng.
          </p>
          <Button variant="link" className="px-0 mt-2 text-sm">
            Xem lịch sử
            <Icon name="arrow_forward" size={16} className="ml-1" />
          </Button>
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
