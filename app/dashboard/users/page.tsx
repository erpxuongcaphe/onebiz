"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Search, Plus, Edit, Trash2, Eye, Filter, X, UserCircle, Link2, Shield, Loader2 } from "lucide-react";
import { cn, roleLabels } from "@/lib/utils";
import { getUsers, createUser, updateUser, deleteUser as deleteUserApi, User } from "@/lib/api/users";
import { getEmployees } from "@/lib/api/employees";
import { useAuth } from "@/contexts/AuthContext";
import { UserRole, Employee } from "@/lib/database.types";
import { logActivity } from "@/lib/api/activity-logs";

// Form data type (includes password for new users)
type UserFormData = {
    id: string;
    username: string;
    email: string;
    password: string;
    fullName: string;
    role: UserRole;
    employeeId: string | null;
    isActive: boolean;
    createdAt: string;
};

// User Form Modal
function UserFormModal({
    isOpen,
    onClose,
    onSave,
    user,
    existingUsers,
    employees
}: {
    isOpen: boolean;
    onClose: () => void;
    onSave: (user: User & { password?: string }) => void;
    user: User | null;
    existingUsers: User[];
    employees: Employee[];
}) {
    const isEditing = !!user;
    const [formData, setFormData] = useState<Partial<UserFormData>>(
        user ? { ...user, password: '' } : {
            id: `USR${String(Math.floor(Math.random() * 900) + 100).padStart(3, '0')}`,
            username: '',
            email: '',
            password: '',
            fullName: '',
            role: 'member',
            employeeId: null,
            isActive: true,
            createdAt: new Date().toISOString().split('T')[0],
        }
    );
    const [confirmPassword, setConfirmPassword] = useState('');
    const [errors, setErrors] = useState<Record<string, string>>({});

    useEffect(() => {
        if (user) {
            setFormData({ ...user, password: '' });
        } else {
            setFormData({
                id: `USR${String(Math.floor(Math.random() * 900) + 100).padStart(3, '0')}`,
                username: '',
                email: '',
                password: '',
                fullName: '',
                role: 'member',
                employeeId: null,
                isActive: true,
                createdAt: new Date().toISOString().split('T')[0],
            });
        }
        setConfirmPassword('');
        setErrors({});
    }, [user, isOpen]);

    if (!isOpen) return null;

    const validate = () => {
        const newErrors: Record<string, string> = {};

        if (!formData.username?.trim()) {
            newErrors.username = 'Vui lòng nhập tên đăng nhập';
        } else if (existingUsers.some(u => u.username === formData.username && u.id !== user?.id)) {
            newErrors.username = 'Tên đăng nhập đã tồn tại';
        }

        if (!formData.email?.trim()) {
            newErrors.email = 'Vui lòng nhập email';
        }

        if (!formData.fullName?.trim()) {
            newErrors.fullName = 'Vui lòng nhập họ tên';
        }

        if (!isEditing) {
            if (!formData.password?.trim()) {
                newErrors.password = 'Vui lòng nhập mật khẩu';
            } else if (formData.password.length < 6) {
                newErrors.password = 'Mật khẩu phải có ít nhất 6 ký tự';
            }

            if (formData.password !== confirmPassword) {
                newErrors.confirmPassword = 'Mật khẩu xác nhận không khớp';
            }
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!validate()) return;

        const newUser: User = {
            ...formData as User,
        };
        onSave(newUser);
        onClose();
    };

    // Get linked employee name
    const getLinkedEmployee = (employeeId: string | null) => {
        if (!employeeId) return null;
        return employees.find(e => e.id === employeeId);
    };

    return (
        <>
            <div
                className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 animate-fade-in"
                onClick={onClose}
            />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg animate-scale-in max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                    {/* Header */}
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
                        <h2 className="text-lg font-semibold text-slate-900">
                            {isEditing ? 'Chỉnh sửa tài khoản' : 'Thêm tài khoản mới'}
                        </h2>
                        <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="p-6 space-y-4">
                        {/* Username */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">
                                Tên đăng nhập <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={formData.username}
                                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                                className={cn(
                                    "w-full px-4 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 transition-all",
                                    errors.username
                                        ? "border-red-300 focus:ring-red-500/20 focus:border-red-500"
                                        : "border-slate-200 focus:ring-blue-500/20 focus:border-blue-500"
                                )}
                                disabled={isEditing}
                            />
                            {errors.username && <p className="text-xs text-red-500 mt-1">{errors.username}</p>}
                        </div>

                        {/* Full Name */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">
                                Họ và tên <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={formData.fullName}
                                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                                className={cn(
                                    "w-full px-4 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 transition-all",
                                    errors.fullName
                                        ? "border-red-300 focus:ring-red-500/20 focus:border-red-500"
                                        : "border-slate-200 focus:ring-blue-500/20 focus:border-blue-500"
                                )}
                            />
                            {errors.fullName && <p className="text-xs text-red-500 mt-1">{errors.fullName}</p>}
                        </div>

                        {/* Email */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">
                                Email <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="email"
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                className={cn(
                                    "w-full px-4 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 transition-all",
                                    errors.email
                                        ? "border-red-300 focus:ring-red-500/20 focus:border-red-500"
                                        : "border-slate-200 focus:ring-blue-500/20 focus:border-blue-500"
                                )}
                            />
                            {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
                        </div>

                        {/* Password (only for new users) */}
                        {!isEditing && (
                            <>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        Mật khẩu <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="password"
                                        value={formData.password}
                                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                        className={cn(
                                            "w-full px-4 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 transition-all",
                                            errors.password
                                                ? "border-red-300 focus:ring-red-500/20 focus:border-red-500"
                                                : "border-slate-200 focus:ring-blue-500/20 focus:border-blue-500"
                                        )}
                                    />
                                    {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password}</p>}
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        Xác nhận mật khẩu <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="password"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        className={cn(
                                            "w-full px-4 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 transition-all",
                                            errors.confirmPassword
                                                ? "border-red-300 focus:ring-red-500/20 focus:border-red-500"
                                                : "border-slate-200 focus:ring-blue-500/20 focus:border-blue-500"
                                        )}
                                    />
                                    {errors.confirmPassword && <p className="text-xs text-red-500 mt-1">{errors.confirmPassword}</p>}
                                </div>
                            </>
                        )}

                        {/* Role & Status */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Cấp độ</label>
                                <select
                                    value={formData.role}
                                    onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })}
                                    className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all bg-white"
                                >
                                    <option value="admin">Quản trị viên</option>
                                    <option value="accountant">Kế toán</option>
                                    <option value="branch_manager">Quản lý chi nhánh</option>
                                    <option value="member">Thành viên</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Trạng thái</label>
                                <select
                                    value={formData.isActive ? 'active' : 'inactive'}
                                    onChange={(e) => setFormData({ ...formData, isActive: e.target.value === 'active' })}
                                    className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all bg-white"
                                >
                                    <option value="active">Đang hoạt động</option>
                                    <option value="inactive">Ngừng hoạt động</option>
                                </select>
                            </div>
                        </div>

                        {/* Link Employee */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">
                                Liên kết nhân viên
                            </label>
                            <select
                                value={formData.employeeId || ''}
                                onChange={(e) => setFormData({ ...formData, employeeId: e.target.value || null })}
                                className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all bg-white"
                            >
                                <option value="">-- Không liên kết --</option>
                                {employees.map((emp: Employee) => (
                                    <option key={emp.id} value={emp.id}>
                                        {emp.id} - {emp.name} ({emp.department})
                                    </option>
                                ))}
                            </select>
                            {formData.employeeId && (
                                <div className="mt-2 p-3 bg-blue-50 rounded-xl border border-blue-100">
                                    <div className="flex items-center gap-2 text-sm text-blue-700">
                                        <Link2 className="w-4 h-4" />
                                        <span>Liên kết với: <strong>{getLinkedEmployee(formData.employeeId)?.name}</strong></span>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Actions */}
                        <div className="flex gap-3 pt-4">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 py-2.5 px-4 text-slate-600 text-sm font-medium rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
                            >
                                Hủy
                            </button>
                            <button
                                type="submit"
                                className="flex-1 py-2.5 px-4 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
                            >
                                {isEditing ? 'Cập nhật' : 'Thêm mới'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </>
    );
}

// User Detail Slide-over
function UserDetail({ user, onClose, onEdit, employees }: { user: User | null; onClose: () => void; onEdit: () => void; employees: Employee[] }) {
    if (!user) return null;

    const linkedEmployee = employees.find((e: Employee) => e.id === user.employeeId);

    const getInitials = (name: string) => {
        const words = name.split(' ');
        if (words.length >= 2) {
            return words[0][0] + words[words.length - 1][0];
        }
        return name.substring(0, 2).toUpperCase();
    };

    return (
        <>
            <div
                className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 animate-fade-in"
                onClick={onClose}
            />
            <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white shadow-2xl z-50 animate-slide-in overflow-y-auto">
                <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between z-10">
                    <h2 className="text-lg font-semibold text-slate-900">Thông tin tài khoản</h2>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="px-6 py-8 bg-gradient-to-br from-purple-500 to-blue-500 text-white">
                    <div className="flex items-center gap-4">
                        <div className="w-20 h-20 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-2xl font-bold shadow-lg">
                            {getInitials(user.fullName)}
                        </div>
                        <div>
                            <h3 className="text-xl font-bold">{user.fullName}</h3>
                            <p className="text-purple-100 mt-1">@{user.username}</p>
                            <span className={cn(
                                "inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 text-xs font-medium rounded-full",
                                user.isActive
                                    ? "bg-green-400/20 text-green-100"
                                    : "bg-red-400/20 text-red-100"
                            )}>
                                <span className={cn("w-1.5 h-1.5 rounded-full", user.isActive ? "bg-green-400" : "bg-red-400")} />
                                {user.isActive ? "Đang hoạt động" : "Ngừng hoạt động"}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="p-6 space-y-6">
                    <div>
                        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Thông tin tài khoản</h4>
                        <div className="space-y-3">
                            <div className="flex items-center gap-3 text-sm">
                                <div className="p-2 bg-slate-100 rounded-lg"><UserCircle className="w-4 h-4 text-slate-500" /></div>
                                <div><span className="text-slate-500">Mã: </span><span className="text-slate-900 font-medium">{user.id}</span></div>
                            </div>
                            <div className="flex items-center gap-3 text-sm">
                                <div className="p-2 bg-slate-100 rounded-lg"><Shield className="w-4 h-4 text-slate-500" /></div>
                                <div className="flex items-center gap-2">
                                    <span className="text-slate-500">Cấp độ: </span>
                                    <span className={cn(
                                        "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ring-1 ring-inset",
                                        roleLabels[user.role].class
                                    )}>
                                        <span className={cn("w-1.5 h-1.5 rounded-full", roleLabels[user.role].dot)} />
                                        {roleLabels[user.role].label}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {linkedEmployee && (
                        <div>
                            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Nhân viên liên kết</h4>
                            <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                                <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 rounded-xl gradient-primary flex items-center justify-center text-white font-bold shadow-md">
                                        {linkedEmployee.avatar}
                                    </div>
                                    <div>
                                        <p className="font-medium text-slate-900">{linkedEmployee.name}</p>
                                        <p className="text-sm text-slate-500">{linkedEmployee.position} - {linkedEmployee.department}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="flex gap-3 pt-4 border-t border-slate-100">
                        <button
                            onClick={onEdit}
                            className="flex-1 py-2.5 px-4 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
                        >
                            Chỉnh sửa
                        </button>
                        <button className="py-2.5 px-4 text-red-600 text-sm font-medium rounded-xl border border-red-200 hover:bg-red-50 transition-colors">
                            Xóa
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}

// Delete Confirmation Modal
function DeleteConfirmModal({
    isOpen,
    onClose,
    onConfirm,
    userName
}: {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    userName: string;
}) {
    if (!isOpen) return null;

    return (
        <>
            <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 animate-fade-in" onClick={onClose} />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm animate-scale-in p-6" onClick={e => e.stopPropagation()}>
                    <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4 mx-auto">
                        <Trash2 className="w-6 h-6 text-red-600" />
                    </div>
                    <h3 className="text-lg font-semibold text-slate-900 text-center mb-2">Xác nhận xóa</h3>
                    <p className="text-sm text-slate-500 text-center mb-6">
                        Bạn có chắc chắn muốn xóa tài khoản <strong>{userName}</strong>? Hành động này không thể hoàn tác.
                    </p>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="flex-1 py-2.5 px-4 text-slate-600 text-sm font-medium rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
                        >
                            Hủy
                        </button>
                        <button
                            onClick={onConfirm}
                            className="flex-1 py-2.5 px-4 bg-red-600 text-white text-sm font-medium rounded-xl hover:bg-red-700 transition-colors"
                        >
                            Xóa
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}

export default function UsersPage() {
    const router = useRouter();
    const { user: currentUser, hasPermission } = useAuth();
    const [users, setUsers] = useState<User[]>([]);
    const [employees, setEmployeesData] = useState<Employee[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedRole, setSelectedRole] = useState<string>("all");
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [deleteUserState, setDeleteUserState] = useState<User | null>(null);

    // Check permission
    useEffect(() => {
        if (!hasPermission(['admin'])) {
            router.push('/dashboard');
            return;
        }
        fetchData();
    }, [hasPermission, router]);

    const fetchData = async () => {
        try {
            setIsLoading(true);
            setError(null);
            const [usersData, employeesResult] = await Promise.all([
                getUsers(),
                getEmployees()
            ]);
            setUsers(usersData);
            setEmployeesData(employeesResult);
        } catch (err: unknown) {
            console.error('Failed to fetch data:', err);
            const errorMsg = err instanceof Error ? err.message : 'Lỗi không xác định';
            setError(`Không thể tải dữ liệu: ${errorMsg}`);
        } finally {
            setIsLoading(false);
        }
    };

    const filteredUsers = users.filter((user) => {
        const matchesSearch =
            user.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            user.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
            user.email.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesRole = selectedRole === "all" || user.role === selectedRole;
        return matchesSearch && matchesRole;
    });

    const handleSaveUser = async (userData: User & { password?: string }) => {
        try {
            if (editingUser) {
                await updateUser(editingUser.id, {
                    email: userData.email,
                    fullName: userData.fullName,
                    role: userData.role,
                    employeeId: userData.employeeId,
                    isActive: userData.isActive,
                });
                // Log activity
                if (currentUser) {
                    logActivity({
                        userId: currentUser.employeeId || currentUser.id,
                        userName: currentUser.fullName,
                        userRole: currentUser.role,
                        action: 'update',
                        entityType: 'user',
                        entityId: editingUser.id,
                        entityName: userData.fullName,
                        details: { role: userData.role, isActive: userData.isActive }
                    });
                }
            } else {
                const newUser = await createUser({
                    id: userData.id,
                    username: userData.username,
                    email: userData.email,
                    password: userData.password || 'default123',
                    fullName: userData.fullName,
                    role: userData.role,
                    employeeId: userData.employeeId,
                    isActive: userData.isActive,
                });
                // Log activity
                if (currentUser) {
                    logActivity({
                        userId: currentUser.employeeId || currentUser.id,
                        userName: currentUser.fullName,
                        userRole: currentUser.role,
                        action: 'create',
                        entityType: 'user',
                        entityId: newUser.id,
                        entityName: newUser.fullName,
                        details: { role: newUser.role, username: newUser.username }
                    });
                }
            }
            await fetchData();
            setEditingUser(null);
        } catch (err) {
            console.error('Failed to save user:', err);
            alert('Lỗi khi lưu dữ liệu. Vui lòng thử lại.');
        }
    };

    const handleEditFromDetail = () => {
        setEditingUser(selectedUser);
        setSelectedUser(null);
        setIsFormOpen(true);
    };

    const handleDelete = async () => {
        if (deleteUserState) {
            try {
                await deleteUserApi(deleteUserState.id);
                // Log activity
                if (currentUser) {
                    logActivity({
                        userId: currentUser.employeeId || currentUser.id,
                        userName: currentUser.fullName,
                        userRole: currentUser.role,
                        action: 'delete',
                        entityType: 'user',
                        entityId: deleteUserState.id,
                        entityName: deleteUserState.fullName
                    });
                }
                await fetchData();
                setDeleteUserState(null);
            } catch (err) {
                console.error('Failed to delete user:', err);
                alert('Lỗi khi xóa tài khoản. Vui lòng thử lại.');
            }
        }
    };

    const openAddForm = () => {
        setEditingUser(null);
        setIsFormOpen(true);
    };

    const getLinkedEmployee = (employeeId: string | null) => {
        if (!employeeId) return null;
        return employees.find(e => e.id === employeeId);
    };

    const getInitials = (name: string) => {
        const words = name.split(' ');
        if (words.length >= 2) {
            return words[0][0] + words[words.length - 1][0];
        }
        return name.substring(0, 2).toUpperCase();
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-96">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                <span className="ml-2 text-slate-600">Đang tải dữ liệu...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center h-96">
                <p className="text-red-500 mb-4">{error}</p>
                <button
                    onClick={fetchData}
                    className="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700"
                >
                    Thử lại
                </button>
            </div>
        );
    }


    return (
        <>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 animate-fade-in">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Quản lý Users</h1>
                        <p className="text-slate-500 mt-1">Quản lý tài khoản người dùng hệ thống</p>
                    </div>
                    <button
                        onClick={openAddForm}
                        className="inline-flex items-center gap-2 px-5 py-2.5 gradient-primary text-white text-sm font-medium rounded-xl shadow-lg shadow-blue-500/20 hover:shadow-xl hover:scale-105 transition-all duration-200 btn-glow"
                    >
                        <Plus className="w-4 h-4" />
                        Thêm tài khoản
                    </button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-slide-up">
                    <div className="bg-white rounded-2xl border border-slate-200 p-5">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 bg-purple-100 rounded-xl">
                                <Shield className="w-5 h-5 text-purple-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold text-slate-900">{users.filter(u => u.role === 'admin').length}</p>
                                <p className="text-xs text-slate-500">Quản trị viên</p>
                            </div>
                        </div>
                    </div>
                    <div className="bg-white rounded-2xl border border-slate-200 p-5">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 bg-blue-100 rounded-xl">
                                <UserCircle className="w-5 h-5 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold text-slate-900">{users.filter(u => u.role === 'accountant').length}</p>
                                <p className="text-xs text-slate-500">Kế toán</p>
                            </div>
                        </div>
                    </div>
                    <div className="bg-white rounded-2xl border border-slate-200 p-5">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 bg-amber-100 rounded-xl">
                                <UserCircle className="w-5 h-5 text-amber-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold text-slate-900">{users.filter(u => u.role === 'branch_manager').length}</p>
                                <p className="text-xs text-slate-500">QL Chi nhánh</p>
                            </div>
                        </div>
                    </div>
                    <div className="bg-white rounded-2xl border border-slate-200 p-5">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 bg-slate-100 rounded-xl">
                                <UserCircle className="w-5 h-5 text-slate-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold text-slate-900">{users.filter(u => u.role === 'member').length}</p>
                                <p className="text-xs text-slate-500">Thành viên</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Filters & Search */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 animate-slide-up">
                    <div className="flex flex-col lg:flex-row gap-4">
                        {/* Search */}
                        <div className="relative flex-1">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Tìm kiếm theo tên, username, email..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-11 pr-4 py-3 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                            />
                        </div>
                        {/* Role Filter */}
                        <div className="flex items-center gap-2 bg-slate-50 px-4 py-3 rounded-xl">
                            <Filter className="w-4 h-4 text-slate-400" />
                            <select
                                value={selectedRole}
                                onChange={(e) => setSelectedRole(e.target.value)}
                                className="text-sm border-none focus:outline-none bg-transparent cursor-pointer"
                            >
                                <option value="all">Tất cả cấp độ</option>
                                <option value="admin">Quản trị viên</option>
                                <option value="accountant">Kế toán</option>
                                <option value="branch_manager">Quản lý chi nhánh</option>
                                <option value="member">Thành viên</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Table */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-slide-up">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="bg-slate-50/80 border-b border-slate-100">
                                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-6 py-4">Người dùng</th>
                                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-6 py-4">Cấp độ</th>
                                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-6 py-4">Nhân viên liên kết</th>
                                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-6 py-4">Trạng thái</th>
                                    <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider px-6 py-4">Thao tác</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {filteredUsers.map((user, index) => {
                                    const linkedEmployee = getLinkedEmployee(user.employeeId);
                                    return (
                                        <tr
                                            key={user.id}
                                            className="hover:bg-blue-50/50 transition-all duration-200 cursor-pointer group animate-fade-in"
                                            style={{ animationDelay: `${index * 50}ms` }}
                                            onClick={() => setSelectedUser(user)}
                                        >
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center text-white text-sm font-semibold shadow-md group-hover:scale-110 transition-transform duration-200">
                                                        {getInitials(user.fullName)}
                                                    </div>
                                                    <div>
                                                        <div className="text-sm font-medium text-slate-900">{user.fullName}</div>
                                                        <div className="text-xs text-slate-500">@{user.username} · {user.email}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                {user.role === 'admin' && (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-purple-600 text-white">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-purple-300" />
                                                        Quản trị viên
                                                    </span>
                                                )}
                                                {user.role === 'accountant' && (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-blue-600 text-white">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-300" />
                                                        Kế toán
                                                    </span>
                                                )}
                                                {user.role === 'branch_manager' && (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-amber-500 text-white">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-300" />
                                                        Quản lý chi nhánh
                                                    </span>
                                                )}
                                                {user.role === 'member' && (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-slate-600 text-white">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                                                        Thành viên
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                {linkedEmployee ? (
                                                    <div className="flex items-center gap-2 text-sm">
                                                        <Link2 className="w-4 h-4 text-blue-500" />
                                                        <span className="text-slate-700">{linkedEmployee.name}</span>
                                                    </div>
                                                ) : (
                                                    <span className="text-slate-400 text-sm">Chưa liên kết</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={cn(
                                                    "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ring-1 ring-inset",
                                                    user.isActive
                                                        ? "bg-green-50 text-green-700 ring-green-600/20"
                                                        : "bg-red-50 text-red-700 ring-red-600/20"
                                                )}>
                                                    <span className={cn("w-1.5 h-1.5 rounded-full", user.isActive ? "bg-green-500" : "bg-red-500")} />
                                                    {user.isActive ? "Hoạt động" : "Ngừng hoạt động"}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                                                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button onClick={() => setSelectedUser(user)} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-100 rounded-lg transition-colors">
                                                        <Eye className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => { setEditingUser(user); setIsFormOpen(true); }}
                                                        className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-100 rounded-lg transition-colors"
                                                    >
                                                        <Edit className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => setDeleteUserState(user)}
                                                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-100 rounded-lg transition-colors"
                                                        disabled={user.id === currentUser?.id}
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {filteredUsers.length === 0 && (
                        <div className="py-12 text-center">
                            <UserCircle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                            <p className="text-slate-500">Không tìm thấy tài khoản nào</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Modals */}
            <UserFormModal
                isOpen={isFormOpen}
                onClose={() => { setIsFormOpen(false); setEditingUser(null); }}
                onSave={handleSaveUser}
                user={editingUser}
                existingUsers={users}
                employees={employees}
            />

            <UserDetail
                user={selectedUser}
                onClose={() => setSelectedUser(null)}
                onEdit={handleEditFromDetail}
                employees={employees}
            />

            <DeleteConfirmModal
                isOpen={!!deleteUserState}
                onClose={() => setDeleteUserState(null)}
                onConfirm={handleDelete}
                userName={deleteUserState?.fullName || ''}
            />
        </>
    );
}
