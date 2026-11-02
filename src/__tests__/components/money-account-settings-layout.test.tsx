import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
const state=vi.hoisted(()=>({path:'/cai-dat/tai-khoan-tien',push:vi.fn(),permission:()=>true}));
vi.mock('next/navigation',()=>({usePathname:()=>state.path,useRouter:()=>({push:state.push})}));
vi.mock('@/lib/contexts',()=>({useAuth:()=>({hasPermission:state.permission})}));
import { SettingsWorkspace } from '@/components/shared/settings-workspace';
afterEach(cleanup);
it('gives the account register full width with a compact settings switcher',()=>{
 state.path='/cai-dat/tai-khoan-tien';const {container}=render(<SettingsWorkspace>Account register</SettingsWorkspace>);
 expect(container.querySelector('aside')).toBeNull();expect(screen.getByLabelText('Mục Cài đặt')).toHaveValue('/cai-dat/tai-khoan-tien');expect(screen.getByText('Account register')).toBeInTheDocument();
});
it('retains the existing sidebar layout for other settings pages',()=>{
 state.path='/cai-dat/thanh-toan';const {container}=render(<SettingsWorkspace>Payment settings</SettingsWorkspace>);
 expect(container.querySelector('aside')).not.toBeNull();expect(screen.getByText('Payment settings')).toBeInTheDocument();
});
