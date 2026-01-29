import React, { useEffect, useState } from 'react';
import { BarChart3, PieChart, TrendingUp, Calendar, Download, Filter, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { formatCurrency } from '../constants';
import { fetchReportsOverview, type ReportRow } from '../lib/reports';

type KPIProps = {
  title: string;
  value: string;
  change: string;
  trend: 'up' | 'down';
  icon: LucideIcon;
};

const KPI: React.FC<KPIProps> = ({ title, value, change, trend, icon: Icon }) => {
  const trendStyle = trend === 'up'
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-rose-600 dark:text-rose-400';

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow-soft border border-slate-200 dark:border-slate-800 p-2.5">
      <div className="flex items-start justify-between">
        <div className="p-1 rounded-md bg-slate-50 dark:bg-slate-800 text-slate-500">
          <Icon className="w-3.5 h-3.5" />
        </div>
        <div className={`text-[9px] font-bold flex items-center gap-0.5 ${trendStyle}`}>
          {trend === 'up' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          {change}
        </div>
      </div>
      <div className="mt-2">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">{title}</p>
        <p className="text-sm lg:text-base font-bold text-slate-900 dark:text-white mt-0.5 tabular-nums">{value}</p>
      </div>
    </div>
  );
};



const Reports: React.FC = () => {
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [kpis, setKpis] = useState<{ revenue: number; profit: number; debt: number; expense: number; changeRevenue: string; changeExpense: string } | null>(null);

  const [timePreset, setTimePreset] = useState<'this_month' | 'last_month' | 'range'>('this_month');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  useEffect(() => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = now.getMonth();

    const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    if (timePreset === 'this_month') {
      const start = new Date(yyyy, mm, 1);
      const end = new Date(yyyy, mm + 1, 0);
      setFromDate(toIso(start));
      setToDate(toIso(end));
    } else if (timePreset === 'last_month') {
      const start = new Date(yyyy, mm - 1, 1);
      const end = new Date(yyyy, mm, 0);
      setFromDate(toIso(start));
      setToDate(toIso(end));
    }
  }, [timePreset]);

  useEffect(() => {
    if (!fromDate || !toDate) return;
    let isMounted = true;
    setRows(null); // Show loading
    fetchReportsOverview(fromDate, toDate).then((res) => {
      if (!isMounted) return;
      if (!res) {
        setRows([]);
        setKpis({
          revenue: 0,
          profit: 0,
          debt: 0,
          expense: 0,
          changeRevenue: '0%',
          changeExpense: '0%',
        });
        return;
      }
      setRows(res.rows);
      setKpis(res.kpis);
    });
    return () => {
      isMounted = false;
    };
  }, [fromDate, toDate]);

  const revenueKpi = kpis?.revenue ?? 0;
  const profitKpi = kpis?.profit ?? 0;
  const debtKpi = kpis?.debt ?? 0;
  const expenseKpi = kpis?.expense ?? 0;

  return (
    <div className="space-y-3 lg:space-y-5 animate-fade-in pb-10">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-lg lg:text-xl font-bold text-slate-900 dark:text-white">Báo cáo</h1>
          <p className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">Tổng hợp hiệu quả kinh doanh theo kỳ.</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto overflow-x-auto no-scrollbar">
          <select
            value={timePreset}
            onChange={(e) => setTimePreset(e.target.value as any)}
            className="px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 focus:outline-none"
          >
            <option value="this_month">Tháng này</option>
            <option value="last_month">Tháng trước</option>
            <option value="range">Tùy chọn</option>
          </select>
          {timePreset === 'range' && (
            <>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="px-2 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-700 dark:text-slate-200"
              />
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="px-2 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-700 dark:text-slate-200"
              />
            </>
          )}
          <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm shrink-0">
            <Download className="w-3.5 h-3.5" />
            Xuất báo cáo
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <KPI title="Doanh thu" value={formatCurrency(revenueKpi)} change={kpis?.changeRevenue ?? '+0%'} trend={(kpis?.revenue ?? 0) >= 0 ? 'up' : 'down'} icon={TrendingUp} />
        <KPI title="Lợi nhuận (ước tính)" value={formatCurrency(profitKpi)} change="+0%" trend="up" icon={BarChart3} />
        <KPI title="Công nợ" value={formatCurrency(debtKpi)} change="0%" trend="down" icon={PieChart} />
        <KPI title="Chi phí" value={formatCurrency(expenseKpi)} change={kpis?.changeExpense ?? '+0%'} trend="up" icon={BarChart3} />
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-soft border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="p-2 border-b border-slate-100 dark:border-slate-800 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
          Danh sách báo cáo gần đây
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-700 text-[10px] lg:text-[11px]">
              <tr>
                <th className="px-2 py-2">Mã báo cáo</th>
                <th className="px-2 py-2">Tên báo cáo</th>
                <th className="px-2 py-2 hidden sm:table-cell">Loại</th>
                <th className="px-2 py-2 text-right">Tổng</th>
                <th className="px-2 py-2 text-right">Xu hướng</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows === null && (
                <tr>
                  <td className="px-2 py-2" colSpan={5}>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Đang tải dữ liệu...</div>
                  </td>
                </tr>
              )}
              {(rows ?? []).map((row) => (
                <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-2 py-2 text-indigo-600 dark:text-indigo-400 font-mono text-[10px] lg:text-[11px]">{row.id}</td>
                  <td className="px-2 py-2 font-semibold text-slate-900 dark:text-slate-200">{row.name}</td>
                  <td className="px-2 py-2 hidden sm:table-cell text-slate-600 dark:text-slate-400">{row.type}</td>
                  <td className="px-2 py-2 text-right font-bold text-slate-900 dark:text-slate-200 tabular-nums">{formatCurrency(row.total)}</td>
                  <td className={`px-2 py-2 text-right text-[10px] font-bold ${row.trend === 'up' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                    {row.change}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Reports;
