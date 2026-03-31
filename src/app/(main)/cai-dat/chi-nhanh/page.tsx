"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Pencil } from "lucide-react";

const branches = [
  {
    id: 1,
    name: "Chi nhánh chính - HCM",
    address: "123 Nguyễn Huệ, Quận 1, TP.HCM",
    phone: "0909 123 456",
    status: "active" as const,
    createdAt: "15/01/2020",
  },
  {
    id: 2,
    name: "Chi nhánh 2 - Hà Nội",
    address: "45 Phố Huế, Hai Bà Trưng, Hà Nội",
    phone: "0912 345 678",
    status: "active" as const,
    createdAt: "01/06/2021",
  },
  {
    id: 3,
    name: "Chi nhánh 3 - Đà Nẵng",
    address: "78 Trần Phú, Hải Châu, Đà Nẵng",
    phone: "0935 678 901",
    status: "inactive" as const,
    createdAt: "15/03/2023",
  },
];

export default function BranchSettingsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Quản lý chi nhánh</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Quản lý các chi nhánh của cửa hàng
          </p>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-1.5" />
          Thêm chi nhánh
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tên chi nhánh</TableHead>
              <TableHead className="hidden md:table-cell">Địa chỉ</TableHead>
              <TableHead className="hidden sm:table-cell">SĐT</TableHead>
              <TableHead>Trạng thái</TableHead>
              <TableHead className="hidden sm:table-cell">Ngày tạo</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {branches.map((branch) => (
              <TableRow key={branch.id}>
                <TableCell className="font-medium">{branch.name}</TableCell>
                <TableCell className="hidden md:table-cell">
                  {branch.address}
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {branch.phone}
                </TableCell>
                <TableCell>
                  {branch.status === "active" ? (
                    <Badge variant="default">Hoạt động</Badge>
                  ) : (
                    <Badge variant="secondary">Ngừng hoạt động</Badge>
                  )}
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {branch.createdAt}
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon-sm">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
