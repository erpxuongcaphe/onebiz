export const FNB_SETUP_REQUEST_TIMEOUT_MS = 12_000;

export class FnbSetupRequestTimeoutError extends Error {
  constructor(message = "Kết nối quá lâu khi tải cấu hình F&B.") {
    super(message);
    this.name = "FnbSetupRequestTimeoutError";
  }
}

export async function withFnbSetupTimeout<T>(
  request: PromiseLike<T>,
  timeoutMs = FNB_SETUP_REQUEST_TIMEOUT_MS,
  message?: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new FnbSetupRequestTimeoutError(message)),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([Promise.resolve(request), timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

const FNB_SETUP_ERROR_MESSAGES: Array<[string, string]> = [
  [
    "FNB_EXACT_RECIPE_GROUP_NOT_EFFECTIVE_FOR_PRODUCT",
    "Nhóm mức đường hoặc tùy chọn chưa được áp dụng cho món. Kiểm tra tab Tùy chọn F&B rồi lưu lại.",
  ],
  [
    "FNB_EXACT_RECIPE_GROUP_INCOMPLETE",
    "Chưa nhập đủ định lượng cho tất cả lựa chọn đang bật.",
  ],
  [
    "FNB_EXACT_RECIPE_INPUT_UNIT_MISMATCH",
    "Đơn vị pha chế của định lượng riêng không khớp với công thức.",
  ],
  [
    "FNB_EXACT_RECIPE_UOM_FACTOR_INVALID",
    "Chưa có hệ số quy đổi hợp lệ giữa đơn vị pha chế và đơn vị tồn kho.",
  ],
  [
    "MODIFIER_OPTION_STOCK_EFFECT_CONFLICT",
    "Một lựa chọn đang được cấu hình trừ kho theo hai cách. Chỉ giữ định lượng theo BOM hoặc nguyên liệu liên kết trực tiếp.",
  ],
  [
    "FNB_PRODUCT_MODIFIER_PERMISSION_DENIED",
    "Tài khoản không có quyền thay đổi tùy chọn F&B của sản phẩm.",
  ],
  ["42501", "Tài khoản không có quyền hoàn tất thay đổi này."],
];

function readErrorField(error: unknown, field: string): string {
  if (!error || typeof error !== "object") return "";
  const value = (error as Record<string, unknown>)[field];
  return typeof value === "string" ? value.trim() : "";
}

export function getFnbSetupErrorMessage(
  error: unknown,
  fallback = "Không thể hoàn tất cấu hình F&B. Vui lòng thử lại.",
): string {
  const code = readErrorField(error, "code");
  const parts = [
    error instanceof Error ? error.message.trim() : readErrorField(error, "message"),
    readErrorField(error, "details"),
    readErrorField(error, "hint"),
  ].filter((part, index, all) => part && all.indexOf(part) === index);
  const searchable = [code, ...parts].join(" ");

  for (const [marker, friendlyMessage] of FNB_SETUP_ERROR_MESSAGES) {
    if (searchable.includes(marker)) {
      return code && !friendlyMessage.includes(code)
        ? `${friendlyMessage} (mã: ${code})`
        : friendlyMessage;
    }
  }

  if (parts.length > 0) {
    const detail = parts.join(" ");
    return code ? `${detail} (mã: ${code})` : detail;
  }
  return code ? `${fallback} (mã: ${code})` : fallback;
}
