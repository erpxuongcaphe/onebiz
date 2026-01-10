"use client";

import { useState, useEffect } from "react";
import { Plus, Edit, Trash2, X, Check, Loader2, Building2, Briefcase } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
    getDepartments,
    createDepartment,
    updateDepartment,
    deleteDepartment,
    getPositions,
    createPosition,
    updatePosition,
    deletePosition,
    Department,
    Position
} from "@/lib/api/categories";

type Tab = 'departments' | 'positions';

export default function CategoriesPage() {
    const [activeTab, setActiveTab] = useState<Tab>('departments');
    const [departments, setDepartments] = useState<Department[]>([]);
    const [positions, setPositions] = useState<Position[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [newItemName, setNewItemName] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; id: string; name: string; type: string }>({ open: false, id: '', name: '', type: '' });

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setIsLoading(true);
        try {
            const [depts, pos] = await Promise.all([getDepartments(), getPositions()]);
            setDepartments(depts);
            setPositions(pos);
        } catch (err) {
            console.error('Failed to fetch categories:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleAdd = async () => {
        if (!newItemName.trim()) return;
        setIsSaving(true);
        try {
            if (activeTab === 'departments') {
                await createDepartment(newItemName.trim());
            } else {
                await createPosition(newItemName.trim());
            }
            await fetchData();
            setNewItemName('');
            setIsAdding(false);
        } catch (err) {
            console.error('Failed to add item:', err);
            alert('Lỗi khi thêm mục. Vui lòng thử lại.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleEdit = async (id: string) => {
        if (!editValue.trim()) return;
        setIsSaving(true);
        try {
            if (activeTab === 'departments') {
                await updateDepartment(id, { name: editValue.trim() });
            } else {
                await updatePosition(id, { name: editValue.trim() });
            }
            await fetchData();
            setEditingId(null);
            setEditValue('');
        } catch (err) {
            console.error('Failed to update item:', err);
            alert('Lỗi khi cập nhật. Vui lòng thử lại.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = (id: string, name: string) => {
        setConfirmDelete({
            open: true,
            id,
            name,
            type: activeTab === 'departments' ? 'phòng ban' : 'chức vụ'
        });
    };

    const confirmDeleteAction = async () => {
        if (!confirmDelete.id) return;
        try {
            if (activeTab === 'departments') {
                await deleteDepartment(confirmDelete.id);
            } else {
                await deletePosition(confirmDelete.id);
            }
            toast.success(`Đã xóa ${confirmDelete.type}`);
            await fetchData();
            setConfirmDelete({ open: false, id: '', name: '', type: '' });
        } catch (err: unknown) {
            console.error('Failed to delete item:', err);
            const errorMsg = err instanceof Error ? err.message : 'Lỗi không xác định';
            toast.error(`Lỗi khi xóa ${confirmDelete.type}`, {
                description: errorMsg
            });
        }
    };

    const startEdit = (id: string, currentName: string) => {
        setEditingId(id);
        setEditValue(currentName);
    };

    const items = activeTab === 'departments' ? departments : positions;

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-96">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                <span className="ml-2 text-slate-600">Đang tải dữ liệu...</span>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="animate-fade-in">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">Quản lý danh mục</h1>
                <p className="text-slate-500 mt-1">Cấu hình phòng ban và chức vụ trong hệ thống</p>
            </div>

            {/* Content Card */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-slide-up">
                {/* Tabs */}
                <div className="flex border-b border-slate-200">
                    <button
                        onClick={() => { setActiveTab('departments'); setIsAdding(false); setEditingId(null); }}
                        className={cn(
                            "flex-1 flex items-center justify-center gap-2 py-4 text-sm font-medium transition-colors",
                            activeTab === 'departments'
                                ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50"
                                : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                        )}
                    >
                        <Building2 className="w-4 h-4" />
                        Phòng ban ({departments.length})
                    </button>
                    <button
                        onClick={() => { setActiveTab('positions'); setIsAdding(false); setEditingId(null); }}
                        className={cn(
                            "flex-1 flex items-center justify-center gap-2 py-4 text-sm font-medium transition-colors",
                            activeTab === 'positions'
                                ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50"
                                : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                        )}
                    >
                        <Briefcase className="w-4 h-4" />
                        Chức vụ ({positions.length})
                    </button>
                </div>

                {/* Add New Button */}
                <div className="p-4 border-b border-slate-100 bg-slate-50/50">
                    {isAdding ? (
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={newItemName}
                                onChange={(e) => setNewItemName(e.target.value)}
                                placeholder={activeTab === 'departments' ? 'Tên phòng ban mới...' : 'Tên chức vụ mới...'}
                                className="flex-1 px-4 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                autoFocus
                                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                            />
                            <button
                                onClick={handleAdd}
                                disabled={isSaving || !newItemName.trim()}
                                className="p-2 text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 transition-colors"
                            >
                                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            </button>
                            <button
                                onClick={() => { setIsAdding(false); setNewItemName(''); }}
                                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={() => setIsAdding(true)}
                            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                            Thêm {activeTab === 'departments' ? 'phòng ban' : 'chức vụ'}
                        </button>
                    )}
                </div>

                {/* List */}
                <div className="divide-y divide-slate-100">
                    {items.length === 0 ? (
                        <div className="p-8 text-center text-slate-500">
                            Chưa có {activeTab === 'departments' ? 'phòng ban' : 'chức vụ'} nào.
                        </div>
                    ) : (
                        items.map((item) => (
                            <div
                                key={item.id}
                                className="group flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors"
                            >
                                {editingId === item.id ? (
                                    <div className="flex-1 flex items-center gap-2">
                                        <input
                                            type="text"
                                            value={editValue}
                                            onChange={(e) => setEditValue(e.target.value)}
                                            className="flex-1 px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                            autoFocus
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleEdit(item.id);
                                                if (e.key === 'Escape') { setEditingId(null); setEditValue(''); }
                                            }}
                                        />
                                        <button
                                            onClick={() => handleEdit(item.id)}
                                            disabled={isSaving}
                                            className="p-1.5 text-green-600 hover:bg-green-50 rounded-md transition-colors"
                                        >
                                            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                        </button>
                                        <button
                                            onClick={() => { setEditingId(null); setEditValue(''); }}
                                            className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-md transition-colors"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <span className="text-sm text-slate-700">{item.name}</span>
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => startEdit(item.id, item.name)}
                                                className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-md transition-colors"
                                            >
                                                <Edit className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(item.id, item.name)}
                                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Delete Category Confirmation */}
            <ConfirmDialog
                open={confirmDelete.open}
                onOpenChange={(open) => setConfirmDelete({ ...confirmDelete, open })}
                title={'Xóa ' + confirmDelete.type + '?'}
                description={'Bạn sẽ xóa ' + confirmDelete.type + ' "' + confirmDelete.name + '". Hành động này không thể hoàn tác.'}
                confirmText="Xóa"
                cancelText="Hủy"
                variant="destructive"
                onConfirm={confirmDeleteAction}
            />
        </div>
    );
}
