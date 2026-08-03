export interface SalesOrderLineForValidation {
  quantity: number;
  price: number;
}

export interface NormalizedSalesOrderReceiver {
  name: string;
  phone: string;
  address: string;
  isEmpty: boolean;
  isComplete: boolean;
  isPartial: boolean;
}

export function normalizeSalesOrderReceiver(
  name: string,
  phone: string,
  address: string,
): NormalizedSalesOrderReceiver {
  const normalized = {
    name: name.trim(),
    phone: phone.trim(),
    address: address.trim(),
  };
  const filledCount = Object.values(normalized).filter(Boolean).length;
  return {
    ...normalized,
    isEmpty: filledCount === 0,
    isComplete: filledCount === 3,
    isPartial: filledCount > 0 && filledCount < 3,
  };
}

export function validateSalesOrderDraft(input: {
  items: SalesOrderLineForValidation[];
  deliveryFee: number;
  receiver: NormalizedSalesOrderReceiver;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  if (input.items.length === 0) {
    errors.items = "Chưa có sản phẩm nào";
  } else if (input.items.some((item) => !Number.isFinite(item.quantity) || item.quantity <= 0)) {
    errors.items = "Số lượng sản phẩm phải lớn hơn 0";
  } else if (input.items.some((item) => !Number.isFinite(item.price) || item.price < 0)) {
    errors.items = "Đơn giá sản phẩm không hợp lệ";
  }

  if (!Number.isFinite(input.deliveryFee) || input.deliveryFee < 0) {
    errors.shippingFee = "Phí giao hàng không hợp lệ";
  }
  if (input.receiver.isPartial) {
    errors.receiver =
      "Điền đủ người nhận, số điện thoại và địa chỉ; hoặc để trống cả ba nếu chưa giao hàng.";
  }
  return errors;
}

const SALES_ORDER_ERROR_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  ACTIVE_PROFILE_REQUIRED: "Tài khoản chưa được kích hoạt để tạo đơn.",
  ORDER_SAVE_DENIED: "Tài khoản không có quyền tạo đơn đặt hàng.",
  ORDER_BRANCH_DENIED: "Tài khoản không có quyền tạo đơn tại chi nhánh này.",
  ORDER_BRANCH_MISMATCH: "Chi nhánh của đơn không khớp với chi nhánh đang chọn.",
  ORDER_ITEMS_INVALID: "Danh sách sản phẩm trong đơn không hợp lệ.",
  ORDER_ITEM_INVALID: "Số lượng hoặc đơn giá của một sản phẩm không hợp lệ.",
  ORDER_PRODUCT_INVALID: "Có sản phẩm đã ngừng bán hoặc không thuộc công ty.",
  ORDER_CUSTOMER_INVALID: "Khách hàng đã chọn không còn hợp lệ.",
  DELIVERY_PARTNER_INVALID: "Đối tác giao hàng đã chọn không còn hợp lệ.",
  SHIPMENT_RECEIVER_INCOMPLETE:
    "Thông tin giao hàng chưa đủ. Điền đủ người nhận, số điện thoại và địa chỉ.",
  ORDER_NOT_FOUND: "Không tìm thấy đơn đặt hàng.",
  ORDER_NOT_EDITABLE: "Đơn này không còn ở trạng thái được phép sửa.",
  ORDER_CODE_IMMUTABLE: "Không được thay đổi mã của đơn đã tạo.",
};

export function getSalesOrderSaveErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  for (const [code, friendlyMessage] of Object.entries(SALES_ORDER_ERROR_MESSAGES)) {
    if (message.includes(code)) return friendlyMessage;
  }
  return message || "Không thể lưu đơn đặt hàng. Vui lòng thử lại.";
}