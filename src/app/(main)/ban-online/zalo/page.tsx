"use client";

import { useState } from "react";
import {
  MessageCircle,
  ShoppingCart,
  DollarSign
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

/* ------------------------------------------------------------------ */
/*  Mock data                                                          */
/* ------------------------------------------------------------------ */

const ZALO_BLUE = "#0068FF";

interface Conversation {
  id: string;
  name: string;
  avatar: string;
  lastMessage: string;
  time: string;
  unread: number;
}

const conversations: Conversation[] = [
  {
    id: "z1",
    name: "Nguyễn Thị Hương",
    avatar: "NH",
    lastMessage: "Cho mình hỏi giá cà phê Robusta hạt rang?",
    time: "09:15",
    unread: 2,
  },
  {
    id: "z2",
    name: "Trần Minh Đức",
    avatar: "TĐ",
    lastMessage: "Ok shop, mình đặt 2kg nhé",
    time: "08:50",
    unread: 1,
  },
  {
    id: "z3",
    name: "Lê Thị Phương",
    avatar: "LP",
    lastMessage: "Bạn ơi đơn hàng của mình giao tới đâu rồi?",
    time: "08:30",
    unread: 0,
  },
  {
    id: "z4",
    name: "Phạm Văn Hùng",
    avatar: "PH",
    lastMessage: "Cà phê phin blend có hương vị thế nào vậy shop?",
    time: "Hôm qua",
    unread: 3,
  },
  {
    id: "z5",
    name: "Hoàng Thị Lan Anh",
    avatar: "HA",
    lastMessage: "Mình muốn đổi sang gói 500g được không?",
    time: "Hôm qua",
    unread: 0,
  },
  {
    id: "z6",
    name: "Võ Quốc Thắng",
    avatar: "VT",
    lastMessage: "Cảm ơn shop, hàng nhận rồi nha!",
    time: "30/03",
    unread: 0,
  },
];

interface ChatMessage {
  id: string;
  sender: "customer" | "shop";
  text: string;
  time: string;
}

const chatMessages: ChatMessage[] = [
  {
    id: "m1",
    sender: "customer",
    text: "Chào shop, cho mình hỏi giá cà phê Robusta hạt rang hiện tại bao nhiêu vậy?",
    time: "09:10",
  },
  {
    id: "m2",
    sender: "shop",
    text: "Chào chị Hương! Robusta hạt rang hiện tại bên mình có giá 185.000đ/kg ạ. Nếu chị mua từ 3kg trở lên sẽ được giảm 10% nhé!",
    time: "09:12",
  },
  {
    id: "m3",
    sender: "customer",
    text: "Vậy Arabica Cầu Đất bao nhiêu vậy shop? Mình muốn so sánh hai loại.",
    time: "09:13",
  },
  {
    id: "m4",
    sender: "shop",
    text: "Arabica Cầu Đất giá 320.000đ/kg ạ. Loại này có vị chua thanh, hương trái cây rất thơm. Để mình gửi thông tin chi tiết cho chị nhé!",
    time: "09:14",
  },
  {
    id: "m5",
    sender: "customer",
    text: "Cho mình hỏi giá cà phê Robusta hạt rang?",
    time: "09:15",
  },
];

interface SuggestProduct {
  id: string;
  name: string;
  price: number;
}

const suggestedProducts: SuggestProduct[] = [
  { id: "p1", name: "Cà phê Robusta Đắk Lắk - Hạt rang", price: 185000 },
  { id: "p2", name: "Arabica Cầu Đất - Hạt rang", price: 320000 },
  { id: "p3", name: "Blend House Phin - Bột pha phin", price: 165000 },
];

const stats = [
  {
    label: "Tin nhắn mới",
    value: "8",
    icon: MessageCircle,
    color: "text-[#0068FF]",
    bg: "bg-blue-50",
  },
  {
    label: "Đơn từ Zalo",
    value: "15",
    icon: ShoppingCart,
    color: "text-[#0068FF]",
    bg: "bg-blue-50",
  },
  {
    label: "Doanh thu",
    value: "28.500.000",
    icon: DollarSign,
    color: "text-[#0068FF]",
    bg: "bg-blue-50",
    suffix: "đ",
  },
];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function ZaloPage() {
  const [activeConv, setActiveConv] = useState("z1");
  const [searchText, setSearchText] = useState("");
  const [messageText, setMessageText] = useState("");

  const activeConversation = conversations.find((c) => c.id === activeConv)!;
  const filteredConversations = conversations.filter((c) =>
    c.name.toLowerCase().includes(searchText.toLowerCase())
  );

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden">
      {/* Header */}
      <div className="border-b bg-white px-4 md:px-6 py-3">
        <div className="flex items-center gap-2 mb-3">
          <div
            className="size-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
            style={{ backgroundColor: ZALO_BLUE }}
          >
            Z
          </div>
          <h1 className="text-lg font-bold text-gray-900">
            Quản lý bán hàng Zalo
          </h1>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-3 gap-3">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <div
                key={s.label}
                className={cn("flex items-center gap-2 rounded-lg px-3 py-2", s.bg)}
              >
                <Icon className={cn("size-4 shrink-0", s.color)} />
                <div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className={cn("text-sm font-bold", s.color)}>
                    {s.value}
                    {s.suffix ?? ""}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="flex flex-1 min-h-0">
        {/* LEFT: Conversation list */}
        <div className="w-72 lg:w-80 border-r bg-white flex flex-col shrink-0">
          <div className="p-3 border-b">
            <div className="relative">
              <Icon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Tìm cuộc hội thoại"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="pl-8 h-9 text-sm"
              />
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="divide-y">
              {filteredConversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => setActiveConv(conv.id)}
                  className={cn(
                    "w-full flex items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-gray-50",
                    activeConv === conv.id && "bg-blue-50"
                  )}
                >
                  <div
                    className="size-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                    style={{ backgroundColor: ZALO_BLUE }}
                  >
                    {conv.avatar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span
                        className={cn(
                          "text-sm font-medium truncate",
                          conv.unread > 0 && "font-bold"
                        )}
                      >
                        {conv.name}
                      </span>
                      <span className="text-[11px] text-muted-foreground shrink-0 ml-1">
                        {conv.time}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <p
                        className={cn(
                          "text-xs truncate",
                          conv.unread > 0
                            ? "text-gray-900 font-medium"
                            : "text-muted-foreground"
                        )}
                      >
                        {conv.lastMessage}
                      </p>
                      {conv.unread > 0 && (
                        <span
                          className="size-5 rounded-full text-white text-[10px] font-bold flex items-center justify-center shrink-0 ml-1"
                          style={{ backgroundColor: ZALO_BLUE }}
                        >
                          {conv.unread}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* RIGHT: Chat detail */}
        <div className="flex-1 flex flex-col bg-gray-50 min-w-0">
          {/* Chat header */}
          <div className="bg-white border-b px-4 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className="size-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                style={{ backgroundColor: ZALO_BLUE }}
              >
                {activeConversation.avatar}
              </div>
              <div>
                <p className="text-sm font-semibold">
                  {activeConversation.name}
                </p>
                <p className="text-[11px] text-green-600">Đang hoạt động</p>
              </div>
            </div>
            <Button
              size="sm"
              style={{ backgroundColor: ZALO_BLUE }}
              className="text-white hover:opacity-90"
            >
              <Icon name="shopping_cart" className="size-4 mr-1.5" />
              Tạo đơn hàng
            </Button>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1 p-4">
            <div className="max-w-2xl mx-auto space-y-3">
              {chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "flex",
                    msg.sender === "shop" ? "justify-end" : "justify-start"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[75%] rounded-2xl px-3.5 py-2",
                      msg.sender === "shop"
                        ? "text-white"
                        : "bg-white border text-gray-900"
                    )}
                    style={
                      msg.sender === "shop"
                        ? { backgroundColor: ZALO_BLUE }
                        : undefined
                    }
                  >
                    <p className="text-sm leading-relaxed">{msg.text}</p>
                    <p
                      className={cn(
                        "text-[10px] mt-1",
                        msg.sender === "shop"
                          ? "text-blue-100"
                          : "text-muted-foreground"
                      )}
                    >
                      {msg.time}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          {/* Product suggestions */}
          <div className="border-t bg-white px-4 py-2.5">
            <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
              <Icon name="inventory_2" className="size-3" />
              Gợi ý sản phẩm
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {suggestedProducts.map((product) => (
                <div
                  key={product.id}
                  className="flex items-center gap-2 border rounded-lg px-3 py-2 bg-gray-50 shrink-0"
                >
                  <div className="size-9 rounded bg-orange-100 flex items-center justify-center">
                    <Icon name="inventory_2" className="size-4 text-orange-600" />
                  </div>
                  <div>
                    <p className="text-xs font-medium leading-tight max-w-[140px] truncate">
                      {product.name}
                    </p>
                    <p className="text-xs font-bold" style={{ color: ZALO_BLUE }}>
                      {formatCurrency(product.price)}đ
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-[11px] h-7 px-2 shrink-0 ml-1"
                  >
                    Gửi cho khách
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Message input */}
          <div className="border-t bg-white px-4 py-3">
            <div className="flex gap-2">
              <Input
                placeholder="Nhập tin nhắn..."
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                className="flex-1"
              />
              <Button
                style={{ backgroundColor: ZALO_BLUE }}
                className="text-white hover:opacity-90"
              >
                <Icon name="send" className="size-4 mr-1.5" />
                Gửi
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
