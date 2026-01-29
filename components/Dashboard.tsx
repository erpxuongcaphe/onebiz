import React, { useEffect, useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import { ArrowUpRight, ArrowDownRight, DollarSign, Wallet, PiggyBank, Receipt, TrendingUp, Users, Store, BarChart2, Briefcase, ChevronRight, Clock, AlertTriangle, CheckCircle2, PackagePlus, FileText, Plus, ArrowRight } from 'lucide-react';
import { REVENUE_DATA, CATEGORY_DATA, formatCurrency } from '../constants';
import { Activity } from '../types';
import { fetchDashboardOverview } from '../lib/dashboard';
import { useTenant } from '../lib/tenantContext';
import { getPosBaseUrl } from '../lib/posUrl';

const KPICard = ({ title, value, change, trend, icon: Icon, variant = 'default' }: any) => {
    const isPrimary = variant === 'primary';

    // High contrast logic for the badge
    const badgeStyle = isPrimary
        ? (trend === 'up'
            ? 'bg-white shadow-sm text-emerald-600 ring-1 ring-black/5' // Primary Card + UP: White BG, Green Text
            : 'bg-white shadow-sm text-rose-600 ring-1 ring-black/5')   // Primary Card + DOWN: White BG, Red Text
        : (trend === 'up'
            ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' // Default Card + UP
            : 'bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400');           // Default Card + DOWN

    return (
        <div className={`
      relative overflow-hidden rounded-lg transition-all duration-300 group
      ${isPrimary
                ? 'bg-gradient-to-br from-indigo-600 to-violet-700 text-white shadow-lg shadow-indigo-500/30 ring-1 ring-white/10'
                : 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-soft border border-slate-200 dark:border-slate-800'
            }
    `}>
            <div className="p-2.5"> {/* Super compact padding */}
                <div className="flex items-start justify-between">
                    <div className={`p-1 rounded-md transition-colors ${isPrimary ? 'bg-white/10 text-white' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400'}`}>
                        <Icon className="w-3 h-3" />
                    </div>
                    <div className={`
            flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full backdrop-blur-sm
            ${badgeStyle}
          `}>
                        {trend === 'up' ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
                        <span>{change}</span>
                    </div>
                </div>

                <div className="mt-2">
                    <p className={`text-[9px] font-medium uppercase tracking-wider opacity-90 ${isPrimary ? 'text-indigo-50' : 'text-slate-500 dark:text-slate-400'}`}>{title}</p>
                    <h3 className="text-sm lg:text-lg font-bold mt-0.5 tracking-tight leading-none">{value}</h3>
                </div>
            </div>
        </div>
    );
};

// New Compact Quick Action Button
const QuickAction = ({ icon: Icon, title, colorClass, onClick }: any) => (
    <button
        onClick={onClick}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-700 transition-all group shrink-0"
    >
        <div className={`p-1 rounded-full ${colorClass} group-hover:scale-110 transition-transform`}>
            <Icon className="w-3 h-3" />
        </div>
        <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors whitespace-nowrap">{title}</span>
    </button>
);

const ActivityItem: React.FC<{ activity: Activity }> = ({ activity }) => {
    let icon, color;
    switch (activity.type) {
        case 'order': icon = FileText; color = 'text-blue-600 bg-blue-50 dark:bg-blue-900/20'; break;
        case 'inventory': icon = PackagePlus; color = 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20'; break;
        case 'warning': icon = AlertTriangle; color = 'text-amber-600 bg-amber-50 dark:bg-amber-900/20'; break;
        default: icon = CheckCircle2; color = 'text-slate-600 bg-slate-50 dark:bg-slate-800';
    }
    const Icon = icon;

    return (
        <div className="flex gap-2 py-1.5 items-center border-b border-slate-50 dark:border-slate-800/50 last:border-0">
            <div className={`p-1 rounded-md shrink-0 ${color}`}>
                <Icon className="w-3 h-3" />
            </div>
            <div className="min-w-0 flex-1">
                <p className="text-[10px] text-slate-900 dark:text-slate-200 line-clamp-1">
                    <span className="font-semibold">{activity.user}</span> {activity.action}
                </p>
                <p className="text-[9px] text-slate-500 flex items-center gap-1 leading-none mt-0.5">
                    {activity.target} • {activity.time}
                </p>
            </div>
        </div>
    );
};

const Dashboard: React.FC = () => {
    const { tenant } = useTenant();
    const posUrl = useMemo(() => getPosBaseUrl({ tenant, hostname: window.location.hostname }), [tenant]);
    const [overview, setOverview] = useState<null | {
        revenue7d: number;
        revenueChange: string;
        revenueTrend: 'up' | 'down';
        profit7d: number;
        profitChange: string;
        profitTrend: 'up' | 'down';
        cash7d: number;
        cashChange: string;
        cashTrend: 'up' | 'down';
        debt: number;
        debtChange: string;
        debtTrend: 'up' | 'down';
        series7d: Array<{ name: string; value: number }>;
    }>(null);

    useEffect(() => {
        let isMounted = true;
        fetchDashboardOverview().then((res) => {
            if (!isMounted) return;
            if (!res) return;
            setOverview(res);
        });
        return () => {
            isMounted = false;
        };
    }, []);

    const revenueValue = overview ? formatCurrency(overview.revenue7d) : formatCurrency(0);
    const profitValue = overview ? formatCurrency(overview.profit7d) : formatCurrency(0);
    const cashValue = overview ? formatCurrency(overview.cash7d) : formatCurrency(0);
    const debtValue = overview ? formatCurrency(overview.debt) : formatCurrency(0);
    const series = overview?.series7d ?? [];

    return (
        <div className="space-y-3 lg:space-y-4 animate-fade-in pb-8">

            {/* Header & Quick Actions Row */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                    <h1 className="text-sm lg:text-base font-bold text-slate-900 dark:text-white">Tổng quan</h1>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">Chào mừng trở lại, Admin!</p>
                </div>

                {/* Compact Toolbar - Replaces the Grid */}
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 sm:pb-0">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider hidden sm:block mr-1">Truy cập nhanh:</span>
                    <QuickAction
                        icon={Users}
                        title="Nhân sự"
                        colorClass="bg-cyan-100 text-cyan-600 dark:bg-cyan-900/40 dark:text-cyan-400"
                        onClick={() => console.log('Nav to HR')}
                    />
                    <QuickAction
                        icon={Store}
                        title="Bán lẻ POS"
                        colorClass="bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400"
                        onClick={() => window.open(posUrl, '_blank', 'noopener,noreferrer')}
                    />
                    <QuickAction
                        icon={BarChart2}
                        title="Báo cáo"
                        colorClass="bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400"
                        onClick={() => console.log('Nav to Reports')}
                    />
                    <button className="flex items-center justify-center w-7 h-7 rounded-md border border-dashed border-slate-300 dark:border-slate-700 hover:border-indigo-400 hover:text-indigo-500 text-slate-400 transition-colors shrink-0">
                        <Plus className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {/* Row 2: KPIs & Main Chart */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-2 lg:gap-3">

                {/* Left: KPI Column - Grid 2 cols on mobile */}
                <div className="lg:col-span-1 grid grid-cols-2 lg:grid-cols-1 gap-2 content-start">
                    <KPICard
                        title="Doanh thu"
                        value={revenueValue}
                        change={overview?.revenueChange ?? '+12.5%'}
                        trend={overview?.revenueTrend ?? 'up'}
                        icon={DollarSign}
                        variant="primary"
                    />
                    <KPICard
                        title="Lợi nhuận"
                        value={profitValue}
                        change={overview?.profitChange ?? '+8.4%'}
                        trend={overview?.profitTrend ?? 'up'}
                        icon={PiggyBank}
                    />
                    <KPICard
                        title="Tiền mặt"
                        value={cashValue}
                        change={overview?.cashChange ?? '+5.1%'}
                        trend={overview?.cashTrend ?? 'up'}
                        icon={Wallet}
                    />
                    <KPICard
                        title="Công nợ"
                        value={debtValue}
                        change={overview?.debtChange ?? '+2.4%'}
                        trend={overview?.debtTrend ?? 'down'}
                        icon={Receipt}
                    />
                </div>

                {/* Right: Main Chart */}
                <div className="lg:col-span-3 bg-white dark:bg-slate-900 p-2.5 lg:p-4 rounded-lg shadow-soft border border-slate-200 dark:border-slate-800 flex flex-col">
                    <div className="flex items-center justify-between mb-1">
                        <div>
                            <h3 className="text-[11px] lg:text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                                <TrendingUp className="w-3 h-3 text-indigo-500" />
                                Dòng tiền (7 ngày)
                            </h3>
                        </div>
                        <select className="bg-slate-50 dark:bg-slate-800 border-none text-[9px] font-medium text-slate-600 dark:text-slate-300 rounded-md py-0.5 px-1.5 focus:ring-0 cursor-pointer">
                            <option>Tuần này</option>
                            <option>Tháng này</option>
                        </select>
                    </div>
                    <div className="flex-1 w-full min-h-[180px] lg:min-h-0"> {/* Adjusted height since we saved space from shortcuts */}
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={series} margin={{ top: 5, right: 0, left: -25, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" strokeOpacity={0.5} />
                                <XAxis
                                    dataKey="name"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#64748b', fontSize: 9 }}
                                    dy={5}
                                />
                                <YAxis
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#64748b', fontSize: 9 }}
                                    tickFormatter={(value) => `${value / 1000000}M`}
                                />
                                <Tooltip
                                    contentStyle={{
                                        borderRadius: '6px',
                                        border: 'none',
                                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                                        backgroundColor: 'rgba(255, 255, 255, 0.95)',
                                        padding: '4px 8px',
                                        fontSize: '11px'
                                    }}
                                    itemStyle={{ color: '#1e293b', fontWeight: 600 }}
                                    formatter={(value: number) => [formatCurrency(value), '']}
                                />
                                <Area type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#colorValue)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Row 3: Secondary Info */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 lg:gap-3">

                {/* Column 1: Sources */}
                <div className="bg-white dark:bg-slate-900 p-2.5 rounded-lg shadow-soft border border-slate-200 dark:border-slate-800">
                    <h3 className="text-[11px] font-bold text-slate-900 dark:text-white mb-2">Cơ cấu doanh thu</h3>
                    <div className="h-20 w-full mb-2"> {/* Tiny bar chart */}
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={CATEGORY_DATA} layout="vertical" barSize={6} barGap={1}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#e2e8f0" strokeOpacity={0.5} />
                                <XAxis type="number" hide />
                                <YAxis
                                    dataKey="name"
                                    type="category"
                                    width={55}
                                    tick={{ fill: '#64748b', fontSize: 9, fontWeight: 500 }}
                                    axisLine={false}
                                    tickLine={false}
                                />
                                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                                    {CATEGORY_DATA.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e'][index % 4]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {CATEGORY_DATA.map((item, idx) => (
                            <div key={idx} className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-slate-50 dark:bg-slate-800">
                                <span className={`w-1.5 h-1.5 rounded-full`} style={{ backgroundColor: ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e'][idx % 4] }}></span>
                                <span className="text-slate-600 dark:text-slate-400">{item.name}</span>
                                <span className="font-bold text-slate-900 dark:text-white ml-auto">{item.value}%</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Column 2: Pending Tasks */}
                <div className="bg-white dark:bg-slate-900 p-2.5 rounded-lg shadow-soft border border-slate-200 dark:border-slate-800 flex flex-col">
                    <div className="flex justify-between items-center mb-2">
                        <h3 className="text-[11px] font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <Clock className="w-3 h-3 text-amber-500" />
                            Cần xử lý
                        </h3>
                        <span className="bg-amber-100 text-amber-700 text-[9px] font-bold px-1.5 py-0.5 rounded">3</span>
                    </div>
                    <div className="space-y-1.5 flex-1">
                        <div className="flex items-center justify-between p-1.5 bg-slate-50 dark:bg-slate-800/50 rounded-md border border-slate-100 dark:border-slate-800 hover:border-indigo-200 transition-colors cursor-pointer group">
                            <div className="flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div>
                                <div>
                                    <p className="text-[10px] font-medium text-slate-700 dark:text-slate-200">Đơn hàng #ORD-7784</p>
                                    <p className="text-[9px] text-slate-500 leading-none">Chờ xác nhận thanh toán</p>
                                </div>
                            </div>
                            <ChevronRight className="w-3 h-3 text-slate-300 group-hover:text-indigo-500" />
                        </div>
                        <div className="flex items-center justify-between p-1.5 bg-slate-50 dark:bg-slate-800/50 rounded-md border border-slate-100 dark:border-slate-800 hover:border-indigo-200 transition-colors cursor-pointer group">
                            <div className="flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-rose-500"></div>
                                <div>
                                    <p className="text-[10px] font-medium text-slate-700 dark:text-slate-200">Kho hàng thấp</p>
                                    <p className="text-[9px] text-slate-500 leading-none">2 sản phẩm dưới định mức</p>
                                </div>
                            </div>
                            <ChevronRight className="w-3 h-3 text-slate-300 group-hover:text-indigo-500" />
                        </div>
                    </div>
                </div>

                {/* Column 3: Activity Stream (Compact) */}
                <div className="bg-white dark:bg-slate-900 p-2.5 rounded-lg shadow-soft border border-slate-200 dark:border-slate-800 flex flex-col">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-[11px] font-bold text-slate-900 dark:text-white">Hoạt động</h3>
                        <button className="text-[9px] text-indigo-600 dark:text-indigo-400 font-semibold hover:underline flex items-center gap-0.5">
                            Xem tất cả <ArrowRight className="w-2.5 h-2.5" />
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto max-h-[140px] pr-1 custom-scrollbar">
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 text-center py-4">
                            Chưa có hoạt động gần đây.
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
