"use client";

import { MapPin, Phone, User, Truck, FileText, DollarSign } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import type { ShippingInfo } from "@/lib/types";
import { DELIVERY_PARTNERS } from "../hooks/use-pos-state";

interface ShippingFormProps {
  shipping: ShippingInfo;
  onUpdateShipping: (updates: Partial<ShippingInfo>) => void;
  mobileView: "products" | "cart";
}

export function ShippingForm({
  shipping,
  onUpdateShipping,
  mobileView,
}: ShippingFormProps) {
  return (
    <div
      className={cn(
        "w-full md:w-[300px] lg:w-[320px] border-l flex flex-col bg-white shrink-0",
        mobileView === "products" ? "hidden md:flex" : "flex"
      )}
    >
      <div className="px-3 py-2 border-b bg-gray-50">
        <h3 className="text-sm font-semibold flex items-center gap-1.5 text-gray-700">
          <Truck className="size-4 text-primary" />
          Thông tin giao hàng
        </h3>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-3">
          {/* Recipient Name */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium flex items-center gap-1">
              <User className="size-3" />
              Người nhận
            </label>
            <Input
              value={shipping.recipientName}
              onChange={(e) => onUpdateShipping({ recipientName: e.target.value })}
              placeholder="Tên người nhận"
              className="h-8 text-sm"
            />
          </div>

          {/* Recipient Phone */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium flex items-center gap-1">
              <Phone className="size-3" />
              Số điện thoại
            </label>
            <Input
              value={shipping.recipientPhone}
              onChange={(e) => onUpdateShipping({ recipientPhone: e.target.value })}
              placeholder="0912 345 678"
              className="h-8 text-sm"
              type="tel"
            />
          </div>

          {/* Recipient Address */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium flex items-center gap-1">
              <MapPin className="size-3" />
              Địa chỉ giao hàng
            </label>
            <textarea
              value={shipping.recipientAddress}
              onChange={(e) => onUpdateShipping({ recipientAddress: e.target.value })}
              placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/TP"
              className="w-full min-h-[60px] text-sm border rounded-md px-3 py-2 resize-none outline-none focus:ring-1 focus:ring-primary"
              rows={2}
            />
          </div>

          {/* Delivery Partner */}
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground font-medium flex items-center gap-1">
              <Truck className="size-3" />
              Đối tác giao hàng
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {DELIVERY_PARTNERS.map((partner) => (
                <button
                  key={partner.id}
                  onClick={() =>
                    onUpdateShipping({
                      deliveryPartnerId: partner.id,
                      deliveryPartnerName: partner.name,
                    })
                  }
                  className={cn(
                    "px-2 py-1.5 rounded border text-xs font-medium transition-colors text-left truncate",
                    shipping.deliveryPartnerId === partner.id
                      ? "bg-primary/10 border-primary text-primary"
                      : "border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300"
                  )}
                  title={partner.name}
                >
                  {partner.name}
                </button>
              ))}
            </div>
          </div>

          {/* Shipping Fee */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium flex items-center gap-1">
              <DollarSign className="size-3" />
              Phí giao hàng
            </label>
            <Input
              type="number"
              value={shipping.shippingFee || ""}
              onChange={(e) =>
                onUpdateShipping({ shippingFee: parseInt(e.target.value) || 0 })
              }
              placeholder="0"
              className="h-8 text-sm"
            />
            {/* Quick fee buttons */}
            <div className="flex gap-1 flex-wrap">
              {[15000, 20000, 25000, 30000, 40000].map((fee) => (
                <button
                  key={fee}
                  onClick={() => onUpdateShipping({ shippingFee: fee })}
                  className={cn(
                    "px-2 py-0.5 rounded text-[11px] transition-colors",
                    shipping.shippingFee === fee
                      ? "bg-primary text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  )}
                >
                  {formatCurrency(fee)}
                </button>
              ))}
            </div>
          </div>

          {/* COD Toggle */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground font-medium">
                Thu hộ (COD)
              </label>
              <button
                onClick={() =>
                  onUpdateShipping({ isCod: !shipping.isCod })
                }
                className={cn(
                  "relative w-10 h-5 rounded-full transition-colors",
                  shipping.isCod ? "bg-primary" : "bg-gray-300"
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform",
                    shipping.isCod ? "translate-x-5" : "translate-x-0.5"
                  )}
                />
              </button>
            </div>
            {shipping.isCod && (
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">
                  Số tiền thu hộ
                </label>
                <Input
                  type="number"
                  value={shipping.codAmount || ""}
                  onChange={(e) =>
                    onUpdateShipping({ codAmount: parseInt(e.target.value) || 0 })
                  }
                  placeholder="Nhập số tiền COD"
                  className="h-7 text-xs"
                />
              </div>
            )}
          </div>

          {/* Note */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium flex items-center gap-1">
              <FileText className="size-3" />
              Ghi chú giao hàng
            </label>
            <textarea
              value={shipping.note}
              onChange={(e) => onUpdateShipping({ note: e.target.value })}
              placeholder="Ghi chú cho shipper..."
              className="w-full min-h-[50px] text-sm border rounded-md px-3 py-2 resize-none outline-none focus:ring-1 focus:ring-primary"
              rows={2}
            />
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
