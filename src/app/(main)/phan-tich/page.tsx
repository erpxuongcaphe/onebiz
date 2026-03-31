"use client";

import { useState } from "react";
import { TrendingUp, ShoppingCart, Users, DollarSign } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { PageHeader } from "@/components/shared/page-header";
import { formatCurrency } from "@/lib/format";

// === KPI Data ===
const kpiData = [
  {
    label: "Doanh thu hôm nay",
    value: 28500000,
    formatted: formatCurrency(28500000),
    change: "+12.5%",
    positive: true,
    icon: DollarSign,
    bg: "bg-blue-50",
    iconColor: "text-blue-600",
    valueColor: "text-blue-700",
  },
  {
    label: "Đơn hàng hôm nay",
    value: 47,
    formatted: "47",
    change: "+8 đơn",
    positive: true,
    icon: ShoppingCart,
    bg: "bg-green-50",
    iconColor: "text-green-600",
    valueColor: "text-green-700",
  },
  {
    label: "Khách mới tháng này",
    value: 23,
    formatted: "23",
    change: "+5 so với tháng trước",
    positive: true,
    icon: Users,
    bg: "bg-purple-50",
    iconColor: "text-purple-600",
    valueColor: "text-purple-700",
  },
  {
    label: "Lợi nhuận tháng",
    value: 156000000,
    formatted: formatCurrency(156000000),
    change: "+18.2%",
    positive: true,
    icon: TrendingUp,
    bg: "bg-orange-50",
    iconColor: "text-orange-600",
    valueColor: "text-orange-700",
  },
];

// === Top 10 Revenue data ===
const topRevenueProducts = [
  { rank: 1, name: "Cà phê Arabica hạt rang", revenue: 45200000, qty: 320 },
  { rank: 2, name: "Cà phê Robusta nguyên chất", revenue: 38700000, qty: 285 },
  { rank: 3, name: "Trà sen vàng túi lọc", revenue: 28500000, qty: 190 },
  { rank: 4, name: "Cacao sữa 3in1 hộp", revenue: 22800000, qty: 456 },
  { rank: 5, name: "Cà phê phin giấy drip", revenue: 19500000, qty: 260 },
  { rank: 6, name: "Trà ô long cao cấp", revenue: 17200000, qty: 115 },
  { rank: 7, name: "Cà phê sữa đá hòa tan", revenue: 15800000, qty: 632 },
  { rank: 8, name: "Matcha Nhật Bản", revenue: 14300000, qty: 95 },
  { rank: 9, name: "Trà đào cam sả gói", revenue: 12100000, qty: 242 },
  { rank: 10, name: "Bộ phin cà phê inox", revenue: 9800000, qty: 49 },
];

const topProducts = [
  { rank: 1, name: "Cà phê sữa đá hòa tan", qty: 632, revenue: 15800000 },
  { rank: 2, name: "Cacao sữa 3in1 hộp", qty: 456, revenue: 22800000 },
  { rank: 3, name: "Cà phê Arabica hạt rang", qty: 320, revenue: 45200000 },
  { rank: 4, name: "Cà phê Robusta nguyên chất", qty: 285, revenue: 38700000 },
  { rank: 5, name: "Cà phê phin giấy drip", qty: 260, revenue: 19500000 },
  { rank: 6, name: "Trà đào cam sả gói", qty: 242, revenue: 12100000 },
  { rank: 7, name: "Trà sen vàng túi lọc", qty: 190, revenue: 28500000 },
  { rank: 8, name: "Trà ô long cao cấp", qty: 115, revenue: 17200000 },
  { rank: 9, name: "Matcha Nhật Bản", qty: 95, revenue: 14300000 },
  { rank: 10, name: "Bộ phin cà phê inox", qty: 49, revenue: 9800000 },
];

const topCustomers = [
  { rank: 1, name: "Chuỗi The Coffee House clone", orders: 128, revenue: 350000000 },
  { rank: 2, name: "Công ty Phân Phối Miền Nam", orders: 95, revenue: 500000000 },
  { rank: 3, name: "Công ty TNHH ABC Coffee", orders: 67, revenue: 120000000 },
  { rank: 4, name: "Quán Cà Phê Bùi Thanh Tâm", orders: 54, revenue: 85000000 },
  { rank: 5, name: "Lê Văn Đức", orders: 32, revenue: 25000000 },
  { rank: 6, name: "Đỗ Quang Huy", orders: 28, revenue: 18500000 },
  { rank: 7, name: "Nguyễn Minh Tuấn", orders: 24, revenue: 15000000 },
  { rank: 8, name: "Hoàng Anh Dũng", orders: 19, revenue: 9800000 },
  { rank: 9, name: "Trần Thị Hoa", orders: 15, revenue: 8200000 },
  { rank: 10, name: "Phạm Ngọc Anh", orders: 12, revenue: 6700000 },
];

export default function PhanTichPage() {
  const [activeTab, setActiveTab] = useState("revenue");

  return (
    <div className="flex flex-col h-[calc(100vh-48px)] overflow-y-auto">
      <PageHeader title="Phân tích" />

      <div className="flex-1 p-4 md:p-6 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          {kpiData.map((kpi) => {
            const Icon = kpi.icon;
            return (
              <Card key={kpi.label} className={kpi.bg + " border-0"}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted-foreground">
                      {kpi.label}
                    </span>
                    <Icon className={`h-4 w-4 ${kpi.iconColor}`} />
                  </div>
                  <p className={`text-xl md:text-2xl font-bold ${kpi.valueColor}`}>
                    {kpi.formatted}
                  </p>
                  <p className="text-xs text-green-600 mt-1">{kpi.change}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList variant="line" className="w-full justify-start">
            <TabsTrigger value="revenue">Doanh thu</TabsTrigger>
            <TabsTrigger value="products">Hàng hóa</TabsTrigger>
            <TabsTrigger value="customers">Khách hàng</TabsTrigger>
          </TabsList>

          {/* Doanh thu Tab */}
          <TabsContent value="revenue" className="mt-4 space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  Biểu đồ doanh thu theo ngày
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-48 md:h-64 border-2 border-dashed rounded-lg flex items-center justify-center text-muted-foreground text-sm">
                  Biểu đồ doanh thu sẽ hiển thị ở đây
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  Top 10 sản phẩm theo doanh thu
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 pr-4 font-medium">#</th>
                        <th className="text-left py-2 pr-4 font-medium">
                          Sản phẩm
                        </th>
                        <th className="text-right py-2 pr-4 font-medium">
                          SL bán
                        </th>
                        <th className="text-right py-2 font-medium">
                          Doanh thu
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {topRevenueProducts.map((item) => (
                        <tr key={item.rank} className="border-b last:border-0">
                          <td className="py-2.5 pr-4 text-muted-foreground">
                            {item.rank}
                          </td>
                          <td className="py-2.5 pr-4 font-medium">
                            {item.name}
                          </td>
                          <td className="py-2.5 pr-4 text-right">
                            {item.qty}
                          </td>
                          <td className="py-2.5 text-right font-medium text-primary">
                            {formatCurrency(item.revenue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Hàng hóa Tab */}
          <TabsContent value="products" className="mt-4 space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  Biểu đồ hàng hóa bán chạy
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-48 md:h-64 border-2 border-dashed rounded-lg flex items-center justify-center text-muted-foreground text-sm">
                  Biểu đồ hàng hóa sẽ hiển thị ở đây
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  Top 10 sản phẩm bán chạy (theo số lượng)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 pr-4 font-medium">#</th>
                        <th className="text-left py-2 pr-4 font-medium">
                          Sản phẩm
                        </th>
                        <th className="text-right py-2 pr-4 font-medium">
                          SL bán
                        </th>
                        <th className="text-right py-2 font-medium">
                          Doanh thu
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {topProducts.map((item) => (
                        <tr key={item.rank} className="border-b last:border-0">
                          <td className="py-2.5 pr-4 text-muted-foreground">
                            {item.rank}
                          </td>
                          <td className="py-2.5 pr-4 font-medium">
                            {item.name}
                          </td>
                          <td className="py-2.5 pr-4 text-right font-medium text-green-600">
                            {item.qty}
                          </td>
                          <td className="py-2.5 text-right">
                            {formatCurrency(item.revenue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Khách hàng Tab */}
          <TabsContent value="customers" className="mt-4 space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  Biểu đồ khách hàng mua nhiều
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-48 md:h-64 border-2 border-dashed rounded-lg flex items-center justify-center text-muted-foreground text-sm">
                  Biểu đồ khách hàng sẽ hiển thị ở đây
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  Top 10 khách hàng theo doanh thu
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 pr-4 font-medium">#</th>
                        <th className="text-left py-2 pr-4 font-medium">
                          Khách hàng
                        </th>
                        <th className="text-right py-2 pr-4 font-medium">
                          Số đơn
                        </th>
                        <th className="text-right py-2 font-medium">
                          Doanh thu
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {topCustomers.map((item) => (
                        <tr key={item.rank} className="border-b last:border-0">
                          <td className="py-2.5 pr-4 text-muted-foreground">
                            {item.rank}
                          </td>
                          <td className="py-2.5 pr-4 font-medium">
                            {item.name}
                          </td>
                          <td className="py-2.5 pr-4 text-right">
                            {item.orders}
                          </td>
                          <td className="py-2.5 text-right font-medium text-primary">
                            {formatCurrency(item.revenue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
