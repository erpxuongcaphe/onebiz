"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Plus, ChevronDown, ChevronUp, Users, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Permission, Role } from "@/lib/types";

const roles: Role[] = [
  {
    id: "admin",
    name: "Admin",
    description: "Toàn quyền quản lý hệ thống",
    memberCount: 1,
    color: "bg-red-500",
    permissions: [
      {
        group: "Hàng hóa",
        items: [
          { label: "Xem danh sách", allowed: true },
          { label: "Thêm/Sửa/Xóa", allowed: true },
          { label: "Xuất/Nhập kho", allowed: true },
        ],
      },
      {
        group: "Đơn hàng",
        items: [
          { label: "Xem đơn hàng", allowed: true },
          { label: "Tạo đơn", allowed: true },
          { label: "Hủy đơn", allowed: true },
        ],
      },
      {
        group: "Báo cáo",
        items: [
          { label: "Xem báo cáo", allowed: true },
          { label: "Xuất báo cáo", allowed: true },
        ],
      },
    ],
  },
  {
    id: "manager",
    name: "Quản lý",
    description: "Quản lý hoạt động cửa hàng",
    memberCount: 2,
    color: "bg-blue-500",
    permissions: [
      {
        group: "Hàng hóa",
        items: [
          { label: "Xem danh sách", allowed: true },
          { label: "Thêm/Sửa/Xóa", allowed: true },
          { label: "Xuất/Nhập kho", allowed: true },
        ],
      },
      {
        group: "Đơn hàng",
        items: [
          { label: "Xem đơn hàng", allowed: true },
          { label: "Tạo đơn", allowed: true },
          { label: "Hủy đơn", allowed: true },
        ],
      },
      {
        group: "Báo cáo",
        items: [
          { label: "Xem báo cáo", allowed: true },
          { label: "Xuất báo cáo", allowed: false },
        ],
      },
    ],
  },
  {
    id: "sales",
    name: "Nhân viên bán hàng",
    description: "Bán hàng và quản lý đơn hàng",
    memberCount: 5,
    color: "bg-green-500",
    permissions: [
      {
        group: "Hàng hóa",
        items: [
          { label: "Xem danh sách", allowed: true },
          { label: "Thêm/Sửa/Xóa", allowed: false },
          { label: "Xuất/Nhập kho", allowed: false },
        ],
      },
      {
        group: "Đơn hàng",
        items: [
          { label: "Xem đơn hàng", allowed: true },
          { label: "Tạo đơn", allowed: true },
          { label: "Hủy đơn", allowed: false },
        ],
      },
      {
        group: "Báo cáo",
        items: [
          { label: "Xem báo cáo", allowed: false },
          { label: "Xuất báo cáo", allowed: false },
        ],
      },
    ],
  },
  {
    id: "warehouse",
    name: "Nhân viên kho",
    description: "Quản lý kho hàng và tồn kho",
    memberCount: 3,
    color: "bg-orange-500",
    permissions: [
      {
        group: "Hàng hóa",
        items: [
          { label: "Xem danh sách", allowed: true },
          { label: "Thêm/Sửa/Xóa", allowed: true },
          { label: "Xuất/Nhập kho", allowed: true },
        ],
      },
      {
        group: "Đơn hàng",
        items: [
          { label: "Xem đơn hàng", allowed: true },
          { label: "Tạo đơn", allowed: false },
          { label: "Hủy đơn", allowed: false },
        ],
      },
      {
        group: "Báo cáo",
        items: [
          { label: "Xem báo cáo", allowed: false },
          { label: "Xuất báo cáo", allowed: false },
        ],
      },
    ],
  },
  {
    id: "accountant",
    name: "Kế toán",
    description: "Quản lý tài chính và báo cáo",
    memberCount: 1,
    color: "bg-purple-500",
    permissions: [
      {
        group: "Hàng hóa",
        items: [
          { label: "Xem danh sách", allowed: true },
          { label: "Thêm/Sửa/Xóa", allowed: false },
          { label: "Xuất/Nhập kho", allowed: false },
        ],
      },
      {
        group: "Đơn hàng",
        items: [
          { label: "Xem đơn hàng", allowed: true },
          { label: "Tạo đơn", allowed: false },
          { label: "Hủy đơn", allowed: false },
        ],
      },
      {
        group: "Báo cáo",
        items: [
          { label: "Xem báo cáo", allowed: true },
          { label: "Xuất báo cáo", allowed: true },
        ],
      },
    ],
  },
];

export default function PermissionSettingsPage() {
  const [expandedRole, setExpandedRole] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Phân quyền</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Quản lý vai trò và quyền truy cập
          </p>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-1.5" />
          Thêm vai trò
        </Button>
      </div>

      <div className="space-y-3">
        {roles.map((role) => {
          const isExpanded = expandedRole === role.id;
          return (
            <Card key={role.id}>
              <button
                type="button"
                className="w-full text-left"
                onClick={() =>
                  setExpandedRole(isExpanded ? null : role.id)
                }
              >
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "h-8 w-8 rounded-lg flex items-center justify-center text-white",
                          role.color
                        )}
                      >
                        <Shield className="h-4 w-4" />
                      </div>
                      <div>
                        <CardTitle className="text-sm">{role.name}</CardTitle>
                        <CardDescription className="text-xs">
                          {role.description}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="secondary">
                        <Users className="h-3 w-3 mr-1" />
                        {role.memberCount}
                      </Badge>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>
                </CardHeader>
              </button>

              {isExpanded && (
                <CardContent>
                  <Separator className="mb-4" />
                  <div className="space-y-4">
                    {role.permissions.map((group) => (
                      <div key={group.group}>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                          {group.group}
                        </h4>
                        <div className="grid gap-2 sm:grid-cols-3">
                          {group.items.map((perm) => (
                            <div
                              key={perm.label}
                              className={cn(
                                "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm",
                                perm.allowed
                                  ? "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400"
                                  : "bg-muted text-muted-foreground"
                              )}
                            >
                              <div
                                className={cn(
                                  "h-1.5 w-1.5 rounded-full",
                                  perm.allowed
                                    ? "bg-green-500"
                                    : "bg-muted-foreground/30"
                                )}
                              />
                              {perm.label}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
