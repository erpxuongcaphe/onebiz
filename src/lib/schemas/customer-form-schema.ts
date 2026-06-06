/**
 * Customer form validation schema (Zod) — CEO 06/06/2026 Sprint UX-1.
 *
 * Dùng cho create/update customer dialog. Adopt thay cho hand-rolled
 * validation hiện tại để có:
 *   - Inline error onBlur (user biết field sai ngay khi rời input)
 *   - Type-safe (z.infer → TypeScript)
 *   - aria-invalid auto qua FormControl
 *   - Vietnamese error messages
 */

import { z } from "zod";

// VN phone regex: chấp nhận 0 / +84 / spaces / dashes / parens
const VN_PHONE_REGEX = /^(?:\+84|84|0)(?:[\s.-]?\d){9,10}$/;

export const customerFormSchema = z.object({
  /** Mã KH — auto-gen khi tạo mới, không cho sửa khi edit */
  code: z
    .string()
    .min(1, "Mã khách hàng là bắt buộc")
    .max(50, "Mã tối đa 50 ký tự"),

  /** Tên KH — bắt buộc */
  name: z
    .string()
    .min(1, "Tên khách hàng là bắt buộc")
    .max(200, "Tên tối đa 200 ký tự")
    .refine((s) => s.trim().length > 0, "Tên không được toàn khoảng trắng"),

  /** SĐT — bắt buộc, validate format VN */
  phone: z
    .string()
    .min(1, "Số điện thoại là bắt buộc")
    .refine(
      (s) => VN_PHONE_REGEX.test(s.replace(/[\s.()-]/g, "")),
      "Số điện thoại không hợp lệ (VD: 0901234567 hoặc +84901234567)",
    ),

  /** Email — optional, validate nếu có */
  email: z
    .string()
    .email("Email không đúng định dạng (vd: ten@congty.com)")
    .optional()
    .or(z.literal("")),

  /** Address — optional, max 500 char */
  address: z.string().max(500, "Địa chỉ tối đa 500 ký tự").optional().or(z.literal("")),

  houseNumber: z.string().max(50).optional().or(z.literal("")),
  street: z.string().max(200).optional().or(z.literal("")),
  quarter: z.string().max(200).optional().or(z.literal("")),
  ward: z.string().max(200).optional().or(z.literal("")),
  province: z.string().max(100).optional().or(z.literal("")),
  country: z.string().max(100).optional().or(z.literal("")),

  /** MST — optional, validate format Việt Nam (10 hoặc 13 digit) */
  taxCode: z
    .string()
    .refine(
      (s) => !s || /^\d{10}(-\d{3})?$/.test(s.replace(/\s/g, "")),
      "Mã số thuế VN phải 10 hoặc 13 số (vd: 0123456789 hoặc 0123456789-001)",
    )
    .optional()
    .or(z.literal("")),

  groupId: z.string().optional().or(z.literal("")),

  type: z.enum(["individual", "company"], {
    message: "Loại khách hàng phải là Cá nhân hoặc Công ty",
  }),

  gender: z
    .enum(["male", "female"])
    .optional()
    .or(z.literal("")),

  priceTierId: z.string().optional().or(z.literal("")),

  /** Sinh nhật — optional, không cho tương lai */
  birthday: z
    .string()
    .refine(
      (s) => !s || new Date(s).getTime() <= Date.now(),
      "Sinh nhật không được trong tương lai",
    )
    .optional()
    .or(z.literal("")),

  /** Tags array — optional, mỗi tag max 50 char */
  tags: z
    .array(
      z
        .string()
        .min(1, "Tag không được rỗng")
        .max(50, "Tag tối đa 50 ký tự"),
    )
    .max(20, "Tối đa 20 tag")
    .optional()
    .default([]),
});

export type CustomerFormData = z.infer<typeof customerFormSchema>;

/** Default values khi tạo mới — auto-fill code ở component */
export const customerFormDefaults: Omit<CustomerFormData, "code"> = {
  name: "",
  phone: "",
  email: "",
  address: "",
  houseNumber: "",
  street: "",
  quarter: "",
  ward: "",
  province: "",
  country: "Việt Nam",
  taxCode: "",
  groupId: "",
  type: "individual",
  gender: "",
  priceTierId: "",
  birthday: "",
  tags: [],
};
