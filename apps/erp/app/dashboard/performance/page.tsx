"use client";

import { useState, useEffect } from "react";
import {
    Star,
    Users,
    Calendar,
    ChevronRight,
    Plus,
    Clock,
    CheckCircle,
    AlertCircle,
    Filter,
    X,
    Loader2,
    Pencil,
    Trash2,
    FileDown,
    Save,
    Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAuth } from "@/contexts/AuthContext";
import {
    getReviewCycles,
    getPerformanceReviews,
    getReviewCriteria,
    getRatingLabel,
    getRatingColor,
    getStatusLabel,
    getCycleStatusLabel,
    createReviewCycle,
    addEmployeesToCycle,
    submitReviewScores,
    createReviewCriteria,
    updateReviewCriteria,
    deleteReviewCriteria,
    type ReviewCycle,
    type PerformanceReview,
    type ReviewCriteria,
    type ReviewCycleStatus,
    type ReviewCycleType,
} from "@/lib/api/performance";
import { getEmployees } from "@/lib/api/employees";
import { Employee } from "@/lib/database.types";

export default function PerformancePage() {
    const { user } = useAuth();
    const [cycles, setCycles] = useState<ReviewCycle[]>([]);
    const [reviews, setReviews] = useState<PerformanceReview[]>([]);
    const [criteria, setCriteria] = useState<ReviewCriteria[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedCycle, setSelectedCycle] = useState<string | null>(null);
    const [showFilters, setShowFilters] = useState(false);
    const [filterStatus, setFilterStatus] = useState<ReviewCycleStatus | "all">("all");
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [isCreating, setIsCreating] = useState(false);

    // Add employees modal state
    const [showAddEmployeesModal, setShowAddEmployeesModal] = useState(false);
    const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
    const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
    const [isAddingEmployees, setIsAddingEmployees] = useState(false);

    // Review form state
    const [showReviewForm, setShowReviewForm] = useState(false);
    const [selectedReview, setSelectedReview] = useState<PerformanceReview | null>(null);
    const [reviewScores, setReviewScores] = useState<Record<string, number>>({});
    const [reviewComments, setReviewComments] = useState({ strengths: '', improvements: '', goals: '' });
    const [isSavingReview, setIsSavingReview] = useState(false);

    // Criteria management state
    const [showCriteriaModal, setShowCriteriaModal] = useState(false);
    const [editingCriteria, setEditingCriteria] = useState<ReviewCriteria | null>(null);
    const [criteriaForm, setCriteriaForm] = useState({ name: '', category: 'attitude', weight: 1, description: '', department: '' });
    const [isSavingCriteria, setIsSavingCriteria] = useState(false);

    // Category management state
    const defaultCategories = [
        { key: 'attitude', label: 'Thái độ làm việc' },
        { key: 'performance', label: 'Hiệu suất công việc' },
        { key: 'skill', label: 'Kỹ năng' },
        { key: 'teamwork', label: 'Làm việc nhóm' },
    ];
    const [categories, setCategories] = useState<Array<{ key: string; label: string }>>(defaultCategories);
    const [showCategoryModal, setShowCategoryModal] = useState(false);
    const [editingCategory, setEditingCategory] = useState<{ key: string; label: string } | null>(null);
    const [categoryForm, setCategoryForm] = useState({ key: '', label: '' });

    const [newCycle, setNewCycle] = useState({
        name: '',
        description: '',
        start_date: new Date().toISOString().split('T')[0],
        end_date: '',
        review_deadline: '',
        cycle_type: 'annually' as ReviewCycleType,
    });

    const [confirmDeleteCriteria, setConfirmDeleteCriteria] = useState<{ open: boolean; id: string }>({ open: false, id: '' });
    const [confirmDeleteCategory, setConfirmDeleteCategory] = useState<{ open: boolean; key: string }>({ open: false, key: '' });

    const isAdmin = user?.role === "admin" || user?.role === "branch_manager";

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        try {
            setLoading(true);
            const [cyclesData, reviewsData, criteriaData, employeesData] = await Promise.all([
                getReviewCycles(),
                getPerformanceReviews(),
                getReviewCriteria(),
                getEmployees(),
            ]);
            setCycles(cyclesData);
            setReviews(reviewsData);
            setCriteria(criteriaData);
            setAllEmployees(employeesData);

            // Select first active cycle by default
            const activeCycle = cyclesData.find((c) => c.status === "active");
            if (activeCycle) {
                setSelectedCycle(activeCycle.id);
            }
        } catch (error) {
            console.error("Failed to load data:", error);
        } finally {
            setLoading(false);
        }
    }

    async function handleAddEmployees() {
        if (!selectedCycle || selectedEmployeeIds.length === 0) return;
        setIsAddingEmployees(true);
        try {
            await addEmployeesToCycle(selectedCycle, selectedEmployeeIds);
            setShowAddEmployeesModal(false);
            setSelectedEmployeeIds([]);
            await loadData();
        } catch (error) {
            console.error("Failed to add employees:", error);
            alert("Có lỗi khi thêm nhân viên");
        } finally {
            setIsAddingEmployees(false);
        }
    }

    function openAddEmployeesModal() {
        setSelectedEmployeeIds([]);
        setShowAddEmployeesModal(true);
    }

    // Open review form for an employee
    function openReviewForm(review: PerformanceReview) {
        setSelectedReview(review);
        // Initialize scores from existing scores if any
        const existingScores: Record<string, number> = {};
        if (review.scores) {
            review.scores.forEach(s => {
                existingScores[s.criteria_id] = s.score || 0;
            });
        }
        setReviewScores(existingScores);
        setReviewComments({
            strengths: review.strengths || '',
            improvements: review.improvements || '',
            goals: review.goals || ''
        });
        setShowReviewForm(true);
    }

    // Save review scores
    async function handleSaveReview() {
        if (!selectedReview) return;
        setIsSavingReview(true);
        try {
            const scores = Object.entries(reviewScores).map(([criteria_id, score]) => ({
                criteria_id,
                score
            }));
            await submitReviewScores(selectedReview.id, scores, reviewComments);
            setShowReviewForm(false);
            await loadData();
        } catch (error) {
            console.error("Failed to save review:", error);
            alert("Có lỗi khi lưu đánh giá");
        } finally {
            setIsSavingReview(false);
        }
    }

    // Criteria management functions
    function openAddCriteria() {
        setEditingCriteria(null);
        setCriteriaForm({ name: '', category: 'attitude', weight: 1, description: '', department: '' });
        setShowCriteriaModal(true);
    }

    function openEditCriteria(crit: ReviewCriteria) {
        setEditingCriteria(crit);
        setCriteriaForm({
            name: crit.name,
            category: crit.category,
            weight: crit.weight,
            description: crit.description || '',
            department: (crit as ReviewCriteria & { department?: string }).department || ''
        });
        setShowCriteriaModal(true);
    }

    async function handleSaveCriteria() {
        if (!criteriaForm.name) return;
        setIsSavingCriteria(true);
        try {
            if (editingCriteria) {
                await updateReviewCriteria(editingCriteria.id, criteriaForm);
            } else {
                await createReviewCriteria(criteriaForm);
            }
            setShowCriteriaModal(false);
            await loadData();
        } catch (error) {
            console.error("Failed to save criteria:", error);
            alert("Có lỗi khi lưu tiêu chí");
        } finally {
            setIsSavingCriteria(false);
        }
    }

    async function handleDeleteCriteria(id: string) {
        setConfirmDeleteCriteria({ open: true, id });
    }

    async function confirmDeleteCriteriaAction() {
        if (!confirmDeleteCriteria.id) return;
        try {
            await deleteReviewCriteria(confirmDeleteCriteria.id);
            toast.success('Đã xóa tiêu chí');
            await loadData();
            setConfirmDeleteCriteria({ open: false, id: '' });
        } catch (error) {
            console.error("Failed to delete criteria:", error);
            toast.error('Lỗi khi xóa tiêu chí');
        }
    }

    // Export to Excel
    function exportToExcel() {
        if (cycleReviews.length === 0) {
            alert("Không có dữ liệu để xuất");
            return;
        }

        const selectedCycleData = cycles.find(c => c.id === selectedCycle);
        const headers = ['Nhân viên', 'Phòng ban', 'Vị trí', ...criteria.map(c => c.name), 'Điểm TB', 'Xếp loại', 'Trạng thái'];

        const rows = cycleReviews.map(review => {
            const criteriaScores = criteria.map(crit => {
                const score = review.scores?.find(s => s.criteria_id === crit.id);
                return score?.score?.toString() || '-';
            });
            return [
                review.employee?.name || '',
                review.employee?.department || '',
                review.employee?.position || '',
                ...criteriaScores,
                review.overall_score?.toFixed(1) || '-',
                review.overall_rating ? getRatingLabel(review.overall_rating) : '-',
                getStatusLabel(review.status)
            ];
        });

        // Create CSV content
        const csvContent = [
            `Đánh giá hiệu suất - ${selectedCycleData?.name || ''}`,
            '',
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        // Download
        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `danh-gia-hieu-suat-${selectedCycleData?.name || 'export'}.csv`;
        link.click();
    }

    const filteredCycles = cycles.filter((c) => {
        if (filterStatus !== "all" && c.status !== filterStatus) return false;
        return true;
    });

    const cycleReviews = selectedCycle
        ? reviews.filter((r) => r.cycle_id === selectedCycle)
        : [];

    const pendingCount = cycleReviews.filter((r) => r.status === "pending").length;
    const completedCount = cycleReviews.filter((r) => r.status === "final").length;

    function formatDate(dateStr: string) {
        return new Date(dateStr).toLocaleDateString("vi-VN", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
        });
    }

    // Group criteria by category
    const groupedCriteria = criteria.reduce((acc, crit) => {
        const cat = crit.category;
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(crit);
        return acc;
    }, {} as Record<string, ReviewCriteria[]>);

    // Create categoryLabels from dynamic categories
    const categoryLabels: Record<string, string> = categories.reduce((acc, cat) => {
        acc[cat.key] = cat.label;
        return acc;
    }, {} as Record<string, string>);

    // Category management handlers
    function openAddCategory() {
        setEditingCategory(null);
        setCategoryForm({ key: '', label: '' });
        setShowCategoryModal(true);
    }

    function openEditCategory(cat: { key: string; label: string }) {
        setEditingCategory(cat);
        setCategoryForm({ key: cat.key, label: cat.label });
        setShowCategoryModal(true);
    }

    function handleSaveCategory() {
        if (!categoryForm.label) return;
        if (editingCategory) {
            // Update existing
            setCategories(prev => prev.map(c =>
                c.key === editingCategory.key ? { ...c, label: categoryForm.label } : c
            ));
        } else {
            // Add new - create key from label
            const newKey = categoryForm.label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
            setCategories(prev => [...prev, { key: newKey, label: categoryForm.label }]);
        }
        setShowCategoryModal(false);
    }

    function handleDeleteCategory(key: string) {
        setConfirmDeleteCategory({ open: true, key });
    }

    function confirmDeleteCategoryAction() {
        if (!confirmDeleteCategory.key) return;
        setCategories(prev => prev.filter(c => c.key !== confirmDeleteCategory.key));
        toast.success('Đã xóa nhóm tiêu chí');
        setConfirmDeleteCategory({ open: false, key: '' });
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
            </div>
        );
    }

    return (
        <div className="space-y-4 md:space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
                        Đánh giá hiệu suất
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Quản lý và theo dõi đánh giá nhân viên
                    </p>
                </div>
                {isAdmin && (
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/25"
                    >
                        <Plus className="w-4 h-4" />
                        Tạo chu kỳ mới
                    </button>
                )}
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                            <Calendar className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                            <p className="text-xs text-slate-500">Chu kỳ đánh giá</p>
                            <p className="text-xl font-bold text-slate-900">{cycles.length}</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                            <Clock className="w-5 h-5 text-amber-600" />
                        </div>
                        <div>
                            <p className="text-xs text-slate-500">Chờ đánh giá</p>
                            <p className="text-xl font-bold text-slate-900">{pendingCount}</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
                            <CheckCircle className="w-5 h-5 text-green-600" />
                        </div>
                        <div>
                            <p className="text-xs text-slate-500">Hoàn thành</p>
                            <p className="text-xl font-bold text-slate-900">{completedCount}</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
                            <Star className="w-5 h-5 text-purple-600" />
                        </div>
                        <div>
                            <p className="text-xs text-slate-500">Tiêu chí</p>
                            <p className="text-xl font-bold text-slate-900">{criteria.length}</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
                {/* Cycles List */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="font-semibold text-slate-900">Chu kỳ đánh giá</h3>
                        <button
                            onClick={() => setShowFilters(!showFilters)}
                            className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                            <Filter className="w-4 h-4 text-slate-500" />
                        </button>
                    </div>

                    {showFilters && (
                        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
                            <select
                                value={filterStatus}
                                onChange={(e) =>
                                    setFilterStatus(e.target.value as ReviewCycleStatus | "all")
                                }
                                className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg"
                            >
                                <option value="all">Tất cả</option>
                                <option value="active">Đang diễn ra</option>
                                <option value="completed">Hoàn thành</option>
                                <option value="draft">Bản nháp</option>
                            </select>
                        </div>
                    )}

                    <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
                        {filteredCycles.length === 0 ? (
                            <div className="p-8 text-center">
                                <Calendar className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                                <p className="text-sm text-slate-500">Chưa có chu kỳ đánh giá</p>
                            </div>
                        ) : (
                            filteredCycles.map((cycle) => (
                                <button
                                    key={cycle.id}
                                    onClick={() => setSelectedCycle(cycle.id)}
                                    className={cn(
                                        "w-full p-4 text-left hover:bg-slate-50 transition-colors",
                                        selectedCycle === cycle.id && "bg-blue-50"
                                    )}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium text-slate-900 truncate">
                                                {cycle.name}
                                            </p>
                                            <p className="text-xs text-slate-500 mt-1">
                                                {formatDate(cycle.start_date)} - {formatDate(cycle.end_date)}
                                            </p>
                                        </div>
                                        <span
                                            className={cn(
                                                "shrink-0 px-2 py-0.5 rounded-full text-xs font-medium",
                                                cycle.status === "active"
                                                    ? "bg-green-100 text-green-700"
                                                    : cycle.status === "completed"
                                                        ? "bg-blue-100 text-blue-700"
                                                        : "bg-slate-100 text-slate-600"
                                            )}
                                        >
                                            {getCycleStatusLabel(cycle.status)}
                                        </span>
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </div>

                {/* Reviews List */}
                <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="font-semibold text-slate-900">
                            Danh sách đánh giá
                            {selectedCycle && (
                                <span className="text-sm font-normal text-slate-500 ml-2">
                                    ({cycleReviews.length} nhân viên)
                                </span>
                            )}
                        </h3>
                        <div className="flex items-center gap-2">
                            {selectedCycle && isAdmin && (
                                <button
                                    onClick={openAddEmployeesModal}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                >
                                    <Plus className="w-4 h-4" />
                                    Thêm NV
                                </button>
                            )}
                            {selectedCycle && cycleReviews.length > 0 && (
                                <button
                                    onClick={exportToExcel}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                                >
                                    <FileDown className="w-4 h-4" />
                                    Xuất Excel
                                </button>
                            )}
                        </div>
                    </div>

                    {!selectedCycle ? (
                        <div className="p-8 text-center">
                            <AlertCircle className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                            <p className="text-sm text-slate-500">
                                Chọn một chu kỳ đánh giá để xem chi tiết
                            </p>
                        </div>
                    ) : cycleReviews.length === 0 ? (
                        <div className="p-8 text-center">
                            <Users className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                            <p className="text-sm text-slate-500">
                                Chưa có đánh giá nào trong chu kỳ này
                            </p>
                            {isAdmin && (
                                <button
                                    onClick={openAddEmployeesModal}
                                    className="mt-3 inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
                                >
                                    <Plus className="w-4 h-4" />
                                    Thêm nhân viên
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
                            {cycleReviews.map((review) => (
                                <div
                                    key={review.id}
                                    onClick={() => openReviewForm(review)}
                                    className="p-4 hover:bg-slate-50 transition-colors cursor-pointer"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-sm font-bold shrink-0">
                                            {review.employee?.name
                                                ?.split(" ")
                                                .map((n) => n[0])
                                                .slice(-2)
                                                .join("")}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium text-slate-900">
                                                {review.employee?.name}
                                            </p>
                                            <p className="text-xs text-slate-500">
                                                {review.employee?.position} · {review.employee?.department}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {review.overall_rating && (
                                                <span
                                                    className={cn(
                                                        "px-2 py-0.5 rounded-full text-xs font-medium",
                                                        getRatingColor(review.overall_rating)
                                                    )}
                                                >
                                                    {getRatingLabel(review.overall_rating)}
                                                </span>
                                            )}
                                            {review.overall_score !== null && (
                                                <div className="flex items-center gap-1 text-sm">
                                                    <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                                                    <span className="font-semibold text-slate-900">
                                                        {review.overall_score.toFixed(1)}
                                                    </span>
                                                </div>
                                            )}
                                            <span
                                                className={cn(
                                                    "px-2 py-0.5 rounded-full text-xs font-medium",
                                                    review.status === "final"
                                                        ? "bg-green-100 text-green-700"
                                                        : review.status === "submitted"
                                                            ? "bg-blue-100 text-blue-700"
                                                            : "bg-amber-100 text-amber-700"
                                                )}
                                            >
                                                {getStatusLabel(review.status)}
                                            </span>
                                            <ChevronRight className="w-4 h-4 text-slate-400" />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Criteria Overview */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-slate-900">Tiêu chí đánh giá</h3>
                    {isAdmin && (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={openAddCriteria}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            >
                                <Plus className="w-4 h-4" />
                                Thêm tiêu chí
                            </button>
                            <button
                                onClick={openAddCategory}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                                <Settings className="w-4 h-4" />
                                Quản lý nhóm
                            </button>
                        </div>
                    )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {Object.entries(groupedCriteria).map(([category, items]) => (
                        <div key={category} className="bg-slate-50 rounded-xl p-4">
                            <h4 className="font-medium text-slate-700 mb-3 text-sm">
                                {categoryLabels[category] || category}
                            </h4>
                            <div className="space-y-2">
                                {items.map((crit) => (
                                    <div key={crit.id} className="flex items-center justify-between group">
                                        <span className="text-sm text-slate-600">{crit.name}</span>
                                        <div className="flex items-center gap-1">
                                            <span className="text-xs text-slate-400">
                                                x{crit.weight}
                                            </span>
                                            {isAdmin && (
                                                <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 ml-1">
                                                    <button
                                                        onClick={() => openEditCriteria(crit)}
                                                        className="p-1 text-slate-400 hover:text-blue-600 rounded"
                                                    >
                                                        <Pencil className="w-3 h-3" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteCriteria(crit.id)}
                                                        className="p-1 text-slate-400 hover:text-red-600 rounded"
                                                    >
                                                        <Trash2 className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Create Cycle Modal */}
            {
                showCreateModal && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
                            <div className="flex items-center justify-between p-4 border-b border-slate-200">
                                <h3 className="font-semibold text-lg text-slate-900">Tạo chu kỳ đánh giá mới</h3>
                                <button
                                    onClick={() => setShowCreateModal(false)}
                                    className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                                >
                                    <X className="w-5 h-5 text-slate-400" />
                                </button>
                            </div>
                            <form
                                onSubmit={async (e) => {
                                    e.preventDefault();
                                    if (!newCycle.name || !newCycle.end_date || !newCycle.review_deadline) {
                                        alert('Vui lòng điền đầy đủ thông tin');
                                        return;
                                    }
                                    setIsCreating(true);
                                    try {
                                        await createReviewCycle({
                                            ...newCycle,
                                            status: 'draft',
                                        });
                                        setShowCreateModal(false);
                                        setNewCycle({
                                            name: '',
                                            description: '',
                                            start_date: new Date().toISOString().split('T')[0],
                                            end_date: '',
                                            review_deadline: '',
                                            cycle_type: 'annually',
                                        });
                                        loadData();
                                    } catch (error) {
                                        console.error('Failed to create cycle:', error);
                                        alert('Lỗi khi tạo chu kỳ đánh giá');
                                    } finally {
                                        setIsCreating(false);
                                    }
                                }}
                                className="p-4 space-y-4"
                            >
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        Tên chu kỳ <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={newCycle.name}
                                        onChange={(e) => setNewCycle(prev => ({ ...prev, name: e.target.value }))}
                                        placeholder="VD: Đánh giá Q4 2024"
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        Mô tả
                                    </label>
                                    <textarea
                                        value={newCycle.description}
                                        onChange={(e) => setNewCycle(prev => ({ ...prev, description: e.target.value }))}
                                        placeholder="Mô tả chu kỳ đánh giá..."
                                        rows={2}
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        Loại chu kỳ
                                    </label>
                                    <select
                                        value={newCycle.cycle_type}
                                        onChange={(e) => setNewCycle(prev => ({ ...prev, cycle_type: e.target.value as ReviewCycleType }))}
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    >
                                        <option value="annually">Hàng năm</option>
                                        <option value="quarterly">Quý</option>
                                        <option value="monthly">Hàng tháng</option>
                                    </select>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">
                                            Ngày bắt đầu <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="date"
                                            value={newCycle.start_date}
                                            onChange={(e) => setNewCycle(prev => ({ ...prev, start_date: e.target.value }))}
                                            className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">
                                            Ngày kết thúc <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="date"
                                            value={newCycle.end_date}
                                            onChange={(e) => setNewCycle(prev => ({ ...prev, end_date: e.target.value }))}
                                            className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                                            required
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        Hạn nộp đánh giá <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="date"
                                        value={newCycle.review_deadline}
                                        onChange={(e) => setNewCycle(prev => ({ ...prev, review_deadline: e.target.value }))}
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                                        required
                                    />
                                </div>
                                <div className="flex gap-3 pt-2">
                                    <button
                                        type="button"
                                        onClick={() => setShowCreateModal(false)}
                                        className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors"
                                    >
                                        Hủy
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isCreating}
                                        className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
                                    >
                                        {isCreating ? (
                                            <>
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                Đang tạo...
                                            </>
                                        ) : (
                                            <>
                                                <Plus className="w-4 h-4" />
                                                Tạo chu kỳ
                                            </>
                                        )}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )
            }

            {/* Add Employees Modal */}
            {
                showAddEmployeesModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center">
                        <div
                            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                            onClick={() => setShowAddEmployeesModal(false)}
                        />
                        <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col overflow-hidden animate-scale-in">
                            <div className="p-6 border-b border-slate-200">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                        <Users className="w-5 h-5 text-blue-500" />
                                        Thêm nhân viên vào chu kỳ
                                    </h3>
                                    <button
                                        onClick={() => setShowAddEmployeesModal(false)}
                                        className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                                <p className="text-sm text-slate-500 mt-1">
                                    Chọn nhân viên để thêm vào danh sách đánh giá
                                </p>
                            </div>

                            <div className="flex-1 overflow-y-auto p-4">
                                {(() => {
                                    const existingEmployeeIds = reviews
                                        .filter(r => r.cycle_id === selectedCycle)
                                        .map(r => r.employee_id);
                                    const availableEmployees = allEmployees.filter(
                                        e => !existingEmployeeIds.includes(e.id)
                                    );

                                    if (availableEmployees.length === 0) {
                                        return (
                                            <div className="text-center py-8">
                                                <CheckCircle className="w-10 h-10 mx-auto text-green-300 mb-2" />
                                                <p className="text-sm text-slate-500">
                                                    Tất cả nhân viên đã được thêm vào chu kỳ này
                                                </p>
                                            </div>
                                        );
                                    }

                                    return (
                                        <div className="space-y-2">
                                            <label className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedEmployeeIds.length === availableEmployees.length}
                                                    onChange={(e) => {
                                                        if (e.target.checked) {
                                                            setSelectedEmployeeIds(availableEmployees.map(emp => emp.id));
                                                        } else {
                                                            setSelectedEmployeeIds([]);
                                                        }
                                                    }}
                                                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                                />
                                                <span className="text-sm font-medium text-slate-700">
                                                    Chọn tất cả ({availableEmployees.length})
                                                </span>
                                            </label>
                                            <div className="border-t border-slate-100 pt-2">
                                                {availableEmployees.map((employee) => (
                                                    <label
                                                        key={employee.id}
                                                        className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 cursor-pointer"
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedEmployeeIds.includes(employee.id)}
                                                            onChange={(e) => {
                                                                if (e.target.checked) {
                                                                    setSelectedEmployeeIds([...selectedEmployeeIds, employee.id]);
                                                                } else {
                                                                    setSelectedEmployeeIds(selectedEmployeeIds.filter(id => id !== employee.id));
                                                                }
                                                            }}
                                                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                                        />
                                                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-xs font-bold">
                                                            {employee.name?.split(' ').map(n => n[0]).slice(-2).join('')}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="font-medium text-slate-900 text-sm">{employee.name}</p>
                                                            <p className="text-xs text-slate-500">{employee.position} · {employee.department}</p>
                                                        </div>
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>

                            <div className="p-4 border-t border-slate-200 flex gap-3 justify-end">
                                <button
                                    onClick={() => setShowAddEmployeesModal(false)}
                                    className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                                >
                                    Hủy
                                </button>
                                <button
                                    onClick={handleAddEmployees}
                                    disabled={isAddingEmployees || selectedEmployeeIds.length === 0}
                                    className="px-4 py-2 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                                >
                                    {isAddingEmployees ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Đang thêm...
                                        </>
                                    ) : (
                                        <>
                                            <Plus className="w-4 h-4" />
                                            Thêm {selectedEmployeeIds.length > 0 ? `(${selectedEmployeeIds.length})` : ''}
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Review Form Modal */}
            {
                showReviewForm && selectedReview && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center">
                        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowReviewForm(false)} />
                        <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col overflow-hidden animate-scale-in">
                            <div className="p-6 border-b border-slate-200">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                        <Star className="w-5 h-5 text-amber-500" />
                                        Đánh giá: {selectedReview.employee?.name}
                                    </h3>
                                    <button onClick={() => setShowReviewForm(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                                <p className="text-sm text-slate-500 mt-1">
                                    {selectedReview.employee?.position} · {selectedReview.employee?.department}
                                </p>
                            </div>

                            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                                {/* Criteria Scores */}
                                <div>
                                    <div className="flex items-center justify-between mb-4">
                                        <h4 className="font-medium text-slate-900">Chấm điểm theo tiêu chí (1-100)</h4>
                                        {Object.keys(reviewScores).length > 0 && (
                                            <div className="text-sm text-slate-600">
                                                Điểm TB: <span className="font-bold text-blue-600 text-lg">
                                                    {(Object.values(reviewScores).reduce((a, b) => a + b, 0) / Object.values(reviewScores).length).toFixed(1)}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                    <div className="space-y-3">
                                        {criteria.map((crit) => (
                                            <div key={crit.id} className="bg-slate-50 rounded-xl p-4">
                                                <div className="flex items-center justify-between gap-4">
                                                    <div className="flex-1">
                                                        <span className="font-medium text-slate-700">{crit.name}</span>
                                                        <span className="text-xs text-slate-400 ml-2">x{crit.weight}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            max="100"
                                                            value={reviewScores[crit.id] || ''}
                                                            onChange={(e) => {
                                                                const val = parseInt(e.target.value) || 0;
                                                                const capped = Math.min(100, Math.max(1, val));
                                                                setReviewScores({ ...reviewScores, [crit.id]: capped });
                                                            }}
                                                            placeholder="1-100"
                                                            className="w-20 px-3 py-2 text-center border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent font-medium"
                                                        />
                                                        <span className="text-slate-400 text-sm">điểm</span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Comments */}
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Điểm mạnh</label>
                                        <textarea
                                            value={reviewComments.strengths}
                                            onChange={(e) => setReviewComments({ ...reviewComments, strengths: e.target.value })}
                                            rows={2}
                                            placeholder="Nhập điểm mạnh của nhân viên..."
                                            className="w-full px-4 py-2.5 border border-slate-200 rounded-xl resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Cần cải thiện</label>
                                        <textarea
                                            value={reviewComments.improvements}
                                            onChange={(e) => setReviewComments({ ...reviewComments, improvements: e.target.value })}
                                            rows={2}
                                            placeholder="Những điểm cần cải thiện..."
                                            className="w-full px-4 py-2.5 border border-slate-200 rounded-xl resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Mục tiêu phát triển</label>
                                        <textarea
                                            value={reviewComments.goals}
                                            onChange={(e) => setReviewComments({ ...reviewComments, goals: e.target.value })}
                                            rows={2}
                                            placeholder="Mục tiêu cho kỳ tiếp theo..."
                                            className="w-full px-4 py-2.5 border border-slate-200 rounded-xl resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="p-4 border-t border-slate-200 flex gap-3 justify-end">
                                <button onClick={() => setShowReviewForm(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl">
                                    Hủy
                                </button>
                                <button
                                    onClick={handleSaveReview}
                                    disabled={isSavingReview || Object.keys(reviewScores).length === 0}
                                    className="px-4 py-2 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                                >
                                    {isSavingReview ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                    Lưu đánh giá
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Criteria Management Modal */}
            {
                showCriteriaModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center">
                        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowCriteriaModal(false)} />
                        <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-scale-in">
                            <div className="p-6 border-b border-slate-200">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-lg font-bold text-slate-900">
                                        {editingCriteria ? 'Sửa tiêu chí' : 'Thêm tiêu chí mới'}
                                    </h3>
                                    <button onClick={() => setShowCriteriaModal(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>

                            <div className="p-6 space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Tên tiêu chí *</label>
                                    <input
                                        type="text"
                                        value={criteriaForm.name}
                                        onChange={(e) => setCriteriaForm({ ...criteriaForm, name: e.target.value })}
                                        placeholder="VD: Đúng giờ, Chất lượng công việc..."
                                        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Nhóm</label>
                                    <select
                                        value={criteriaForm.category}
                                        onChange={(e) => setCriteriaForm({ ...criteriaForm, category: e.target.value })}
                                        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    >
                                        {categories.map((cat) => (
                                            <option key={cat.key} value={cat.key}>{cat.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Trọng số (x)</label>
                                    <input
                                        type="number"
                                        min="0.5"
                                        max="3"
                                        step="0.5"
                                        value={criteriaForm.weight}
                                        onChange={(e) => setCriteriaForm({ ...criteriaForm, weight: parseFloat(e.target.value) || 1 })}
                                        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Mô tả</label>
                                    <textarea
                                        value={criteriaForm.description}
                                        onChange={(e) => setCriteriaForm({ ...criteriaForm, description: e.target.value })}
                                        rows={2}
                                        placeholder="Mô tả tiêu chí..."
                                        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Áp dụng cho phòng ban</label>
                                    <select
                                        value={criteriaForm.department}
                                        onChange={(e) => setCriteriaForm({ ...criteriaForm, department: e.target.value })}
                                        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    >
                                        <option value="">Tất cả phòng ban</option>
                                        <option value="Kỹ thuật">Kỹ thuật</option>
                                        <option value="Nhân sự">Nhân sự</option>
                                        <option value="Kinh doanh">Kinh doanh</option>
                                        <option value="Kế toán">Kế toán</option>
                                        <option value="Marketing">Marketing</option>
                                        <option value="Ban giám đốc">Ban giám đốc</option>
                                        <option value="Hành chính">Hành chính</option>
                                    </select>
                                    <p className="text-xs text-slate-400 mt-1">Để trống = áp dụng cho tất cả</p>
                                </div>
                            </div>

                            <div className="p-4 border-t border-slate-200 flex gap-3 justify-end">
                                <button onClick={() => setShowCriteriaModal(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl">
                                    Hủy
                                </button>
                                <button
                                    onClick={handleSaveCriteria}
                                    disabled={isSavingCriteria || !criteriaForm.name}
                                    className="px-4 py-2 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                                >
                                    {isSavingCriteria ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                    {editingCriteria ? 'Cập nhật' : 'Thêm mới'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

            {/* Category Management Modal */}
            {showCategoryModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowCategoryModal(false)} />
                    <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-scale-in">
                        <div className="p-6 border-b border-slate-200">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold text-slate-900">
                                    Quản lý nhóm tiêu chí
                                </h3>
                                <button onClick={() => setShowCategoryModal(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        <div className="p-6 space-y-4">
                            {/* List existing categories */}
                            <div className="space-y-2">
                                {categories.map((cat) => (
                                    <div key={cat.key} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl group">
                                        <span className="font-medium text-slate-700">{cat.label}</span>
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                                            <button
                                                onClick={() => openEditCategory(cat)}
                                                className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                                            >
                                                <Pencil className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleDeleteCategory(cat.key)}
                                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Add new category form */}
                            <div className="border-t border-slate-200 pt-4">
                                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                    {editingCategory ? 'Sửa tên nhóm' : 'Thêm nhóm mới'}
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={categoryForm.label}
                                        onChange={(e) => setCategoryForm({ ...categoryForm, label: e.target.value })}
                                        placeholder="VD: Kỹ năng giao tiếp..."
                                        className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    />
                                    <button
                                        onClick={handleSaveCategory}
                                        disabled={!categoryForm.label}
                                        className="px-4 py-2.5 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                                    >
                                        <Plus className="w-4 h-4" />
                                        {editingCategory ? 'Lưu' : 'Thêm'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Criteria Confirmation */}
            <ConfirmDialog
                open={confirmDeleteCriteria.open}
                onOpenChange={(open) => setConfirmDeleteCriteria({ ...confirmDeleteCriteria, open })}
                title="Xóa tiêu chí?"
                description="Bạn có chắc muốn xóa tiêu chí này? Hành động này không thể hoàn tác."
                confirmText="Xóa"
                cancelText="Hủy"
                variant="destructive"
                onConfirm={confirmDeleteCriteriaAction}
            />

            {/* Delete Category Confirmation */}
            <ConfirmDialog
                open={confirmDeleteCategory.open}
                onOpenChange={(open) => setConfirmDeleteCategory({ ...confirmDeleteCategory, open })}
                title="Xóa nhóm tiêu chí?"
                description="Các tiêu chí trong nhóm vẫn giữ nguyên. Hành động này không thể hoàn tác."
                confirmText="Xóa"
                cancelText="Hủy"
                variant="destructive"
                onConfirm={confirmDeleteCategoryAction}
            />
        </div>
    );
}
