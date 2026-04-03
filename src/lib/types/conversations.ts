// Hội thoại (Facebook, Zalo)
export interface Conversation {
  id: string;
  channelName: "facebook" | "zalo";
  externalId: string | null;
  customerId: string | null;
  customerName: string;
  customerAvatar: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  status: "open" | "closed" | "archived";
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
}

// Tin nhắn trong hội thoại
export interface ConversationMessage {
  id: string;
  conversationId: string;
  senderType: "customer" | "shop" | "system";
  senderName: string | null;
  content: string;
  messageType: "text" | "image" | "product" | "order";
  metadata: Record<string, unknown> | null;
  createdAt: string;
}
