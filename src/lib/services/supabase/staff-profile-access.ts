import { getClient } from "./base";
import { z } from "zod";
import type {
  StaffProfileDraft,
  StaffProfileSnapshot,
} from "@/lib/admin/staff-profile-access";

function profileError(error: { message?: string; code?: string }): never {
  const text = error.message ?? "";
  if (error.code === "55P03" || /lock timeout/i.test(text))
    throw new Error(
      "Có một thay đổi quyền khác đang được lưu. Bản nháp của anh vẫn được giữ; vui lòng thử lưu lại.",
    );
  if (/STAFF_PROFILE_STALE/.test(text))
    throw new Error(
      "Quyền hoặc phân công đã được sửa ở nơi khác. Bản nháp được giữ lại; tải lại để đối chiếu trước khi lưu.",
    );
  if (/OWNER_REQUIRED/.test(text))
    throw new Error(
      "Chỉ chủ doanh nghiệp được thay đổi phạm vi truy cập và quyền riêng.",
    );
  if (/BRANCH_PERMISSION_UNSUPPORTED/.test(text))
    throw new Error(
      "Quyền này chưa hỗ trợ giới hạn riêng theo chi nhánh. Chưa lưu thay đổi nào.",
    );
  if (/BRANCH_ACCESS_CONFLICT/.test(text))
    throw new Error(
      "Tài khoản có quyền xem tất cả chi nhánh. Hãy kiểm tra quyền này trước khi thu hẹp chi nhánh truy cập.",
    );
  if (/HIERARCHY_BRANCH_INVALID/.test(text))
    throw new Error(
      "Quán được giao quản lý nhân viên phải đang hoạt động và nằm trong chi nhánh được truy cập. Chưa lưu thay đổi nào.",
    );
  if (/STAFF_BRANCH_INVALID/.test(text))
    throw new Error(
      "Chọn ít nhất một chi nhánh hợp lệ. Chi nhánh đã ngừng hoạt động không thể được cấp mới; bản nháp vẫn được giữ.",
    );
  if (/HIERARCHY_DUPLICATE_ASSIGNMENT/.test(text))
    throw new Error(
      "Đang có hai phân công trùng chức vụ và bộ phận. Gộp chi nhánh quản lý vào một phân công rồi lưu lại.",
    );
  if (/HIERARCHY_ASSIGNMENT_INVALID|STAFF_ASSIGNMENT_INVALID/.test(text))
    throw new Error(
      "Chức vụ hoặc bộ phận trong phân công không còn hợp lệ. Kiểm tra lại lựa chọn; chưa lưu thay đổi nào.",
    );
  if (/STAFF_ROLE_INVALID/.test(text))
    throw new Error(
      "Mẫu quyền đã thay đổi hoặc không còn tồn tại. Tải lại dữ liệu để chọn mẫu phù hợp.",
    );
  throw new Error(
    "Chưa lưu được quyền. Kiểm tra chi nhánh, chức vụ và các điều chỉnh; bản nháp vẫn được giữ.",
  );
}
const snapshotSchema = z.object({
  fingerprint: z.string().min(1),
  user: z.object({
    id: z.string(),
    fullName: z.string(),
    roleId: z.string().nullable(),
    platformRole: z.string().optional(),
    isActive: z.boolean(),
    branchIds: z.array(z.string()),
  }),
  hierarchy: z.object({
    version: z.number(),
    document: z.object({
      positions: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          parentId: z.string().nullable(),
          scope: z.enum(["branch", "assigned", "department"]),
          depth: z.enum(["direct", "all"]),
          roleId: z.string().nullable().optional(),
          permissions: z.object({
            edit: z.boolean(),
            create: z.boolean(),
            password: z.boolean(),
          }),
        }),
      ),
      departments: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          parentId: z.string().nullable(),
        }),
      ),
      assignments: z.array(
        z.object({
          userId: z.string(),
          positionId: z.string(),
          departmentId: z.string().nullable(),
          managedBranchIds: z.array(z.string()),
        }),
      ),
      globalAdminIds: z.array(z.string()),
    }),
  }),
  roles: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      permissions: z.array(z.string()),
    }),
  ),
  branches: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      isActive: z.boolean().optional(),
    }),
  ),
  exceptions: z.array(
    z.object({
      branchId: z.string().nullable(),
      permissionCode: z.string(),
      choice: z.enum(["grant", "revoke"]),
    }),
  ),
  branchPermissionCodes: z.array(z.string()),
});
function readSnapshot(value: unknown): StaffProfileSnapshot {
  const result = snapshotSchema.safeParse(value);
  if (!result.success)
    throw new Error("Chưa tải đủ dữ liệu quyền. Vui lòng thử lại.");
  return result.data;
}
export async function getStaffProfileAccess(
  userId: string,
): Promise<StaffProfileSnapshot> {
  const { data, error } = await getClient().rpc("get_staff_profile_access", {
    p_user_id: userId,
  });
  if (error) profileError(error);
  return readSnapshot(data);
}
export async function saveStaffProfileAccess(
  snapshot: StaffProfileSnapshot,
  draft: StaffProfileDraft,
): Promise<StaffProfileSnapshot> {
  const { data, error } = await getClient().rpc("save_staff_profile_access", {
    p_user_id: snapshot.user.id,
    p_expected_fingerprint: snapshot.fingerprint,
    p_draft: {
      ...draft,
      assignments: draft.assignments.map((assignment) => ({ ...assignment })),
      exceptions: draft.exceptions.map((exception) => ({ ...exception })),
    },
  });
  if (error) profileError(error);
  return readSnapshot(data);
}
