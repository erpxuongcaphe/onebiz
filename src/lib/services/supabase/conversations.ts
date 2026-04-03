/**
 * Supabase service: Conversations (Hội thoại Facebook/Zalo)
 */

import type { Conversation, ConversationMessage, QueryParams, QueryResult } from "@/lib/types";
import type { Database } from "@/lib/supabase/types";
import { getClient, getPaginationRange, handleError, getFilterValue } from "./base";

type MessageInsert = Database["public"]["Tables"]["conversation_messages"]["Insert"];

function mapConversation(row: Record<string, unknown>): Conversation {
  return {
    id: row.id as string,
    channelName: row.channel_name as "facebook" | "zalo",
    externalId: (row.external_id as string) ?? null,
    customerId: (row.customer_id as string) ?? null,
    customerName: row.customer_name as string,
    customerAvatar: (row.customer_avatar as string) ?? null,
    lastMessage: (row.last_message as string) ?? null,
    lastMessageAt: (row.last_message_at as string) ?? null,
    unreadCount: (row.unread_count as number) ?? 0,
    status: row.status as "open" | "closed" | "archived",
    assignedTo: (row.assigned_to as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/**
 * Lấy danh sách hội thoại.
 */
export async function getConversations(params: QueryParams): Promise<QueryResult<Conversation>> {
  const supabase = getClient();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("conversations")
    .select("*", { count: "exact" });

  if (params.search) {
    query = query.ilike("customer_name", `%${params.search}%`);
  }

  // Filter: channel
  const channel = getFilterValue(params.filters, "channel");
  if (channel && channel !== "all") query = query.eq("channel_name", channel as "facebook" | "zalo");

  // Filter: status
  const status = getFilterValue(params.filters, "status");
  if (status && status !== "all") query = query.eq("status", status as "open" | "closed" | "archived");

  query = query.order("last_message_at", { ascending: false, nullsFirst: false });
  query = query.range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getConversations");

  return {
    data: (data ?? []).map((row) => mapConversation(row as Record<string, unknown>)),
    total: count ?? 0,
  };
}

/**
 * Lấy tin nhắn của 1 cuộc hội thoại.
 */
export async function getConversationMessages(
  conversationId: string,
  params?: { limit?: number; before?: string }
): Promise<ConversationMessage[]> {
  const supabase = getClient();

  let query = supabase
    .from("conversation_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (params?.before) {
    query = query.lt("created_at", params.before);
  }

  if (params?.limit) {
    query = query.limit(params.limit);
  }

  const { data, error } = await query;
  if (error) handleError(error, "getConversationMessages");

  return (data ?? []).map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    senderType: row.sender_type as "customer" | "shop" | "system",
    senderName: row.sender_name,
    content: row.content,
    messageType: row.message_type as "text" | "image" | "product" | "order",
    metadata: row.metadata as Record<string, unknown> | null,
    createdAt: row.created_at,
  }));
}

/**
 * Gửi tin nhắn mới.
 */
export async function sendMessage(
  conversationId: string,
  content: string,
  messageType: "text" | "image" | "product" | "order" = "text",
  metadata?: Record<string, unknown>
): Promise<ConversationMessage> {
  const supabase = getClient();

  const { data, error } = await supabase
    .from("conversation_messages")
    .insert({
      conversation_id: conversationId,
      sender_type: "shop" as const,
      content,
      message_type: messageType,
      metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : null,
    } satisfies MessageInsert)
    .select()
    .single();

  if (error) handleError(error, "sendMessage");

  // Cập nhật last_message trên conversation
  await supabase
    .from("conversations")
    .update({
      last_message: content,
      last_message_at: new Date().toISOString(),
    })
    .eq("id", conversationId);

  return {
    id: data!.id,
    conversationId: data!.conversation_id,
    senderType: data!.sender_type as "customer" | "shop" | "system",
    senderName: data!.sender_name,
    content: data!.content,
    messageType: data!.message_type as "text" | "image" | "product" | "order",
    metadata: data!.metadata as Record<string, unknown> | null,
    createdAt: data!.created_at,
  };
}

/**
 * Đánh dấu đã đọc.
 */
export async function markConversationRead(conversationId: string): Promise<void> {
  const supabase = getClient();

  const { error } = await supabase
    .from("conversations")
    .update({ unread_count: 0 })
    .eq("id", conversationId);

  if (error) handleError(error, "markConversationRead");
}
