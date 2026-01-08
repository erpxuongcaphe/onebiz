-- Create system_configs table
create table if not exists public.system_configs (
    key text primary key,
    value jsonb not null,
    description text,
    group_name text, -- 'payroll', 'system', 'attendance'
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_by uuid references auth.users(id)
);

-- Enable RLS
alter table public.system_configs enable row level security;

-- Policies
create policy "Enable read access for all authenticated users" on public.system_configs
    for select
    using (auth.role() = 'authenticated');

create policy "Enable write access for admins and accountants" on public.system_configs
    for all
    using (
        exists (
            select 1 from public.users
            where users.id = auth.uid()::text
            and users.role in ('admin', 'accountant')
        )
    );

-- Seed Data for Payroll
insert into public.system_configs (key, value, description, group_name)
values 
    ('payroll.tax.personal_deduction', '11000000', 'Mức giảm trừ gia cảnh bản thân (VND)', 'payroll'),
    ('payroll.tax.dependent_deduction', '4400000', 'Mức giảm trừ người phụ thuộc (VND)', 'payroll'),
    ('payroll.insurance.employee_rate', '0.105', 'Tỷ lệ đóng BHXH người lao động (10.5%)', 'payroll'),
    ('payroll.insurance.employer_rate', '0.215', 'Tỷ lệ đóng BHXH người sử dụng lao động (21.5%)', 'payroll'),
    ('payroll.ot.weekday_multiplier', '1.5', 'Hệ số lương OT ngày thường', 'payroll'),
    ('payroll.ot.weekend_multiplier', '2.0', 'Hệ số lương OT ngày cuối tuần', 'payroll'),
    ('payroll.ot.holiday_multiplier', '3.0', 'Hệ số lương OT ngày lễ', 'payroll')
on conflict (key) do update 
set value = excluded.value, description = excluded.description;
