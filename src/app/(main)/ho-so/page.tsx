"use client";

import { useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Icon } from "@/components/ui/icon";

const recentActivities = [
  { action: "Đăng nhập hệ thống", time: "Hôm nay, 08:30" },
  { action: "Cập nhật đơn hàng #DH-1042", time: "Hôm nay, 09:15" },
  { action: "Thêm khách hàng mới KH-0234", time: "Hôm nay, 10:00" },
  { action: "Xuất kho phiếu #XK-0089", time: "Hôm qua, 16:45" },
  { action: "Đăng nhập hệ thống", time: "Hôm qua, 08:00" },
];

const activeSessions = [
  {
    device: "Chrome - Windows 10",
    ip: "192.168.1.105",
    time: "Hôm nay, 08:30",
    status: "active" as const,
  },
  {
    device: "Safari - iPhone 15",
    ip: "192.168.1.112",
    time: "Hôm qua, 20:15",
    status: "active" as const,
  },
  {
    device: "Firefox - MacOS",
    ip: "10.0.0.45",
    time: "3 ngày trước",
    status: "expired" as const,
  },
];

export default function HoSoPage() {
  const [profile, setProfile] = useState({
    name: "Nguyễn Văn Admin",
    email: "admin@onebiz.com.vn",
    phone: "0912 345 678",
  });

  const [passwords, setPasswords] = useState({
    current: "",
    newPass: "",
    confirm: "",
  });

  return (
    <div className="flex flex-col h-full">
      <div className="border-b bg-white p-4">
        <h1 className="text-xl font-semibold">Hồ sơ cá nhân</h1>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4 max-w-3xl">
        {/* Thong tin ca nhan */}
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Thông tin cá nhân</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center text-xl font-bold text-primary shrink-0">
                NV
              </div>
              <div>
                <p className="font-medium">{profile.name}</p>
                <Badge variant="secondary">Admin</Badge>
              </div>
            </div>
            <Separator />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Họ tên</label>
                <Input
                  value={profile.name}
                  onChange={(e) =>
                    setProfile((p) => ({ ...p, name: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Email</label>
                <Input
                  type="email"
                  value={profile.email}
                  onChange={(e) =>
                    setProfile((p) => ({ ...p, email: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Số điện thoại</label>
                <Input
                  value={profile.phone}
                  onChange={(e) =>
                    setProfile((p) => ({ ...p, phone: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Vai trò</label>
                <Input value="Admin" disabled />
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="sm" className="gap-1.5">
                <Icon name="save" size={16} />
                Lưu thay đổi
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Doi mat khau */}
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Đổi mật khẩu</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-1 max-w-sm">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Mật khẩu hiện tại</label>
                <Input
                  type="password"
                  value={passwords.current}
                  onChange={(e) =>
                    setPasswords((p) => ({ ...p, current: e.target.value }))
                  }
                  placeholder="••••••••"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Mật khẩu mới</label>
                <Input
                  type="password"
                  value={passwords.newPass}
                  onChange={(e) =>
                    setPasswords((p) => ({ ...p, newPass: e.target.value }))
                  }
                  placeholder="••••••••"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Xác nhận mật khẩu mới</label>
                <Input
                  type="password"
                  value={passwords.confirm}
                  onChange={(e) =>
                    setPasswords((p) => ({ ...p, confirm: e.target.value }))
                  }
                  placeholder="••••••••"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="sm" className="gap-1.5">
                <Icon name="save" size={16} />
                Cập nhật mật khẩu
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Hoat dong gan day */}
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Hoạt động gần đây</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-3">
              {recentActivities.map((activity, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span>{activity.action}</span>
                  <span className="text-muted-foreground shrink-0 ml-4">
                    {activity.time}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Phien dang nhap */}
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Phiên đăng nhập</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Thiết bị</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Thời gian</TableHead>
                  <TableHead>Trạng thái</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeSessions.map((session, i) => (
                  <TableRow key={i}>
                    <TableCell>{session.device}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {session.ip}
                    </TableCell>
                    <TableCell>{session.time}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          session.status === "active" ? "default" : "secondary"
                        }
                      >
                        {session.status === "active"
                          ? "Đang hoạt động"
                          : "Hết hạn"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
