"use client";

import { useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { formatCurrency, formatDate } from "@/lib/format";
import type { SalesChannel, OnlineOrder } from "@/lib/types";

// === Mock Channels ===
const channels: SalesChannel[] = [
  {
    id: "ch_1",
    name: "Shopee",
    color: "bg-orange-500",
    connected: true,
    ordersToday: 12,
    revenueToday: 8500000,
  },
  {
    id: "ch_2",
    name: "Lazada",
    color: "bg-blue-600",
    connected: true,
    ordersToday: 7,
    revenueToday: 5200000,
  },
  {
    id: "ch_3",
    name: "TikTok Shop",
    color: "bg-gray-900",
    connected: true,
    ordersToday: 15,
    revenueToday: 12300000,
  },
  {
    id: "ch_4",
    name: "Website",
    color: "bg-green-600",
    connected: true,
    ordersToday: 4,
    revenueToday: 3100000,
  },
  {
    id: "ch_5",
    name: "Facebook",
    color: "bg-blue-500",
    connected: false,
    ordersToday: 0,
    revenueToday: 0,
  },
  {
    id: "ch_6",
    name: "Zalo",
    color: "bg-blue-400",
    connected: false,
    ordersToday: 0,
    revenueToday: 0,
  },
];

// === Mock Online Orders ===
const statusOptions: {
  status: OnlineOrder["status"];
  name: string;
}[] = [
  { status: "pending", name: "Chờ xác nhận" },
  { status: "confirmed", name: "Đã xác nhận" },
  { status: "shipping", name: "Đang giao" },
  { status: "completed", name: "Hoàn thành" },
  { status: "cancelled", name: "Đã hủy" },
];

const connectedChannels = channels.filter((c) => c.connected);

const onlineOrders: OnlineOrder[] = Array.from({ length: 8 }, (_, i) => {
  const ch =
    connectedChannels[Math.floor(Math.random() * connectedChannels.length)];
  const s = statusOptions[Math.floor(Math.random() * statusOptions.length)];
  const daysAgo = Math.floor(Math.random() * 3);
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(
    Math.floor(Math.random() * 12) + 7,
    Math.floor(Math.random() * 60)
  );

  const customers = [
    "Nguyễn Văn Minh",
    "Trần Thị Lan",
    "Phạm Quốc Bảo",
    "Lê Thị Hồng",
    "Hoàng Đức Anh",
    "Vũ Minh Châu",
    "Đặng Thị Mai",
    "Bùi Văn Thắng",
  ];

  return {
    id: `oo_${i + 1}`,
    code: `OL${String(2000 + i).padStart(5, "0")}`,
    channel: ch.name,
    channelColor: ch.color,
    customerName: customers[i],
    totalAmount: Math.floor(Math.random() * 5000000) + 150000,
    status: s.status,
    statusName: s.name,
    date: date.toISOString(),
  };
}).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

// === Order Columns ===
const orderColumns: ColumnDef<OnlineOrder, unknown>[] = [
  {
    accessorKey: "code",
    header: "Mã đơn",
    size: 120,
    cell: ({ row }) => (
      <span className="font-medium text-primary">{row.original.code}</span>
    ),
  },
  {
    accessorKey: "channel",
    header: "Kênh bán",
    size: 120,
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <div
          className={`h-5 w-5 rounded-full ${row.original.channelColor} flex items-center justify-center text-white text-[10px] font-bold`}
        >
          {row.original.channel[0]}
        </div>
        <span>{row.original.channel}</span>
      </div>
    ),
  },
  {
    accessorKey: "customerName",
    header: "Khách hàng",
    size: 160,
  },
  {
    accessorKey: "totalAmount",
    header: "Tổng tiền",
    cell: ({ row }) => (
      <span className="font-medium">
        {formatCurrency(row.original.totalAmount)}
      </span>
    ),
  },
  {
    accessorKey: "statusName",
    header: "Trạng thái",
    size: 130,
    cell: ({ row }) => {
      const s = row.original.status;
      const variant =
        s === "completed"
          ? "default"
          : s === "cancelled"
          ? "destructive"
          : "secondary";
      return <Badge variant={variant}>{row.original.statusName}</Badge>;
    },
  },
  {
    accessorKey: "date",
    header: "Thời gian",
    size: 150,
    cell: ({ row }) => formatDate(row.original.date),
  },
];

export default function BanOnlinePage() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  return (
    <div className="flex flex-col h-[calc(100vh-48px)] overflow-y-auto">
      <PageHeader
        title="Bán online"
        actions={[
          {
            label: "Thêm kênh bán",
            icon: <Plus className="h-4 w-4" />,
            variant: "default",
          },
        ]}
      />

      <div className="flex-1 p-4 md:p-6 space-y-6">
        {/* Channel Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {channels.map((channel) => (
            <Card key={channel.id} className="relative">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-10 w-10 rounded-full ${channel.color} flex items-center justify-center text-white font-bold text-lg`}
                    >
                      {channel.name[0]}
                    </div>
                    <div>
                      <p className="font-semibold">{channel.name}</p>
                      <Badge
                        variant={channel.connected ? "default" : "secondary"}
                        className="mt-0.5"
                      >
                        {channel.connected ? "Đã kết nối" : "Chưa kết nối"}
                      </Badge>
                    </div>
                  </div>
                </div>

                {channel.connected ? (
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="bg-muted/50 rounded-md p-2 text-center">
                      <p className="text-xs text-muted-foreground">
                        Đơn hôm nay
                      </p>
                      <p className="text-lg font-bold">
                        {channel.ordersToday}
                      </p>
                    </div>
                    <div className="bg-muted/50 rounded-md p-2 text-center">
                      <p className="text-xs text-muted-foreground">
                        Doanh thu hôm nay
                      </p>
                      <p className="text-lg font-bold text-primary">
                        {formatCurrency(channel.revenueToday)}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-muted/30 rounded-md p-4 mb-3 text-center">
                    <p className="text-sm text-muted-foreground">
                      Kết nối để bắt đầu bán hàng
                    </p>
                  </div>
                )}

                <Button
                  variant={channel.connected ? "outline" : "default"}
                  size="sm"
                  className="w-full"
                >
                  {channel.connected ? "Quản lý" : "Kết nối"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Recent Online Orders */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Đơn hàng online gần đây</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              columns={orderColumns}
              data={onlineOrders}
              loading={false}
              total={onlineOrders.length}
              pageIndex={page}
              pageSize={pageSize}
              pageCount={Math.ceil(onlineOrders.length / pageSize)}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(0);
              }}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
