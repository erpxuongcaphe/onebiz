import React, { useEffect, useState } from 'react';
import { Search, Filter, Plus, Phone, Mail } from 'lucide-react';
import { formatCurrency } from '../constants';
import { fetchCustomers } from '../lib/sales';

const MOCK_CUSTOMERS = [
  { id: 'CUST-001', name: 'Công ty TNHH XYZ', email: 'contact@xyz.vn', phone: '0901 234 567', debt: 12500000, status: 'Đang giao dịch' },
  { id: 'CUST-002', name: 'Nguyễn Văn A', email: 'nva@gmail.com', phone: '0987 222 111', debt: 0, status: 'Bình thường' },
  { id: 'CUST-003', name: 'Trần Thị B', email: 'ttb@gmail.com', phone: '0933 888 555', debt: 5400000, status: 'Cần thu' },
  { id: 'CUST-004', name: 'Công ty CP Hòa Bình', email: 'sales@hoabinh.vn', phone: '0912 555 999', debt: 98000000, status: 'Công nợ cao' },
];

const Customers: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [rows, setRows] = useState<typeof MOCK_CUSTOMERS | null>(null);

  useEffect(() => {
    let isMounted = true;
    fetchCustomers().then((data) => {
      if (!isMounted) return;
      if (data.length === 0) {
        setRows(MOCK_CUSTOMERS);
        return;
      }
      // Map DB customers to the current UI shape (debt is a placeholder until AR/AP tables exist)
      setRows(
        data.map((c) => ({
          id: c.code,
          name: c.name,
          email: c.email ?? '-',
          phone: c.phone ?? '-',
          debt: 0,
          status: c.status === 'active' ? 'Bình thường' : c.status === 'blocked' ? 'Bị khóa' : c.status,
        }))
      );
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const list = rows ?? [];
  const filtered = list.filter((c) =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const statusStyle = (status: string) => {
    if (status === 'Công nợ cao') return 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400';
    if (status === 'Cần thu') return 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400';
    return 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400';
  };

  return (
    <div className="space-y-3 lg:space-y-5 animate-fade-in pb-10">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-lg lg:text-xl font-bold text-slate-900 dark:text-white">Khách hàng</h1>
          <p className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">Quản lý hồ sơ và công nợ khách hàng.</p>
        </div>
        <button className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-sm">
          <Plus className="w-3.5 h-3.5" />
          Thêm khách hàng
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-soft border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="p-2 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row gap-2 justify-between items-center">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Tìm theo mã, tên..."
              className="w-full pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white transition-all placeholder:text-slate-400"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
            <Filter className="w-3 h-3" />
            Lọc
          </button>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows === null && (
            <div className="px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400">Đang tải dữ liệu...</div>
          )}
          {rows !== null && filtered.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400">Không có dữ liệu.</div>
          )}
          {filtered.map((customer) => (
            <div key={customer.id} className="px-3 py-2 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-slate-900 dark:text-slate-200 truncate">{customer.name}</p>
                <p className="text-[9px] text-slate-500 dark:text-slate-400 mt-0.5">{customer.id}</p>
                <div className="flex items-center gap-3 text-[9px] text-slate-400 mt-1">
                  <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{customer.email}</span>
                  <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{customer.phone}</span>
                </div>
              </div>
              <div className="text-right">
                <div className={`inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[10px] font-bold ${statusStyle(customer.status)}`}>
                  {customer.status}
                </div>
                <div className={`mt-1 text-[11px] font-bold tabular-nums ${customer.debt > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                  {customer.debt > 0 ? `-${formatCurrency(customer.debt)}` : formatCurrency(0)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Customers;
