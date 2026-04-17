"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Icon } from "@/components/ui/icon";

const deliveryZones = [
  { id: 1, name: "Nội thành", fee: "15,000", distance: "0 - 10km" },
  { id: 2, name: "Ngoại thành", fee: "30,000", distance: "10 - 30km" },
  { id: 3, name: "Liên tỉnh", fee: "50,000", distance: "> 30km" },
];

const partners = [
  {
    id: 1,
    name: "Giao Hàng Nhanh (GHN)",
    status: "connected" as const,
    logo: "GHN",
  },
  {
    id: 2,
    name: "Giao Hàng Tiết Kiệm (GHTK)",
    status: "connected" as const,
    logo: "GHTK",
  },
  {
    id: 3,
    name: "J&T Express",
    status: "disconnected" as const,
    logo: "J&T",
  },
  {
    id: 4,
    name: "Viettel Post",
    status: "disconnected" as const,
    logo: "VTP",
  },
];

export default function DeliverySettingsPage() {
  const [defaultFee, setDefaultFee] = useState("20,000");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cài đặt giao hàng</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Quản lý phí giao hàng và đối tác vận chuyển
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Phí giao hàng mặc định</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-w-sm space-y-2">
            <label className="text-sm font-medium">Phí mặc định (VND)</label>
            <Input
              value={defaultFee}
              onChange={(e) => setDefaultFee(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Khu vực giao hàng</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Khu vực</TableHead>
                <TableHead>Khoảng cách</TableHead>
                <TableHead className="text-right">Phí (VND)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveryZones.map((zone) => (
                <TableRow key={zone.id}>
                  <TableCell className="font-medium">{zone.name}</TableCell>
                  <TableCell>{zone.distance}</TableCell>
                  <TableCell className="text-right">{zone.fee}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Đối tác giao hàng</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {partners.map((partner) => (
              <div
                key={partner.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center text-xs font-bold">
                    {partner.logo}
                  </div>
                  <span className="text-sm font-medium">{partner.name}</span>
                </div>
                {partner.status === "connected" ? (
                  <Badge variant="default">Đã kết nối</Badge>
                ) : (
                  <Button variant="outline" size="sm">
                    Kết nối
                  </Button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Separator />

      <div className="flex justify-end">
        <Button>
          <Icon name="save" size={16} className="mr-1.5" />
          Lưu thay đổi
        </Button>
      </div>
    </div>
  );
}
