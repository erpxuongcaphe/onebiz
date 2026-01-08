"use client";

import { useState, useEffect, useRef } from "react";
import { X, User, MapPin, Briefcase, DollarSign, FileText, Calendar, CreditCard, Save, Loader2, Camera, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Employee, EmployeeInsert } from "@/lib/database.types";
import { getDepartments, getPositions, Department, Position } from "@/lib/api/categories";
import { getBranches, Branch } from "@/lib/api/timekeeping";
import { getNextEmployeeId, checkEmployeeExistence } from "@/lib/api/employees";
import { supabase } from "@/lib/supabase";

interface EmployeeFormProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (employee: EmployeeInsert) => void;
    employee: Employee | null;
    isSaving?: boolean;
}

type TabType = "general" | "address" | "work" | "salary" | "notes";

export function EmployeeForm({ isOpen, onClose, onSave, employee, isSaving = false }: EmployeeFormProps) {
    const isEditing = !!employee;
    const [activeTab, setActiveTab] = useState<TabType>("general");
    const [formData, setFormData] = useState<Partial<EmployeeInsert>>({
        status: 'active',
        join_date: new Date().toISOString().split('T')[0],
        department: 'Kỹ thuật',
        employee_type: 'full_time_monthly',
    });

    const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
    const [isValidating, setIsValidating] = useState(false);

    // State for photo upload
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);
    const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // State for categories
    const [departments, setDepartments] = useState<Department[]>([]);
    const [positions, setPositions] = useState<Position[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);

    // Fetch categories on mount
    useEffect(() => {
        const fetchCategories = async () => {
            try {
                const [depts, pos, branchList] = await Promise.all([getDepartments(), getPositions(), getBranches()]);
                setDepartments(depts);
                setPositions(pos);
                setBranches(branchList);
            } catch (err) {
                console.error('Failed to fetch categories:', err);
            }
        };
        fetchCategories();
    }, []);

    // Reset form when opening
    useEffect(() => {
        if (isOpen) {
            setValidationErrors({});
            if (employee) {
                setFormData({ ...employee });
                // Set photo preview if employee has avatar URL
                if (employee.avatar && employee.avatar.startsWith('http')) {
                    setPhotoPreview(employee.avatar);
                } else {
                    setPhotoPreview(null);
                }
            } else {
                // Initialize with minimal data first to avoid flicker/delay visually
                setFormData({
                    name: '',
                    email: '',
                    department: departments[0]?.name || 'Kỹ thuật',
                    position: '',
                    phone: '',
                    status: 'active',
                    join_date: new Date().toISOString().split('T')[0],
                    address: '',
                    employee_type: 'full_time_monthly',
                    department_id: departments[0]?.id || null,
                    position_id: null,
                });
                setPhotoPreview(null);

                // Then fetch next ID
                getNextEmployeeId().then(nextId => {
                    setFormData(prev => ({ ...prev, id: nextId }));
                });
            }
        }
    }, [isOpen, employee, departments]);

    // Lock body scroll when modal is open (especially for mobile)
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
            document.body.style.position = 'fixed';
            document.body.style.width = '100%';
            document.body.style.top = `-${window.scrollY}px`;
        } else {
            const scrollY = document.body.style.top;
            document.body.style.overflow = '';
            document.body.style.position = '';
            document.body.style.width = '';
            document.body.style.top = '';
            window.scrollTo(0, parseInt(scrollY || '0') * -1);
        }
        return () => {
            document.body.style.overflow = '';
            document.body.style.position = '';
            document.body.style.width = '';
            document.body.style.top = '';
        };
    }, [isOpen]);

    // Handle photo upload with resize
    const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        // Validate file type
        if (!file.type.startsWith('image/')) {
            toast.error('File không hợp lệ', {
                description: 'Vui lòng chọn file ảnh (JPG, PNG, GIF)'
            });
            return;
        }

        // Max 2MB original file
        if (file.size > 2 * 1024 * 1024) {
            toast.error('Dung lượng quá lớn', {
                description: 'Dung lượng ảnh tối đa 2MB'
            });
            return;
        }

        setIsUploadingPhoto(true);

        try {
            // Create image element to resize (use window.Image to avoid conflict with React types)
            const img = document.createElement('img') as HTMLImageElement;
            const reader = new FileReader();

            reader.onload = (e) => {
                img.src = e.target?.result as string;
            };

            img.onload = async () => {
                // Resize to passport size (3x4 ratio, max 300x400px)
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 300;
                const MAX_HEIGHT = 400;

                let width = img.width;
                let height = img.height;

                // Calculate new dimensions maintaining aspect ratio
                if (width > MAX_WIDTH || height > MAX_HEIGHT) {
                    const ratio = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height);
                    width = Math.round(width * ratio);
                    height = Math.round(height * ratio);
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                if (!ctx) return;

                ctx.drawImage(img, 0, 0, width, height);

                // Convert to blob with quality compression
                canvas.toBlob(async (blob) => {
                    if (!blob) {
                        setIsUploadingPhoto(false);
                        return;
                    }

                    // Create filename
                    const fileExt = 'jpg';
                    const fileName = `${formData.id || 'temp'}_${Date.now()}.${fileExt}`;
                    const filePath = `employee-photos/${fileName}`;

                    // Upload to Supabase Storage
                    const { error } = await supabase.storage
                        .from('avatars')
                        .upload(filePath, blob, {
                            contentType: 'image/jpeg',
                            upsert: true
                        });

                    if (error) {
                        console.error('Upload error:', error);
                        // If bucket doesn't exist, just show local preview
                        const localUrl = canvas.toDataURL('image/jpeg', 0.8);
                        setPhotoPreview(localUrl);
                        setFormData(prev => ({ ...prev, avatar: localUrl }));
                    } else {
                        // Get public URL
                        const { data: urlData } = supabase.storage
                            .from('avatars')
                            .getPublicUrl(filePath);

                        setPhotoPreview(urlData.publicUrl);
                        setFormData(prev => ({ ...prev, avatar: urlData.publicUrl }));
                    }

                    setIsUploadingPhoto(false);
                }, 'image/jpeg', 0.8); // Compress to 80% quality
            };

            reader.readAsDataURL(file);
        } catch (err) {
            console.error('Photo upload failed:', err);
            setIsUploadingPhoto(false);
        }
    };

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setValidationErrors({});
        setIsValidating(true);

        const errors: Record<string, string> = {};

        // 1. Required Fields Check
        if (!formData.name?.trim()) errors.name = "Họ và tên là bắt buộc";
        if (!formData.id?.trim()) errors.id = "Mã nhân viên là bắt buộc";
        if (!formData.phone?.trim()) errors.phone = "Số điện thoại là bắt buộc";
        if (!formData.department) errors.department = "Vui lòng chọn phòng ban";
        if (!formData.position) errors.position = "Vui lòng chọn chức vụ";
        if (!formData.join_date) errors.join_date = "Ngày vào làm là bắt buộc";

        // 2. Format & Logic Checks
        if (formData.id) {
            const idRegex = /^XCP\d{5}$/;
            if (!idRegex.test(formData.id)) {
                errors.id = "Mã nhân viên phải theo định dạng XCPxxxxx (VD: XCP00001)";
            }
        }

        // Stop if basic validation fails to avoid unnecessary API calls
        if (Object.keys(errors).length > 0) {
            setValidationErrors(errors);
            setIsValidating(false);

            // Auto-switch tab based on error priority
            if (errors.name || errors.id || errors.join_date) {
                setActiveTab('general');
            } else if (errors.department || errors.position) {
                setActiveTab('work');
            } else if (errors.email || errors.phone) {
                setActiveTab('address');
            }

            toast.error('Thiếu thông tin bắt buộc', {
                description: 'Vui lòng kiểm tra các trường được đánh dấu đỏ'
            });
            return;
        }

        // 3. Uniqueness Checks (Async)
        try {
            const [idExists, idCardExists, phoneExists] = await Promise.all([
                checkEmployeeExistence('id', formData.id!, employee?.id),
                formData.identity_card ? checkEmployeeExistence('identity_card', formData.identity_card, employee?.id) : false,
                formData.phone ? checkEmployeeExistence('phone', formData.phone, employee?.id) : false
            ]);

            if (idExists) errors.id = "Mã nhân viên đã tồn tại";
            if (idCardExists) errors.identity_card = "Số CCCD/CMND đã tồn tại trong hệ thống";
            if (phoneExists) errors.phone = "Số điện thoại đã tồn tại trong hệ thống";

        } catch (err: unknown) {
            console.error("Validation check failed", err);
            const errorMsg = err instanceof Error ? err.message : 'Lỗi không xác định';
            toast.error('Lỗi kiểm tra dữ liệu', {
                description: errorMsg
            });
            setIsValidating(false);
            return;
        }

        if (Object.keys(errors).length > 0) {
            setValidationErrors(errors);
            setIsValidating(false);

            if (errors.id || errors.identity_card) setActiveTab('general');
            else if (errors.phone) setActiveTab('address');

            return;
        }

        setIsValidating(false);

        // Combine address parts if provided
        let fullAddress = formData.address || '';
        if (formData.address_street || formData.address_ward || formData.address_district || formData.address_city) {
            const parts = [
                formData.address_street,
                formData.address_ward,
                formData.address_district,
                formData.address_city
            ].filter(Boolean);
            if (parts.length > 0) fullAddress = parts.join(', ');
        }

        // Generate avatar
        const avatar = formData.avatar || (formData.name ?
            (formData.name.split(' ').length >= 2
                ? formData.name.split(' ').slice(-2).map(n => n[0]).join('')
                : formData.name.substring(0, 2)).toUpperCase()
            : 'NV');

        onSave({
            ...formData as EmployeeInsert,
            address: fullAddress,
            avatar
        });
    };

    const tabs: { id: TabType; label: string; icon: React.ElementType }[] = [
        { id: "general", label: "Thông tin chung", icon: User },
        { id: "address", label: "Liên hệ & Địa chỉ", icon: MapPin },
        { id: "work", label: "Công việc", icon: Briefcase },
        { id: "salary", label: "Lương & Phúc lợi", icon: DollarSign },
        { id: "notes", label: "Ghi chú", icon: FileText },
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-hidden">
            <div
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity touch-none"
                onClick={onClose}
            />

            <div className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh] animate-scale-in">
                {/* Header */}
                <div className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b border-slate-100 flex-shrink-0">
                    <div className="flex-1 min-w-0">
                        <h2 className="text-lg md:text-xl font-bold text-slate-900 truncate">
                            {isEditing ? 'Chỉnh sửa hồ sơ' : 'Thêm nhân viên'}
                        </h2>
                        <p className="text-xs md:text-sm text-slate-500 mt-0.5 truncate hidden md:block">
                            {isEditing ? `Cập nhật thông tin cho ${employee?.name}` : 'Nhập thông tin nhân viên mới vào hệ thống'}
                        </p>
                    </div>

                    {/* Mobile: Save button in header */}
                    <div className="flex items-center gap-2 md:hidden">
                        <button
                            type="submit"
                            form="employee-form"
                            disabled={isSaving || isValidating}
                            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                        >
                            {isValidating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            {isValidating ? 'Đang kiểm tra' : (isSaving ? 'Đang lưu' : 'Lưu')}
                        </button>
                        <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Desktop: Only close button */}
                    <button onClick={onClose} className="hidden md:block p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Mobile Tabs - OUTSIDE the flex row container */}
                <div className="md:hidden flex overflow-x-auto border-b border-slate-200 p-2 gap-2 flex-shrink-0 bg-slate-50">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={cn(
                                "flex-shrink-0 flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg whitespace-nowrap",
                                activeTab === tab.id
                                    ? "bg-white text-blue-600 shadow-sm"
                                    : "text-slate-600"
                            )}
                        >
                            <tab.icon className="w-4 h-4" />
                            {tab.label}
                        </button>
                    ))}
                </div>

                <div className="flex flex-1 overflow-hidden">
                    {/* Sidebar Tabs - Desktop only */}
                    <div className="w-64 bg-slate-50 border-r border-slate-200 p-4 flex-shrink-0 hidden md:block overflow-y-auto">
                        <div className="space-y-1">
                            {tabs.map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={cn(
                                        "w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-xl transition-all",
                                        activeTab === tab.id
                                            ? "bg-white text-blue-600 shadow-sm ring-1 ring-slate-200"
                                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                                    )}
                                >
                                    <tab.icon className={cn("w-4 h-4", activeTab === tab.id ? "text-blue-500" : "text-slate-400")} />
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Form Content */}
                    <div className="flex-1 overflow-y-auto p-6 md:p-8 overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
                        <form id="employee-form" onSubmit={handleSubmit} className="space-y-6">

                            {/* General Info */}
                            {activeTab === 'general' && (
                                <div className="space-y-6 animate-fade-in">
                                    {/* Photo Upload Section */}
                                    <div className="flex justify-center">
                                        <div className="text-center">
                                            <div
                                                className="relative w-32 h-40 mx-auto mb-3 rounded-xl overflow-hidden border-2 border-dashed border-slate-300 hover:border-blue-400 transition-colors cursor-pointer bg-slate-50"
                                                onClick={() => fileInputRef.current?.click()}
                                            >
                                                {isUploadingPhoto ? (
                                                    <div className="absolute inset-0 flex items-center justify-center bg-white/80">
                                                        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                                                    </div>
                                                ) : photoPreview ? (
                                                    /* eslint-disable-next-line @next/next/no-img-element */
                                                    <img
                                                        src={photoPreview}
                                                        alt="Ảnh nhân viên"
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : (
                                                    <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
                                                        <Camera className="w-10 h-10 mb-2" />
                                                        <span className="text-xs">Ảnh thẻ 3x4</span>
                                                    </div>
                                                )}

                                                {/* Upload overlay on hover */}
                                                {!isUploadingPhoto && (
                                                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 hover:opacity-100 transition-opacity">
                                                        <Upload className="w-6 h-6 text-white" />
                                                    </div>
                                                )}
                                            </div>
                                            <input
                                                ref={fileInputRef}
                                                type="file"
                                                accept="image/*"
                                                onChange={handlePhotoUpload}
                                                className="hidden"
                                            />
                                            <p className="text-xs text-slate-500">
                                                Click để tải lên ảnh thẻ<br />
                                                <span className="text-slate-400">(Tối đa 2MB, tự động resize)</span>
                                            </p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="md:col-span-2">
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Họ và tên <span className="text-red-500">*</span></label>
                                            <input
                                                type="text"
                                                required
                                                value={formData.name || ''}
                                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                                className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                                                placeholder="Nguyễn Văn A"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Mã nhân viên <span className="text-red-500">*</span></label>
                                            <input
                                                type="text"
                                                required
                                                value={formData.id || ''}
                                                onChange={e => {
                                                    setFormData({ ...formData, id: e.target.value.toUpperCase() });
                                                    setValidationErrors({ ...validationErrors, id: '' });
                                                }}
                                                className={cn(
                                                    "w-full px-4 py-2.5 text-sm border rounded-xl focus:ring-2 outline-none transition-all",
                                                    validationErrors.id
                                                        ? "border-red-500 focus:border-red-500 focus:ring-red-500/20"
                                                        : "border-slate-200 focus:border-blue-500 focus:ring-blue-500/20"
                                                )}
                                                placeholder="XCPxxxxx"
                                            />
                                            {validationErrors.id && <p className="text-xs text-red-500 mt-1">{validationErrors.id}</p>}
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Số CCCD/CMND</label>
                                            <div className="relative">
                                                <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                                <input
                                                    type="text"
                                                    value={formData.identity_card || ''}
                                                    onChange={e => {
                                                        setFormData({ ...formData, identity_card: e.target.value });
                                                        setValidationErrors({ ...validationErrors, identity_card: '' });
                                                    }}
                                                    className={cn(
                                                        "w-full pl-10 pr-4 py-2.5 text-sm border rounded-xl focus:ring-2 outline-none transition-all",
                                                        validationErrors.identity_card
                                                            ? "border-red-500 focus:border-red-500 focus:ring-red-500/20"
                                                            : "border-slate-200 focus:border-blue-500 focus:ring-blue-500/20"
                                                    )}
                                                    placeholder="012345678910"
                                                />
                                            </div>
                                            {validationErrors.identity_card && <p className="text-xs text-red-500 mt-1">{validationErrors.identity_card}</p>}
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Ngày sinh</label>
                                            <input
                                                type="date"
                                                value={formData.date_of_birth || ''}
                                                onChange={e => setFormData({ ...formData, date_of_birth: e.target.value })}
                                                className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Giới tính</label>
                                            <select
                                                value={formData.gender || 'male'}
                                                onChange={e => setFormData({ ...formData, gender: e.target.value })}
                                                className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all bg-white"
                                            >
                                                <option value="male">Nam</option>
                                                <option value="female">Nữ</option>
                                                <option value="other">Khác</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Mã số thuế cá nhân</label>
                                            <input
                                                type="text"
                                                value={formData.tax_id || ''}
                                                onChange={e => setFormData({ ...formData, tax_id: e.target.value })}
                                                className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                                                placeholder="VD: 8012345678"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Mã số BHXH</label>
                                            <input
                                                type="text"
                                                value={formData.social_insurance_id || ''}
                                                onChange={e => setFormData({ ...formData, social_insurance_id: e.target.value })}
                                                className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                                                placeholder="VD: 1234567890"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Address & Contact */}
                            {activeTab === 'address' && (
                                <div className="space-y-6 animate-fade-in">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                                            <input
                                                type="email"
                                                value={formData.email || ''}
                                                onChange={e => setFormData({ ...formData, email: e.target.value })}
                                                className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                                                placeholder="example@email.com"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Số điện thoại <span className="text-red-500">*</span></label>
                                            <input
                                                type="tel"
                                                required
                                                value={formData.phone || ''}
                                                onChange={e => {
                                                    setFormData({ ...formData, phone: e.target.value });
                                                    setValidationErrors({ ...validationErrors, phone: '' });
                                                }}
                                                className={cn(
                                                    "w-full px-4 py-2.5 text-sm border rounded-xl focus:ring-2 outline-none transition-all",
                                                    validationErrors.phone
                                                        ? "border-red-500 focus:border-red-500 focus:ring-red-500/20"
                                                        : "border-slate-200 focus:border-blue-500 focus:ring-blue-500/20"
                                                )}
                                            />
                                            {validationErrors.phone && <p className="text-xs text-red-500 mt-1">{validationErrors.phone}</p>}
                                        </div>

                                        <div className="md:col-span-2 border-t border-slate-100 pt-4 mt-2">
                                            <h3 className="text-sm font-semibold text-slate-900 mb-4">Địa chỉ thường trú</h3>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div className="md:col-span-2">
                                                    <label className="block text-xs font-medium text-slate-500 mb-1">Số nhà, đường</label>
                                                    <input
                                                        type="text"
                                                        value={formData.address_street || ''}
                                                        onChange={e => setFormData({ ...formData, address_street: e.target.value })}
                                                        className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                                                        placeholder="123 Đường ABC"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-slate-500 mb-1">Phường/Xã</label>
                                                    <input
                                                        type="text"
                                                        value={formData.address_ward || ''}
                                                        onChange={e => setFormData({ ...formData, address_ward: e.target.value })}
                                                        className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-slate-500 mb-1">Quận/Huyện</label>
                                                    <input
                                                        type="text"
                                                        value={formData.address_district || ''}
                                                        onChange={e => setFormData({ ...formData, address_district: e.target.value })}
                                                        className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                                                    />
                                                </div>
                                                <div className="md:col-span-2">
                                                    <label className="block text-xs font-medium text-slate-500 mb-1">Tỉnh/Thành phố</label>
                                                    <input
                                                        type="text"
                                                        value={formData.address_city || ''}
                                                        onChange={e => setFormData({ ...formData, address_city: e.target.value })}
                                                        className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        <div className="md:col-span-2 border-t border-slate-100 pt-4 mt-2">
                                            <h3 className="text-sm font-semibold text-slate-900 mb-4">Người liên hệ khẩn cấp</h3>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-xs font-medium text-slate-500 mb-1">Họ tên người liên hệ</label>
                                                    <input
                                                        type="text"
                                                        value={formData.emergency_contact_name || ''}
                                                        onChange={e => setFormData({ ...formData, emergency_contact_name: e.target.value })}
                                                        className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-slate-500 mb-1">Số điện thoại</label>
                                                    <input
                                                        type="tel"
                                                        value={formData.emergency_contact_phone || ''}
                                                        onChange={e => setFormData({ ...formData, emergency_contact_phone: e.target.value })}
                                                        className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Work Info */}
                            {activeTab === 'work' && (
                                <div className="space-y-6 animate-fade-in">
                                    {/* Branch & Employee Type Section */}
                                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                                        <h4 className="text-sm font-semibold text-slate-700 mb-4">Chi nhánh & Hình thức nhân viên</h4>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                            <div>
                                                <label className="block text-xs font-medium text-slate-600 mb-1">Chi nhánh làm việc</label>
                                                <select
                                                    value={(formData as Record<string, unknown>).branch_id as string || ''}
                                                    onChange={e => setFormData({ ...formData, branch_id: e.target.value } as typeof formData)}
                                                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-blue-500 outline-none bg-white"
                                                >
                                                    <option value="">-- Chọn chi nhánh --</option>
                                                    {branches.map(b => (
                                                        <option key={b.id} value={b.id}>
                                                            {b.name} {b.is_office ? '(Văn phòng)' : '(Cửa hàng)'}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-slate-600 mb-1">Hình thức nhân viên</label>
                                                <select
                                                    value={formData.employee_type || 'full_time_monthly'}
                                                    onChange={e => setFormData({ ...formData, employee_type: e.target.value as Employee['employee_type'] })}
                                                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-blue-500 outline-none bg-white"
                                                >
                                                    <option value="full_time_monthly">Fulltime (lương tháng)</option>
                                                    <option value="full_time_hourly">Fulltime (lương giờ)</option>
                                                    <option value="part_time">Parttime</option>
                                                    <option value="probation">Nhân viên thử việc</option>
                                                    <option value="intern">Thực tập sinh</option>
                                                </select>
                                            </div>
                                            {formData.employee_type === 'full_time_hourly' && (
                                                <div>
                                                    <label className="block text-xs font-medium text-slate-600 mb-1">Lương/giờ (VNĐ)</label>
                                                    <input
                                                        type="number"
                                                        value={(formData as Record<string, unknown>).hourly_rate as number || ''}
                                                        onChange={e => setFormData({ ...formData, hourly_rate: parseInt(e.target.value) } as typeof formData)}
                                                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-blue-500 outline-none"
                                                        placeholder="30000"
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Phòng ban <span className="text-red-500">*</span></label>
                                            <select
                                                value={formData.department || ''}
                                                onChange={(e) => {
                                                    const selectedName = e.target.value;
                                                    const selectedDept = departments.find(d => d.name === selectedName);
                                                    setFormData({
                                                        ...formData,
                                                        department: selectedName,
                                                        department_id: selectedDept?.id || null, // Capture ID
                                                        // Reset position when department changes if needed? Maybe not strictly required but good UX
                                                    });
                                                }}
                                                className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all bg-white"
                                                required
                                            >
                                                <option value="">-- Chọn phòng ban --</option>
                                                {departments.map((dept) => (
                                                    <option key={dept.id} value={dept.name}>
                                                        {dept.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Chức vụ <span className="text-red-500">*</span></label>
                                            <select
                                                value={formData.position || ''}
                                                onChange={(e) => {
                                                    const selectedName = e.target.value;
                                                    const selectedPos = positions.find(p => p.name === selectedName);
                                                    setFormData({
                                                        ...formData,
                                                        position: selectedName,
                                                        position_id: selectedPos?.id || null
                                                    });
                                                }}
                                                className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all bg-white"
                                                required
                                            >
                                                <option value="">-- Chọn chức vụ --</option>
                                                {positions.map((pos) => (
                                                    <option key={pos.id} value={pos.name}>
                                                        {pos.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Trạng thái</label>
                                            <select
                                                value={formData.status || 'active'}
                                                onChange={e => setFormData({ ...formData, status: e.target.value as Employee['status'] })}
                                                className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all bg-white"
                                            >
                                                <option value="active">Đang làm việc</option>
                                                <option value="probation">Thử việc</option>
                                                <option value="inactive">Đã nghỉ việc</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Ngày bắt đầu làm việc <span className="text-red-500">*</span></label>
                                            <div className="relative">
                                                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                                <input
                                                    type="date"
                                                    required
                                                    value={formData.join_date || ''}
                                                    onChange={e => setFormData({ ...formData, join_date: e.target.value })}
                                                    className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Ngày nghỉ việc</label>
                                            <input
                                                type="date"
                                                value={formData.termination_date || ''}
                                                onChange={e => setFormData({ ...formData, termination_date: e.target.value })}
                                                className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Salary & Benefits */}
                            {activeTab === 'salary' && (
                                <div className="space-y-6 animate-fade-in">
                                    <div className="bg-green-50 rounded-2xl p-6 border border-green-100">
                                        <h3 className="text-sm font-semibold text-green-800 mb-4 flex items-center gap-2">
                                            <DollarSign className="w-4 h-4" />
                                            Thông tin lương
                                        </h3>
                                        <div>
                                            <label className="block text-sm font-medium text-green-900 mb-1">Mức lương cơ bản</label>
                                            <div className="relative">
                                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-green-600 font-medium">₫</span>
                                                <input
                                                    type="number"
                                                    value={formData.salary || ''}
                                                    onChange={e => setFormData({ ...formData, salary: parseFloat(e.target.value) })}
                                                    className="w-full pl-8 pr-4 py-3 text-lg font-semibold text-green-700 border border-green-200 rounded-xl focus:border-green-500 focus:ring-2 focus:ring-green-500/20 outline-none transition-all bg-white"
                                                    placeholder="0"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="bg-amber-50 rounded-2xl p-6 border border-amber-100">
                                        <h3 className="text-sm font-semibold text-amber-800 mb-4 flex items-center gap-2">
                                            <CreditCard className="w-4 h-4" />
                                            Phụ cấp & KPI (Riêng biệt)
                                        </h3>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs font-medium text-amber-900 mb-1">Mục tiêu KPI (VND)</label>
                                                <input
                                                    type="number"
                                                    value={formData.kpi_target || ''}
                                                    onChange={e => setFormData({ ...formData, kpi_target: parseFloat(e.target.value) })}
                                                    className="w-full px-4 py-2.5 text-sm border border-amber-200 rounded-xl focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-none transition-all bg-white"
                                                    placeholder="0"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-amber-900 mb-1">Hỗ trợ khác (VND/tháng)</label>
                                                <input
                                                    type="number"
                                                    value={formData.other_allowance || ''}
                                                    onChange={e => setFormData({ ...formData, other_allowance: parseFloat(e.target.value) })}
                                                    className="w-full px-4 py-2.5 text-sm border border-amber-200 rounded-xl focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-none transition-all bg-white"
                                                    placeholder="0"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-amber-900 mb-1">Hỗ trợ cơm (VND/ngày)</label>
                                                <input
                                                    type="number"
                                                    value={formData.lunch_allowance || ''}
                                                    onChange={e => setFormData({ ...formData, lunch_allowance: parseFloat(e.target.value) })}
                                                    className="w-full px-4 py-2.5 text-sm border border-amber-200 rounded-xl focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-none transition-all bg-white"
                                                    placeholder="Bỏ trống để dùng mặc định"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-amber-900 mb-1">Hỗ trợ xăng xe (VND/tháng)</label>
                                                <input
                                                    type="number"
                                                    value={formData.transport_allowance || ''}
                                                    onChange={e => setFormData({ ...formData, transport_allowance: parseFloat(e.target.value) })}
                                                    className="w-full px-4 py-2.5 text-sm border border-amber-200 rounded-xl focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-none transition-all bg-white"
                                                    placeholder="Bỏ trống để dùng mặc định"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-amber-900 mb-1">Hỗ trợ điện thoại (VND/tháng)</label>
                                                <input
                                                    type="number"
                                                    value={formData.phone_allowance || ''}
                                                    onChange={e => setFormData({ ...formData, phone_allowance: parseFloat(e.target.value) })}
                                                    className="w-full px-4 py-2.5 text-sm border border-amber-200 rounded-xl focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-none transition-all bg-white"
                                                    placeholder="Bỏ trống để dùng mặc định"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="bg-blue-50 rounded-2xl p-6 border border-blue-100">
                                        <h3 className="text-sm font-semibold text-blue-800 mb-4 flex items-center gap-2">
                                            <User className="w-4 h-4" />
                                            Thông tin đồng phục
                                        </h3>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs font-medium text-blue-900 mb-1">Chi phí đồng phục</label>
                                                <input
                                                    type="number"
                                                    value={formData.uniform_cost || ''}
                                                    onChange={e => setFormData({ ...formData, uniform_cost: parseFloat(e.target.value) })}
                                                    className="w-full px-4 py-2.5 text-sm border border-blue-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all bg-white"
                                                    placeholder="0"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-blue-900 mb-1">Ngày cấp phát</label>
                                                <input
                                                    type="date"
                                                    value={formData.uniform_issue_date || ''}
                                                    onChange={e => setFormData({ ...formData, uniform_issue_date: e.target.value })}
                                                    className="w-full px-4 py-2.5 text-sm border border-blue-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all bg-white"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-blue-900 mb-1">Ngày hết hạn khấu hao</label>
                                                <input
                                                    type="date"
                                                    value={formData.uniform_expiry_date || ''}
                                                    onChange={e => setFormData({ ...formData, uniform_expiry_date: e.target.value })}
                                                    className="w-full px-4 py-2.5 text-sm border border-blue-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all bg-white"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Notes */}
                            {activeTab === 'notes' && (
                                <div className="space-y-6 animate-fade-in">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Ghi chú thêm</label>
                                        <textarea
                                            rows={8}
                                            value={formData.notes || ''}
                                            onChange={e => setFormData({ ...formData, notes: e.target.value })}
                                            className="w-full px-4 py-3 text-sm border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all resize-none"
                                            placeholder="Nhập các ghi chú khác về nhân viên..."
                                        />
                                    </div>
                                </div>
                            )}

                        </form>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 flex-shrink-0 bg-white rounded-b-2xl">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-5 py-2.5 text-slate-600 text-sm font-medium rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
                    >
                        Hủy
                    </button>
                    <button
                        type="submit"
                        form="employee-form"
                        disabled={isSaving || isValidating}
                        className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50"
                    >
                        {isValidating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        {isValidating ? 'Đang kiểm tra...' : (isSaving ? 'Đang lưu...' : (isEditing ? 'Cập nhật hồ sơ' : 'Lưu hồ sơ mới'))}
                    </button>
                </div>
            </div>
        </div>
    );
}
