// Đánh dấu yêu thích
export interface Favorite {
  id: string;
  userId: string;
  entityType: string; // 'product', 'customer', 'supplier', 'invoice', 'order'
  entityId: string;
  createdAt: string;
}
