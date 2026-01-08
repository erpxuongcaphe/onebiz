/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from '../supabase';

// Note: These tables are created via migrations but not in database.types.ts
// Using 'as any' for Supabase calls until types are regenerated

// =====================================================
// Types
// =====================================================
export type NotificationType =
    | 'birthday'
    | 'contract_expiry'
    | 'leave_request'
    | 'leave_approved'
    | 'leave_rejected'
    | 'attendance_reminder'
    | 'salary_ready'
    | 'system';

export type Notification = {
    id: string;
    user_id: string;
    type: NotificationType;
    title: string;
    message: string;
    link: string | null;
    is_read: boolean;
    read_at: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
};

export type NotificationSettings = {
    id: string;
    user_id: string;
    birthday_notifications: boolean;
    contract_expiry_notifications: boolean;
    leave_notifications: boolean;
    attendance_reminders: boolean;
    salary_notifications: boolean;
    created_at: string;
    updated_at: string;
};

// =====================================================
// Get Notifications
// =====================================================
export async function getNotifications(
    userId: string,
    options?: {
        limit?: number;
        unreadOnly?: boolean;
    }
): Promise<Notification[]> {
    let query = supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (options?.unreadOnly) {
        query = query.eq('is_read', false);
    }

    if (options?.limit) {
        query = query.limit(options.limit);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as unknown as Notification[];
}

// =====================================================
// Get Unread Count
// =====================================================
export async function getUnreadCount(userId: string): Promise<number> {
    const { count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_read', false);

    if (error) throw error;
    return count || 0;
}

// =====================================================
// Mark as Read
// =====================================================
export async function markAsRead(notificationId: string): Promise<void> {
    const { error } = await supabase
        .from('notifications')
        .update({
            is_read: true,
            read_at: new Date().toISOString()
        })
        .eq('id', notificationId);

    if (error) throw error;
}

export async function markAllAsRead(userId: string): Promise<void> {
    const { error } = await supabase
        .from('notifications')
        .update({
            is_read: true,
            read_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('is_read', false);

    if (error) throw error;
}

// =====================================================
// Create Notification
// =====================================================
export async function createNotification(notification: {
    user_id: string;
    type: NotificationType;
    title: string;
    message: string;
    link?: string;
    metadata?: Record<string, unknown>;
}): Promise<Notification> {
    const { data, error } = await supabase
        .from('notifications')
        .insert(notification as never)
        .select()
        .single();

    if (error) throw error;
    return data as unknown as Notification;
}

// =====================================================
// Create Bulk Notifications
// =====================================================
export async function createBulkNotifications(
    notifications: Array<{
        user_id: string;
        type: NotificationType;
        title: string;
        message: string;
        link?: string;
        metadata?: Record<string, unknown>;
    }>
): Promise<void> {
    const { error } = await supabase
        .from('notifications')
        .insert(notifications as never);

    if (error) throw error;
}

// =====================================================
// Delete Notification
// =====================================================
export async function deleteNotification(notificationId: string): Promise<void> {
    const { error } = await supabase
        .from('notifications')
        .delete()
        .eq('id', notificationId);

    if (error) throw error;
}

// =====================================================
// Get/Update Notification Settings
// =====================================================
export async function getNotificationSettings(userId: string): Promise<NotificationSettings | null> {
    const { data, error } = await supabase
        .from('notification_settings')
        .select('*')
        .eq('user_id', userId)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
    }
    return data as unknown as NotificationSettings;
}

export async function updateNotificationSettings(
    userId: string,
    settings: Partial<NotificationSettings>
): Promise<NotificationSettings> {
    const { data, error } = await supabase
        .from('notification_settings')
        .upsert({
            user_id: userId,
            ...settings,
            updated_at: new Date().toISOString()
        } as never)
        .select()
        .single();

    if (error) throw error;
    return data as unknown as NotificationSettings;
}

// =====================================================
// Helper Functions
// =====================================================
export function getNotificationIcon(type: NotificationType): string {
    const icons: Record<NotificationType, string> = {
        birthday: '🎂',
        contract_expiry: '📋',
        leave_request: '📝',
        leave_approved: '✅',
        leave_rejected: '❌',
        attendance_reminder: '⏰',
        salary_ready: '💰',
        system: '🔔',
    };
    return icons[type];
}

export function getNotificationColor(type: NotificationType): string {
    const colors: Record<NotificationType, string> = {
        birthday: 'bg-pink-100 text-pink-800',
        contract_expiry: 'bg-amber-100 text-amber-800',
        leave_request: 'bg-blue-100 text-blue-800',
        leave_approved: 'bg-green-100 text-green-800',
        leave_rejected: 'bg-red-100 text-red-800',
        attendance_reminder: 'bg-purple-100 text-purple-800',
        salary_ready: 'bg-emerald-100 text-emerald-800',
        system: 'bg-slate-100 text-slate-800',
    };
    return colors[type];
}

export function formatNotificationTime(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Vừa xong';
    if (diffMins < 60) return `${diffMins} phút trước`;
    if (diffHours < 24) return `${diffHours} giờ trước`;
    if (diffDays < 7) return `${diffDays} ngày trước`;

    return date.toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}
