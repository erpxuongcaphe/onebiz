"use client";

import { useState } from "react";
import {
  MessageCircle,
  ShoppingCart,
  TrendingUp,
  Send
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

// === Stats ===
const stats = [
  {
    label: "Tin nhắn mới",
    value: "12",
    icon: MessageCircle,
    color: "text-blue-600",
    bg: "bg-blue-50",
  },
  {
    label: "Đơn từ Facebook",
    value: "23",
    icon: ShoppingCart,
    color: "text-green-600",
    bg: "bg-green-50",
  },
  {
    label: "Doanh thu",
    value: "45,2M",
    icon: TrendingUp,
    color: "text-purple-600",
    bg: "bg-purple-50",
  },
];

// === Conversations ===
const conversations = [
  {
    id: "c1",
    name: "Nguyễn Thanh Tùng",
    avatar: "NT",
    lastMessage: "Cho mình hỏi cà phê Arabica rang đậm còn không ạ?",
    time: "2 phút",
    unread: 2,
  },
  {
    id: "c2",
    name: "Trần Thị Hương",
    avatar: "TH",
    lastMessage: "Mình muốn đặt 5kg Robusta rang vừa giao về Đà Nẵng",
    time: "15 phút",
    unread: 1,
  },
  {
    id: "c3",
    name: "Phạm Quốc Đại",
    avatar: "PĐ",
    lastMessage: "Cảm ơn shop, mình nhận hàng rồi. Cà phê ngon lắm!",
    time: "32 phút",
    unread: 0,
  },
  {
    id: "c4",
    name: "Lê Minh Châu",
    avatar: "MC",
    lastMessage: "Shop có bán bộ dụng cụ pha pour over không ạ?",
    time: "1 giờ",
    unread: 3,
  },
  {
    id: "c5",
    name: "Hoàng Đức Anh",
    avatar: "ĐA",
    lastMessage: "Đơn hàng OL00145 giao đến đâu rồi shop ơi?",
    time: "2 giờ",
    unread: 0,
  },
  {
    id: "c6",
    name: "Vũ Thị Lan",
    avatar: "VL",
    lastMessage: "Mình muốn mua combo cà phê Tết tặng đối tác",
    time: "3 giờ",
    unread: 1,
  },
  {
    id: "c7",
    name: "Đặng Văn Thắng",
    avatar: "VT",
    lastMessage: "Cho mình xin bảng giá sỉ cà phê hạt rang xay",
    time: "5 giờ",
    unread: 0,
  },
  {
    id: "c8",
    name: "Bùi Thị Mai",
    avatar: "TM",
    lastMessage: "Ok shop, mình chuyển khoản rồi nhé",
    time: "Hôm qua",
    unread: 0,
  },
];

// === Messages for active conversation (c1) ===
const activeMessages = [
  {
    id: "m1",
    sender: "customer",
    text: "Chào shop, cho mình hỏi thăm về cà phê Arabica Cầu Đất nhé",
    time: "14:20",
  },
  {
    id: "m2",
    sender: "shop",
    text: "Chào anh Tùng! Dạ bên mình đang có Arabica Cầu Đất rang medium và dark roast ạ. Anh thích vị nào hơn ạ?",
    time: "14:22",
  },
  {
    id: "m3",
    sender: "customer",
    text: "Mình thích uống đậm, vị chocolate. Rang đậm có vị như vậy không?",
    time: "14:25",
  },
  {
    id: "m4",
    sender: "shop",
    text: "Dạ đúng rồi ạ! Arabica Cầu Đất Dark Roast bên mình rang kỹ, ra vị chocolate đắng, hậu vị ngọt nhẹ. Rất hợp pha phin hoặc espresso ạ.",
    time: "14:27",
  },
  {
    id: "m5",
    sender: "customer",
    text: "Nghe hay đó! Giá bao nhiêu 1kg vậy shop?",
    time: "14:30",
  },
  {
    id: "m6",
    sender: "customer",
    text: "Cho mình hỏi cà phê Arabica rang đậm còn không ạ?",
    time: "14:32",
  },
];

// === Recommended Products ===
const recommendedProducts = [
  {
    id: "p1",
    name: "Arabica Cầu Đất - Dark Roast",
    price: 385000,
    unit: "1kg",
  },
  {
    id: "p2",
    name: "Robusta Đắk Lắk - Medium Roast",
    price: 245000,
    unit: "1kg",
  },
  {
    id: "p3",
    name: "Blend House Premium",
    price: 320000,
    unit: "1kg",
  },
];

export default function FacebookPage() {
  const [activeConversation, setActiveConversation] = useState("c1");
  const [searchQuery, setSearchQuery] = useState("");
  const [messageInput, setMessageInput] = useState("");

  const filteredConversations = conversations.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-[calc(100vh-48px)]">
      {/* Header */}
      <div className="px-4 md:px-6 pt-4 md:pt-6 pb-3 border-b">
        <div className="flex items-center gap-2 mb-1">
          <div className="h-7 w-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
            F
          </div>
          <h1 className="text-lg font-bold text-gray-900">
            Quản lý bán hàng Facebook
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Trả lời tin nhắn và tạo đơn hàng từ Facebook Messenger
        </p>

        {/* Stats bar */}
        <div className="flex gap-4 mt-3">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="flex items-center gap-2">
                <div
                  className={cn(
                    "h-8 w-8 rounded-lg flex items-center justify-center",
                    stat.bg
                  )}
                >
                  <Icon className={cn("h-4 w-4", stat.color)} />
                </div>
                <div>
                  <p className="text-sm font-bold leading-tight">
                    {stat.value}
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    {stat.label}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main content: two-column */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        {/* LEFT: Conversation list */}
        <div className="w-full md:w-80 lg:w-96 border-r flex flex-col shrink-0 bg-white">
          {/* Search */}
          <div className="p-3 border-b">
            <div className="relative">
              <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Tìm cuộc hội thoại"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
          </div>

          {/* Conversation list */}
          <ScrollArea className="flex-1">
            <div className="divide-y">
              {filteredConversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => setActiveConversation(conv.id)}
                  className={cn(
                    "w-full flex items-start gap-3 p-3 text-left hover:bg-gray-50 transition-colors",
                    activeConversation === conv.id &&
                      "bg-blue-50/60 border-l-2 border-l-blue-600"
                  )}
                >
                  {/* Avatar */}
                  <div className="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium text-gray-600 shrink-0">
                    {conv.avatar}
                  </div>
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p
                        className={cn(
                          "text-sm truncate",
                          conv.unread > 0
                            ? "font-semibold text-gray-900"
                            : "font-medium text-gray-700"
                        )}
                      >
                        {conv.name}
                      </p>
                      <span className="text-[11px] text-muted-foreground shrink-0 ml-2">
                        {conv.time}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <p
                        className={cn(
                          "text-xs truncate",
                          conv.unread > 0
                            ? "text-gray-700 font-medium"
                            : "text-muted-foreground"
                        )}
                      >
                        {conv.lastMessage}
                      </p>
                      {conv.unread > 0 && (
                        <Badge className="h-5 min-w-5 px-1.5 text-[10px] rounded-full bg-blue-600 ml-2 shrink-0">
                          {conv.unread}
                        </Badge>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* RIGHT: Conversation detail */}
        <div className="flex-1 flex flex-col min-w-0 bg-gray-50/50">
          {/* Chat header */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-white">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium text-gray-600">
                NT
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  Nguyễn Thanh Tùng
                </p>
                <p className="text-[11px] text-green-600">Đang hoạt động</p>
              </div>
            </div>
            <Button size="sm" className="gap-1.5">
              <Icon name="add" size={16} />
              Tạo đơn hàng
            </Button>
          </div>

          {/* Messages area */}
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-3 max-w-2xl mx-auto">
              {activeMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "flex",
                    msg.sender === "shop" ? "justify-end" : "justify-start"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[75%] rounded-2xl px-4 py-2.5",
                      msg.sender === "shop"
                        ? "bg-blue-600 text-white"
                        : "bg-white text-gray-900 border"
                    )}
                  >
                    <p className="text-sm leading-relaxed">{msg.text}</p>
                    <p
                      className={cn(
                        "text-[10px] mt-1",
                        msg.sender === "shop"
                          ? "text-blue-200"
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

          {/* Message input */}
          <div className="px-4 py-3 border-t bg-white">
            <div className="flex gap-2 max-w-2xl mx-auto">
              <Input
                placeholder="Nhập tin nhắn..."
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                className="flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    // Would send message
                  }
                }}
              />
              <Button size="icon" className="shrink-0">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Product recommendations */}
          <div className="px-4 py-3 border-t bg-white">
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Gợi ý sản phẩm
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {recommendedProducts.map((product) => (
                <Card key={product.id} className="overflow-hidden">
                  <CardContent className="p-0">
                    {/* Thumbnail placeholder */}
                    <div className="h-20 bg-gradient-to-br from-amber-100 to-amber-50 flex items-center justify-center">
                      <span className="text-2xl">☕</span>
                    </div>
                    <div className="p-2.5">
                      <p className="text-xs font-medium text-gray-900 line-clamp-1">
                        {product.name}
                      </p>
                      <p className="text-xs text-primary font-bold mt-0.5">
                        {formatCurrency(product.price)}đ/{product.unit}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full mt-2 h-7 text-xs gap-1"
                      >
                        <Icon name="add" size={12} />
                        Thêm vào đơn
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
