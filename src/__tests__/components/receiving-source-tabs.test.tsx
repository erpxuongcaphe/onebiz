import {describe,expect,it} from 'vitest';
import {render,screen} from '@testing-library/react';
import {ReceivingSourceTabs} from '@/components/shared/receiving-source-tabs';
import {readFileSync} from 'node:fs';

describe('receiving source navigation',()=>{
  it('carries local branch scope in both directions',()=>{
    render(<ReceivingSourceTabs source="internal" branch="outlet-1"/>);
    expect(screen.getByRole('link',{name:'Nhận nội bộ'})).toHaveAttribute('aria-current','page');
    expect(screen.getByRole('link',{name:'Nhập nhà cung cấp'})).toHaveAttribute('href','/hang-hoa/nhap-hang?branch=outlet-1');
  });
  it('rejects an unassigned supplier scope before fetching and keeps all history as default',()=>{
    const source=readFileSync('src/app/(main)/hang-hoa/nhap-hang/page.tsx','utf8');
    expect(source.indexOf('if (branchDenied)')).toBeLessThan(source.indexOf('await getPurchaseOrders({ page, pageSize'));
    expect(source).toContain("!branches.some(branch=>branch.id===requestedBranch)");
    expect(source).toContain('useState<DatePresetValue>("today")');
    expect(source).toContain('useState<string[]>([])');
    expect(source).not.toContain('setActiveBranch');
    expect(source).not.toContain('router.push("/hang-hoa/nhap-hang/noi-bo")');
    const internal=readFileSync('src/app/(main)/hang-hoa/nhap-hang/noi-bo/page.tsx','utf8');
    expect(internal).not.toContain('{i.receivingReason}');
  });
});
