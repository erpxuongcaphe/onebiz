# Ma trận nút và hành động OneBiz

> Kiểm kê tĩnh JSX. Kết quả cần được đối chiếu bằng UAT vì handler có thể nằm trong component cha hoặc thư viện UI.

## Tổng quan

- Nút/hành động phát hiện được: 1139
- Cần kiểm tra handler thủ công: 56
- Handler đáng ngờ: 0
- Hành động chưa có nhãn đọc được: 402
- Hành động chưa thấy khóa bằng disabled: 719

## Handler đáng ngờ

| Nhóm | Thành phần | Nhãn | Handler | File:dòng |
|---|---|---|---|---|

## Cần kiểm tra handler thủ công

| Nhóm | Thành phần | Nhãn | File:dòng |
|---|---|---|---|
| page | Button | Huỷ | `src/app/(main)/ai-agents/[id]/page.tsx:1338` |
| page | Button | Chạy agent | `src/app/(main)/ai-agents/kpi/page.tsx:490` |
| page | Button | Cấu hình | `src/app/(main)/ai-agents/page.tsx:210` |
| page | Button | Tạo đơn hàng | `src/app/(main)/ban-online/facebook/page.tsx:310` |
| page | Button | (không nhãn) | `src/app/(main)/ban-online/facebook/page.tsx:367` |
| page | Button | Thêm vào đơn | `src/app/(main)/ban-online/facebook/page.tsx:393` |
| page | Button | (không nhãn) | `src/app/(main)/ban-online/page.tsx:280` |
| page | Button | Chỉnh sửa website | `src/app/(main)/ban-online/website/page.tsx:170` |
| page | Button | Quản lý sản phẩm | `src/app/(main)/ban-online/website/page.tsx:184` |
| page | button | Xem tất cả đơn hàng &rarr; | `src/app/(main)/ban-online/website/page.tsx:298` |
| page | Button | Tạo đơn hàng | `src/app/(main)/ban-online/zalo/page.tsx:300` |
| page | Button | Gửi cho khách | `src/app/(main)/ban-online/zalo/page.tsx:374` |
| page | Button | Gửi | `src/app/(main)/ban-online/zalo/page.tsx:395` |
| page | Button | Đang phát triển | `src/app/(main)/cai-dat/ket-noi/page.tsx:123` |
| page | Button | Về trang chủ | `src/app/(main)/error.tsx:42` |
| page | button | `Bàn ${table.name} (${table.capacity} chỗ) — kéo để di chuyển` | `src/app/(main)/he-thong/quan-ly-ban/floor-plan-editor.tsx:292` |
| page | button | (không nhãn) | `src/app/(main)/phan-tich/_components/date-range-bar.tsx:79` |
| page | button | (không nhãn) | `src/app/(main)/phan-tich/_components/date-range-bar.tsx:96` |
| page | Button | Xem HSD | `src/app/(main)/san-xuat/page.tsx:302` |
| page | Button | Quản lý | `src/app/(main)/san-xuat/page.tsx:370` |
| page | Button | Xem tồn kho | `src/app/(main)/san-xuat/page.tsx:400` |
| page | Button | (không nhãn) | `src/app/(main)/san-xuat/page.tsx:475` |
| page | Button | Công thức sản xuất (BOM) | `src/app/(main)/san-xuat/page.tsx:480` |
| page | Button | Lô sản phẩm | `src/app/(main)/san-xuat/page.tsx:485` |
| page | Button | Hạn sử dụng | `src/app/(main)/san-xuat/page.tsx:490` |
| page | Button | Về trang chủ | `src/app/error.tsx:46` |
| page | Button | (không nhãn) | `src/app/manager/otp/page.tsx:32` |
| page | Button | Quay về trang chủ | `src/app/manager/page.tsx:176` |
| page | Button | Cấp OTP | `src/app/manager/page.tsx:283` |
| page | Button | Mở web đầy đủ | `src/app/manager/page.tsx:307` |
| page | Button | Nhập | `src/app/manager/page.tsx:432` |
| page | Button | Tồn kho | `src/app/manager/page.tsx:508` |
| page | Button | Đặt nhập | `src/app/manager/page.tsx:513` |
| mkt | button | Thêm cấp 3 vào nhánh này | `src/app/mkt/campaigns/[campaignId]/page.tsx:500` |
| page | Button | Về trang chủ | `src/app/not-found.tsx:30` |
| pos | Button | Màn bếp | `src/app/pos/fnb/components/fnb-header.tsx:197` |
| pos | Button | Quản lý bàn | `src/app/pos/fnb/components/fnb-header.tsx:208` |
| mkt | Button | Thêm mục sẵn sàng | `src/components/mkt/add-readiness-button.tsx:60` |
| mkt | Button | Chỉnh sửa | `src/components/mkt/campaign-controls.tsx:213` |
| mkt | button | Thêm Kế hoạch phụ | `src/components/mkt/campaign-controls.tsx:342` |
| mkt | Button | Thêm Kế hoạch phụ | `src/components/mkt/campaign-controls.tsx:349` |
| mkt | Button | Thêm nội dung | `src/components/mkt/campaign-controls.tsx:498` |
| mkt | Button | Tạo chiến dịch | `src/components/mkt/campaign-form-dialog.tsx:98` |
| mkt | button | Sửa Kế hoạch | `src/components/mkt/campaign-plan-controls.tsx:320` |
| mkt | button | Sửa Kế hoạch | `src/components/mkt/planning-tree.tsx:466` |
| mkt | button | Thêm cấp 3 vào nhánh này | `src/components/mkt/planning-tree.tsx:508` |
| component | button | group.label | `src/components/shared/app-sidebar.tsx:456` |
| component | Button | Đang xử lý... | `src/components/shared/dialogs/import-excel-dialog.tsx:313` |
| component | button | (không nhãn) | `src/components/shared/filter-sidebar/person-filter.tsx:74` |
| component | Button | Đang tải... | `src/components/shared/pipeline/pipeline-transition-actions.tsx:86` |
| component | Button | Không có hành động | `src/components/shared/pipeline/pipeline-transition-actions.tsx:95` |
| component | Button | (không nhãn) | `src/components/shared/top-nav.tsx:677` |
| component | Button | `Thông báo${unreadCount > 0 ? ` (${unreadCount} chưa đọc)` : ""}` | `src/components/shared/top-nav.tsx:688` |
| component | Button | (không nhãn) | `src/components/ui/dialog.tsx:68` |
| component | Button | (không nhãn) | `src/components/ui/dialog.tsx:114` |
| component | Button | (không nhãn) | `src/components/ui/sheet.tsx:66` |

## Hành động chưa đọc được nhãn

| Nhóm | Thành phần | Handler | File:dòng |
|---|---|---|---|
| page | Button | `form-submit` | `src/app/(auth)/dang-nhap/page.tsx:277` |
| page | Button | `form-submit` | `src/app/(auth)/dat-lai-mat-khau/page.tsx:102` |
| page | Button | `form-submit` | `src/app/(auth)/quen-mat-khau/page.tsx:117` |
| page | button | `() => setChartView(v.value)` | `src/app/(main)/_dashboard-charts.tsx:170` |
| page | div | `() => hasPayload && setOpen((o) => !o)` | `src/app/(main)/ai-agents/[id]/page.tsx:111` |
| page | button | `() => setTaskFilter(f.key)` | `src/app/(main)/ai-agents/[id]/page.tsx:903` |
| page | Button | `() =>
                                  handleTaskStatusChange(task.id, nextStatus)` | `src/app/(main)/ai-agents/[id]/page.tsx:1048` |
| page | Button | `handleSave` | `src/app/(main)/ai-agents/[id]/page.tsx:1342` |
| page | Button | `() => onTrigger(agent)` | `src/app/(main)/ai-agents/page.tsx:195` |
| page | Button | `handleSeed` | `src/app/(main)/ai-agents/page.tsx:523` |
| page | Button | `() => onChangeStatus(task.id, nextStatus)` | `src/app/(main)/ai-agents/tasks/page.tsx:161` |
| page | Button | `() => onDelete(task)` | `src/app/(main)/ai-agents/tasks/page.tsx:198` |
| page | Button | `() => setActiveFilter(tab.key)` | `src/app/(main)/ban-online/don-hang/page.tsx:110` |
| page | button | `() => setActiveConversation(conv.id)` | `src/app/(main)/ban-online/facebook/page.tsx:241` |
| page | Button | `(trigger)` | `src/app/(main)/ban-online/facebook/page.tsx:367` |
| page | Button | `(trigger)` | `src/app/(main)/ban-online/page.tsx:280` |
| page | button | `() => toggleVisibility(product.id)` | `src/app/(main)/ban-online/website/page.tsx:219` |
| page | button | `() => setActiveConv(conv.id)` | `src/app/(main)/ban-online/zalo/page.tsx:227` |
| page | button | `() => onCheckedChange(!checked)` | `src/app/(main)/cai-dat/ban-hang/page.tsx:41` |
| page | Button | `handleSave` | `src/app/(main)/cai-dat/bang-gia/platforms/page.tsx:439` |
| page | Button | `handleSave` | `src/app/(main)/cai-dat/chi-nhanh/page.tsx:948` |
| page | button | `() => updatePlatform(meta.key, { active: !cfg.active })` | `src/app/(main)/cai-dat/fnb-presets/page.tsx:253` |
| page | Button | `handleSavePlatforms` | `src/app/(main)/cai-dat/fnb-presets/page.tsx:276` |
| page | Button | `handleSavePresets` | `src/app/(main)/cai-dat/fnb-presets/page.tsx:364` |
| page | button | `() => setTheme(t.id as "light" | "dark" | "system")` | `src/app/(main)/cai-dat/giao-dien/page.tsx:123` |
| page | button | `() => setFontSize(fs.id as "small" | "medium" | "large")` | `src/app/(main)/cai-dat/giao-dien/page.tsx:211` |
| page | button | `() => setBorderRadius(br.id as "none" | "sm" | "md" | "lg")` | `src/app/(main)/cai-dat/giao-dien/page.tsx:239` |
| page | button | `() => onCheckedChange(!checked)` | `src/app/(main)/cai-dat/in-an/page.tsx:100` |
| page | PrintSettingsNav | `(id) => {
            setSelected(id);
            setNavOpen(false);
          }` | `src/app/(main)/cai-dat/in-an/page.tsx:465` |
| page | button | `() => update({ backend: b.id })` | `src/app/(main)/cai-dat/in-an/page.tsx:503` |
| page | Button | `handleTestPrint` | `src/app/(main)/cai-dat/in-an/page.tsx:617` |
| page | button | `() => update({ paperSize: tpl.id })` | `src/app/(main)/cai-dat/in-an/page.tsx:657` |
| page | button | `() => setInvoiceTitle(t)` | `src/app/(main)/cai-dat/in-an/page.tsx:696` |
| page | Button | `handleFooterSave` | `src/app/(main)/cai-dat/in-an/page.tsx:827` |
| page | button | `() => update({ kitchenTicketStyle: style.id })` | `src/app/(main)/cai-dat/in-an/page.tsx:963` |
| page | button | `() => update({ receiptStyle: style.id })` | `src/app/(main)/cai-dat/in-an/page.tsx:1018` |
| page | button | `() => onSelect(item.id)` | `src/app/(main)/cai-dat/in-an/page.tsx:1116` |
| page | button | `onToggleNav` | `src/app/(main)/cai-dat/in-an/page.tsx:1146` |
| page | Button | `onConnect` | `src/app/(main)/cai-dat/in-an/page.tsx:1242` |
| page | button | `() => onChange(!value)` | `src/app/(main)/cai-dat/kho-hang/page.tsx:56` |
| page | button | `() => !disabled && onCheckedChange(!checked)` | `src/app/(main)/cai-dat/khuyen-mai/page.tsx:52` |
| page | Button | `handleSaveSettings` | `src/app/(main)/cai-dat/khuyen-mai/page.tsx:469` |
| page | Button | `handleSave` | `src/app/(main)/cai-dat/ma-giam-gia/page.tsx:346` |
| page | button | `() => setLanguage(lang.id as "vi" | "en")` | `src/app/(main)/cai-dat/ngon-ngu/page.tsx:90` |
| page | DropdownMenuItem | `() => handleCreateFromTemplate(t)` | `src/app/(main)/cai-dat/phan-quyen/page.tsx:245` |
| page | button | `() => handleExpand(role.id)` | `src/app/(main)/cai-dat/phan-quyen/page.tsx:265` |
| page | button | `() => toggleGroup(groupCodes)` | `src/app/(main)/cai-dat/phan-quyen/page.tsx:326` |
| page | button | `() => togglePerm(perm.code)` | `src/app/(main)/cai-dat/phan-quyen/page.tsx:336` |
| page | Button | `() => void handleSaveTenant(tier)` | `src/app/(main)/cai-dat/phi-giao-hang/page.tsx:245` |
| page | button | `() => setVietQrEnabled(!vietQrEnabled)` | `src/app/(main)/cai-dat/thanh-toan/page.tsx:269` |
| page | Button | `handleSave` | `src/app/(main)/cai-dat/thanh-toan/page.tsx:340` |
| page | Button | `handleBind` | `src/app/(main)/cai-dat/thiet-bi-pos/page.tsx:237` |
| page | button | `() => onCheckedChange(!checked)` | `src/app/(main)/cai-dat/thong-bao/page.tsx:31` |
| page | button | `() => onCheckedChange(!checked)` | `src/app/(main)/cai-dat/tich-diem/page.tsx:60` |
| page | Button | `handleSave` | `src/app/(main)/cai-dat/tich-diem/page.tsx:200` |
| page | Button | `handleSaveSettings` | `src/app/(main)/cai-dat/tich-diem/page.tsx:550` |
| page | DropdownMenuItem | `() => {
                    // Terminal → luôn confirm. Non-terminal (picked_up / in_transit)
                    // cũng confirm để tránh bấm nhầm trên tablet / touch-UI.
                    if (isTerminal(s) || s === "picked_up" || s === "in_transit") {
                      setPendingNext(s);
                    } else {
                      executeTransition(s);
                    }
                  }` | `src/app/(main)/don-hang/van-don/page.tsx:210` |
| page | button | `() => { setStatusFilter(opt.value); setPage(0); }` | `src/app/(main)/hang-hoa/chuyen-kho/page.tsx:356` |
| page | CreateTransferDialog | `async (input) => {
          setCreating(true);
          try {
            const result = await createStockTransfer(input);
            toast({
              title: `Đã tạo phiếu ${result.code}`,
              variant: "success",
            });
            setShowCreate(false);
            fetchData();
          } catch (err) {
            toast({
              title: "Lỗi tạo phiếu",
              description:
                err instanceof Error ? err.message : "Vui lòng thử lại",
              variant: "error",
            });
          } finally {
            setCreating(false);
          }
        }` | `src/app/(main)/hang-hoa/chuyen-kho/page.tsx:495` |
| page | Button | `() => removeItem(item.id)` | `src/app/(main)/hang-hoa/chuyen-kho/page.tsx:1036` |
| page | Button | `async () => {
                if (!cloneSourceBom || !cloneTargetBranchId) return;
                setCloneLoading(true);
                try {
                  const cloned = await cloneBOMForBranch(
                    cloneSourceBom.id,
                    cloneTargetBranchId,
                  );
                  toast({
                    variant: "success",
                    title: "Đã tạo BOM riêng",
                    description: `${cloned.name} — chi nhánh ${
                      branches.find((b) => b.id === cloneTargetBranchId)?.name
                    } sẽ dùng BOM này thay BOM global.`,
                    duration: 8000,
                  });
                  setCloneDialogOpen(false);
                  setCloneSourceBom(null);
                  setCloneTargetBranchId("");
                  await fetchData();
                } catch (err) {
                  toast({
                    variant: "error",
                    title: "Không sao chép được BOM",
                    description: err instanceof Error ? err.message : "Lỗi không xác định",
                  });
                } finally {
                  setCloneLoading(false);
                }
              }` | `src/app/(main)/hang-hoa/cong-thuc/page.tsx:788` |
| page | Button | `async () => {
                if (!deletingInvoice) return;
                setDeleteLoading(true);
                try {
                  await cancelInputInvoice(deletingInvoice.id, cancelReason.trim());
                  toast({
                    title: "Đã hủy hoá đơn đầu vào",
                    description: `${deletingInvoice.code} — lý do: ${cancelReason.trim()}`,
                    variant: "success",
                  });
                  setDeletingInvoice(null);
                  setCancelReason("");
                  fetchData();
                } catch (err) {
                  toast({
                    title: "Lỗi hủy hoá đơn đầu vào",
                    description: err instanceof Error ? err.message : "Vui lòng thử lại",
                    variant: "error",
                  });
                } finally {
                  setDeleteLoading(false);
                }
              }` | `src/app/(main)/hang-hoa/hoa-don-dau-vao/page.tsx:511` |
| page | Button | `() => void handleExport("excel")` | `src/app/(main)/hang-hoa/lich-su-kho/page.tsx:494` |
| page | Button | `handleConfirmCloseShort` | `src/app/(main)/hang-hoa/nhap-hang/page.tsx:1604` |
| page | button | `() => setChannelFilter(tab.v)` | `src/app/(main)/hang-hoa/nhom/page.tsx:778` |
| page | Button | `handleSave` | `src/app/(main)/hang-hoa/nhom/page.tsx:1030` |
| page | button | `() => setStatusFilter(tab.value)` | `src/app/(main)/hang-hoa/page.tsx:1752` |
| page | Button | `handleConfirmSingleDelete` | `src/app/(main)/hang-hoa/page.tsx:2108` |
| page | Button | `handleConfirmBulkRestore` | `src/app/(main)/hang-hoa/page.tsx:2162` |
| page | Button | `handleConfirmBulkCleanup` | `src/app/(main)/hang-hoa/page.tsx:2264` |
| page | Button | `handleConfirmBulkChangeCategory` | `src/app/(main)/hang-hoa/page.tsx:2362` |
| page | Button | `handleConfirmBulkChangePrice` | `src/app/(main)/hang-hoa/page.tsx:2426` |
| page | Button | `handleConfirmBulkDelete` | `src/app/(main)/hang-hoa/page.tsx:2479` |
| page | Button | `handleSaveAdjust` | `src/app/(main)/hang-hoa/ton-kho/page.tsx:734` |
| page | Button | `handleToggleLock` | `src/app/(main)/hang-hoa/ton-kho/page.tsx:1376` |
| page | Button | `() => handleDeleteGroup(g)` | `src/app/(main)/hang-hoa/tuy-chon-fnb/page.tsx:297` |
| page | Button | `() => openEditOption(g.id, o)` | `src/app/(main)/hang-hoa/tuy-chon-fnb/page.tsx:341` |
| page | Button | `() => handleDeleteOption(o)` | `src/app/(main)/hang-hoa/tuy-chon-fnb/page.tsx:344` |
| page | Button | `handleSave` | `src/app/(main)/hang-hoa/tuy-chon-fnb/page.tsx:492` |
| page | Button | `handleSave` | `src/app/(main)/hang-hoa/tuy-chon-fnb/page.tsx:671` |
| page | Button | `() => setSelectedEntry(row.original)` | `src/app/(main)/he-thong/audit/page.tsx:176` |
| page | button | `() => setLayoutZone(z.name)` | `src/app/(main)/he-thong/quan-ly-ban/page.tsx:569` |
| page | Button | `() => {
                    setRenameForm({ oldZone: zone.name, newZone: zone.name });
                    setRenameZoneOpen(true);
                  }` | `src/app/(main)/he-thong/quan-ly-ban/page.tsx:674` |
| page | Button | `() => requestDeleteZone(zone.name)` | `src/app/(main)/he-thong/quan-ly-ban/page.tsx:685` |
| page | Button | `handleCheck` | `src/app/(main)/he-thong/toan-ven-kho/page.tsx:134` |
| page | DropdownMenuItem | `() => handleToggleActive(user)` | `src/app/(main)/he-thong/users/page.tsx:501` |
| page | Button | `handleEditUser` | `src/app/(main)/he-thong/users/page.tsx:726` |
| page | Button | `handleCreateUser` | `src/app/(main)/he-thong/users/page.tsx:909` |
| page | Button | `handleSaveProfile` | `src/app/(main)/ho-so/page.tsx:510` |
| page | Button | `handleChangePassword` | `src/app/(main)/ho-so/page.tsx:574` |
| page | Button | `handleChangePin` | `src/app/(main)/ho-so/page.tsx:662` |
| page | Button | `handleSave` | `src/app/(main)/khach-hang/nhom/page.tsx:307` |
| page | Button | `onExport` | `src/app/(main)/phan-tich/_components/date-range-bar.tsx:64` |
| page | button | `(trigger)` | `src/app/(main)/phan-tich/_components/date-range-bar.tsx:79` |
| page | button | `() => setPreset(p.key)` | `src/app/(main)/phan-tich/_components/date-range-bar.tsx:83` |
| page | button | `(trigger)` | `src/app/(main)/phan-tich/_components/date-range-bar.tsx:96` |
| page | button | `() => setFilterMode(opt.key)` | `src/app/(main)/phan-tich/abc-analysis/page.tsx:322` |
| page | button | `() => setBucketFilter(chip.key)` | `src/app/(main)/phan-tich/aging/page.tsx:486` |
| page | button | `() => setFilter(chip.key)` | `src/app/(main)/phan-tich/chenh-lech-kiem-ke/page.tsx:598` |
| page | button | `() => setFilter(key)` | `src/app/(main)/phan-tich/cong-no-aging/page.tsx:387` |
| page | button | `() => setSourceFilter(chip.key)` | `src/app/(main)/phan-tich/nhan-vien/page.tsx:395` |
| page | button | `() => setSubMode(m.key)` | `src/app/(main)/phan-tich/xuat-nhap-ton/page.tsx:525` |
| page | Button | `(trigger)` | `src/app/(main)/san-xuat/page.tsx:475` |
| page | button | `() => handleClickNotification(notification)` | `src/app/(main)/thong-bao/page.tsx:342` |
| page | Button | `(trigger)` | `src/app/manager/otp/page.tsx:32` |
| page | button | `() => setActiveScreen(screen.id)` | `src/app/manager/page.tsx:259` |
| page | button | `() => setActiveScreen(screen.id)` | `src/app/manager/page.tsx:885` |
| pos | div | `onClose` | `src/app/pos/components/customer-picker.tsx:131` |
| pos | li | `() => commitSelection(idx)` | `src/app/pos/components/customer-picker.tsx:179` |
| pos | div | `onClose` | `src/app/pos/components/product-autocomplete.tsx:131` |
| pos | CategoryPill | `() => setSelectedCategory("all")` | `src/app/pos/components/product-grid.tsx:326` |
| pos | CategoryPill | `() => setSelectedCategory(cat.id)` | `src/app/pos/components/product-grid.tsx:333` |
| pos | CategoryRow | `() => setSelectedCategory("all")` | `src/app/pos/components/product-grid.tsx:358` |
| pos | CategoryRow | `() => setSelectedCategory(cat.id)` | `src/app/pos/components/product-grid.tsx:365` |
| pos | ProductTile | `(avail) => onAddProduct(product, avail)` | `src/app/pos/components/product-grid.tsx:453` |
| pos | button | `onClick` | `src/app/pos/components/product-grid.tsx:525` |
| pos | DraftCard | `() => onSelect(d)` | `src/app/pos/components/recovery-dialog.tsx:76` |
| pos | button | `() => setSelectedId(v.id)` | `src/app/pos/components/variant-picker-dialog.tsx:115` |
| pos | Button | `() => setQuantity((q) => Math.max(1, q - 1))` | `src/app/pos/components/variant-picker-dialog.tsx:172` |
| pos | Button | `() => setQuantity((q) => q + 1)` | `src/app/pos/components/variant-picker-dialog.tsx:193` |
| pos | button | `clickable ? onClick : undefined` | `src/app/pos/fnb/components/connection-status-bar.tsx:56` |
| pos | button | `() => setNoteExpanded((v) => !v)` | `src/app/pos/fnb/components/fnb-cart.tsx:264` |
| pos | button | `() => onChangeOrderType(opt.key)` | `src/app/pos/fnb/components/fnb-cart.tsx:316` |
| pos | button | `() => onDeliveryPlatformChange(p.key)` | `src/app/pos/fnb/components/fnb-cart.tsx:378` |
| pos | button | `onSendToKitchen` | `src/app/pos/fnb/components/fnb-cart.tsx:766` |
| pos | div | `() => setPresetMenuOpen(false)` | `src/app/pos/fnb/components/fnb-cart.tsx:967` |
| pos | button | `() => applyPreset(p)` | `src/app/pos/fnb/components/fnb-cart.tsx:976` |
| pos | CategoryTile | `() => onSelect(null)` | `src/app/pos/fnb/components/fnb-category-grid.tsx:64` |
| pos | CategoryTile | `() => onSelect(cat.id)` | `src/app/pos/fnb/components/fnb-category-grid.tsx:73` |
| pos | CategoryButton | `() => onSelect(null)` | `src/app/pos/fnb/components/fnb-category-sidebar.tsx:80` |
| pos | CategoryButton | `() => onSelect(cat.id)` | `src/app/pos/fnb/components/fnb-category-sidebar.tsx:90` |
| pos | CategoryPill | `() => onSelect(null)` | `src/app/pos/fnb/components/fnb-category-tabs.tsx:39` |
| pos | CategoryPill | `() => onSelect(cat.id)` | `src/app/pos/fnb/components/fnb-category-tabs.tsx:46` |
| pos | button | `onClick` | `src/app/pos/fnb/components/fnb-category-tabs.tsx:67` |
| pos | div | `onClose` | `src/app/pos/fnb/components/fnb-customer-picker.tsx:125` |
| pos | li | `() => commitSelection(idx)` | `src/app/pos/fnb/components/fnb-customer-picker.tsx:179` |
| pos | ShiftIndicator | `onShiftClick` | `src/app/pos/fnb/components/fnb-header.tsx:130` |
| pos | button | `() => switchTab(tab.id)` | `src/app/pos/fnb/components/fnb-header.tsx:235` |
| pos | span | `(e) => {
                e.stopPropagation();
                // P1-3D-P2 12/06/2026 + R-6 13/06/2026 audit lần 2:
                // - Tab dine_in ĐÃ gửi bếp → confirm chặt chẽ (bàn vẫn occupied
                //   ở server — đóng tab xong cashier có thể click lại bàn từ
                //   Sơ đồ bàn để re-hydrate tab qua handleTableSelect).
                // - Tab takeaway/delivery đã gửi bếp → confirm bình thường.
                // - Tab có items chưa gửi → confirm.
                const hasItems = (tab.lines?.length ?? 0) > 0;
                const sentToKitchen = !!tab.kitchenOrderId;
                if (sentToKitchen && tab.orderType === "dine_in" && typeof window !== "undefined") {
                  if (!window.confirm(
                    `"${tab.label}" đã gửi bếp + bàn vẫn occupied. Đóng tab sẽ giữ đơn ở KDS — để mở lại, click bàn từ Sơ đồ bàn. Tiếp tục?`
                  )) return;
                  closeTab(tab.id);
                  return;
                }
                if ((hasItems || sentToKitchen) && typeof window !== "undefined") {
                  const msg = sentToKitchen
                    ? `"${tab.label}" đã gửi bếp. Đóng tab sẽ mất link local — đơn vẫn ở KDS. Tiếp tục?`
                    : `"${tab.label}" có ${tab.lines.length} món chưa gửi bếp. Đóng tab sẽ mất sạch. Tiếp tục?`;
                  if (!window.confirm(msg)) return;
                }
                closeTab(tab.id);
              }` | `src/app/pos/fnb/components/fnb-header.tsx:248` |
| pos | Button | `() => setQuantity((q) => Math.max(1, q - 1))` | `src/app/pos/fnb/components/fnb-item-dialog.tsx:437` |
| pos | Button | `() => setQuantity((q) => q + 1)` | `src/app/pos/fnb/components/fnb-item-dialog.tsx:442` |
| pos | button | `() => toggleDynamicChoice(g, o.id)` | `src/app/pos/fnb/components/fnb-item-dialog.tsx:537` |
| pos | button | `() => setSweetness(sweetness === s ? "" : s)` | `src/app/pos/fnb/components/fnb-item-dialog.tsx:571` |
| pos | button | `() => setIceLevel(iceLevel === i ? "" : i)` | `src/app/pos/fnb/components/fnb-item-dialog.tsx:592` |
| pos | Button | `handleConfirmVoid` | `src/app/pos/fnb/components/fnb-order-history-dialog.tsx:503` |
| pos | button | `() => setTipInput(btn.value > 0 ? String(btn.value) : "")` | `src/app/pos/fnb/components/fnb-payment-dialog.tsx:183` |
| pos | button | `() => setMethod(key)` | `src/app/pos/fnb/components/fnb-payment-dialog.tsx:216` |
| pos | button | `() => setCashInput(String(d))` | `src/app/pos/fnb/components/fnb-payment-dialog.tsx:252` |
| pos | Button | `handleConfirm` | `src/app/pos/fnb/components/fnb-payment-dialog.tsx:359` |
| pos | ProductCard | `() => onSelectProduct(product)` | `src/app/pos/fnb/components/fnb-product-grid.tsx:152` |
| pos | button | `onClick` | `src/app/pos/fnb/components/fnb-product-grid.tsx:195` |
| pos | div | `onClose` | `src/app/pos/fnb/components/fnb-search-modal.tsx:102` |
| pos | li | `() => commitSelection(idx)` | `src/app/pos/fnb/components/fnb-search-modal.tsx:135` |
| pos | div | `onClose` | `src/app/pos/fnb/components/fnb-sidenav-drawer.tsx:98` |
| pos | Link | `onClose` | `src/app/pos/fnb/components/fnb-sidenav-drawer.tsx:211` |
| pos | Pill | `() => onSelectSubFilter(null)` | `src/app/pos/fnb/components/fnb-subcategory-pills.tsx:76` |
| pos | Pill | `() => onSelectSubFilter(brand)` | `src/app/pos/fnb/components/fnb-subcategory-pills.tsx:83` |
| pos | button | `() => setAmount(String(d.value))` | `src/app/pos/fnb/components/shift-dialog.tsx:93` |
| pos | Button | `handleSyncNow` | `src/app/pos/fnb/components/sync-queue-drawer.tsx:217` |
| pos | button | `() => setActiveZoneId(z.id)` | `src/app/pos/fnb/components/table-floor-plan.tsx:192` |
| pos | CanvasView | `(ct) => setActionTable(ct)` | `src/app/pos/fnb/components/table-floor-plan.tsx:211` |
| pos | button | `() => onSelectTable(t)` | `src/app/pos/fnb/components/table-floor-plan.tsx:335` |
| pos | button | `() => setFilter(tab.key)` | `src/app/pos/fnb/kds/page.tsx:756` |
| pos | button | `() => setFilter(tab.key)` | `src/app/pos/fnb/kds/page.tsx:871` |
| pos | button | `() => setStationFilter(s.id)` | `src/app/pos/fnb/kds/page.tsx:901` |
| pos | button | `onServed` | `src/app/pos/fnb/kds/page.tsx:1226` |
| pos | button | `onToggle` | `src/app/pos/fnb/kds/page.tsx:1339` |
| pos | ConnectionStatusBar | `() => setSyncDrawerOpen(true)` | `src/app/pos/fnb/page.tsx:2616` |
| pos | FnbCategorySidebar | `setActiveCategoryId` | `src/app/pos/fnb/page.tsx:2723` |
| pos | FnbCategorySidebar | `setActiveCategoryId` | `src/app/pos/fnb/page.tsx:2731` |
| pos | FnbCategoryGrid | `setActiveCategoryId` | `src/app/pos/fnb/page.tsx:2758` |
| pos | FnbSearchModal | `(product) => {
              handleSelectProduct(product);
              setSearchModalOpen(false);
            }` | `src/app/pos/fnb/page.tsx:2911` |
| pos | FnbCustomerPicker | `handleCustomerSelect` | `src/app/pos/fnb/page.tsx:2926` |
| pos | button | `() => setMobileCartOpen(false)` | `src/app/pos/fnb/page.tsx:2954` |
| pos | button | `handleVoidKitchenOrder` | `src/app/pos/fnb/page.tsx:3140` |
| pos | ConnectionStatusBar | `() => setSyncDrawerOpen(true)` | `src/app/pos/page.tsx:2552` |
| pos | button | `() => {
                  setSearchQuery("");
                  searchInputRef.current?.focus();
                }` | `src/app/pos/page.tsx:2628` |
| pos | div | `() => setShowShortcuts(false)` | `src/app/pos/page.tsx:2705` |
| pos | div | `() => setMobileCartOpen(false)` | `src/app/pos/page.tsx:2834` |
| pos | button | `() => switchTab(tab.id)` | `src/app/pos/page.tsx:2884` |
| pos | span | `(e) => {
                          e.stopPropagation();
                          closeTab(tab.id);
                        }` | `src/app/pos/page.tsx:2906` |
| pos | button | `handleApplyCoupon` | `src/app/pos/page.tsx:3210` |
| pos | PaymentBtn | `() => state.setPaymentMethod("cash")` | `src/app/pos/page.tsx:3282` |
| pos | PaymentBtn | `() => state.setPaymentMethod("transfer")` | `src/app/pos/page.tsx:3288` |
| pos | PaymentBtn | `() => state.setPaymentMethod("card")` | `src/app/pos/page.tsx:3294` |
| pos | PaymentBtn | `() => state.setPaymentMethod("mixed")` | `src/app/pos/page.tsx:3300` |
| pos | button | `() => state.setPaid(d.value)` | `src/app/pos/page.tsx:3410` |
| pos | button | `() => setMobileCartOpen(true)` | `src/app/pos/page.tsx:3556` |
| pos | SellingModeTab | `() => state.setSellingMode("fast")` | `src/app/pos/page.tsx:3588` |
| pos | SellingModeTab | `() => state.setSellingMode("normal")` | `src/app/pos/page.tsx:3594` |
| pos | SellingModeTab | `() => state.setSellingMode("delivery")` | `src/app/pos/page.tsx:3600` |
| pos | CustomerPicker | `(customer) => {
          state.setCustomer(customer, "user-pick");
          // R2: Cảnh báo nợ cũ — KH có currentDebt > 0 → toast warning
          // ngay khi chọn để cashier biết trước khi cộng thêm đơn mới.
          if (customer && customer.currentDebt > 0) {
            toast({
              title: `⚠️ ${customer.name} đang nợ ${formatCurrency(customer.currentDebt)} ₫`,
              description: "Vui lòng đối chiếu công nợ cũ trước khi cho ghi nợ tiếp.",
              variant: "warning",
              duration: 6000,
            });
          }
        }` | `src/app/pos/page.tsx:3609` |
| pos | RecoveryDialog | `handleRecoverySelect` | `src/app/pos/page.tsx:3979` |
| pos | button | `() => onQtyChange(Math.max(1, line.quantity - 1))` | `src/app/pos/page.tsx:4260` |
| pos | button | `() => onQtyChange(line.quantity + 1)` | `src/app/pos/page.tsx:4286` |
| pos | button | `() =>
                onDiscountChange({
                  ...line.discount,
                  mode: line.discount.mode === "amount" ? "percent" : "amount",
                })` | `src/app/pos/page.tsx:4356` |
| pos | button | `onClick` | `src/app/pos/page.tsx:4545` |
| pos | button | `onClick` | `src/app/pos/page.tsx:4578` |
| pos | div | `onClose` | `src/app/pos/page.tsx:4965` |
| pos | button | `onClose` | `src/app/pos/page.tsx:4978` |
| mkt | DialogTrigger | `(trigger)` | `src/components/mkt/add-readiness-button.tsx:58` |
| mkt | Button | `submit` | `src/components/mkt/add-readiness-button.tsx:100` |
| mkt | Button | `createLink` | `src/components/mkt/audit-ai-access-manager.tsx:139` |
| mkt | Button | `copyLink` | `src/components/mkt/audit-ai-access-manager.tsx:168` |
| mkt | Button | `() => execute()` | `src/components/mkt/audit-runner-panel.tsx:134` |
| mkt | Button | `setup` | `src/components/mkt/audit-runner-panel.tsx:139` |
| mkt | Button | `copyResults` | `src/components/mkt/audit-runner-panel.tsx:144` |
| mkt | form | `execute` | `src/components/mkt/audit-runner-public-panel.tsx:110` |
| mkt | Button | `form-submit` | `src/components/mkt/audit-runner-public-panel.tsx:112` |
| mkt | Button | `copyResults` | `src/components/mkt/audit-runner-public-panel.tsx:117` |
| mkt | DialogTrigger | `(trigger)` | `src/components/mkt/campaign-controls.tsx:211` |
| mkt | Button | `save` | `src/components/mkt/campaign-controls.tsx:263` |
| mkt | DialogTrigger | `(trigger)` | `src/components/mkt/campaign-controls.tsx:339` |
| mkt | Button | `submit` | `src/components/mkt/campaign-controls.tsx:439` |
| mkt | DialogTrigger | `(trigger)` | `src/components/mkt/campaign-controls.tsx:496` |
| mkt | Button | `submit` | `src/components/mkt/campaign-controls.tsx:560` |
| mkt | DialogTrigger | `(trigger)` | `src/components/mkt/campaign-form-dialog.tsx:96` |
| mkt | button | `() => setItems((v) => v.filter((_, i) => i !== idx))` | `src/components/mkt/campaign-form-dialog.tsx:191` |
| mkt | Button | `handleSubmit` | `src/components/mkt/campaign-form-dialog.tsx:208` |
| mkt | span | `() => setOpen(true)` | `src/components/mkt/campaign-plan-controls.tsx:110` |
| mkt | Button | `submit` | `src/components/mkt/campaign-plan-controls.tsx:184` |
| mkt | button | `() => setCategoryFilter(categoryFilter === c ? "all" : c)` | `src/components/mkt/document-library.tsx:150` |
| mkt | button | `() => setStatusFilter(statusFilter === "archived" ? "available" : "archived")` | `src/components/mkt/document-library.tsx:159` |
| mkt | button | `() => setPreview(item)` | `src/components/mkt/document-library.tsx:223` |
| mkt | Button | `() => toggleStatus(preview)` | `src/components/mkt/document-library.tsx:322` |
| mkt | Button | `submit` | `src/components/mkt/document-library.tsx:501` |
| mkt | ReassignDialog | `(newAssigneeId, reason) =>
          run("reassign", { newAssigneeId, reason }, () => setDialog(null))` | `src/components/mkt/leader-queue-actions.tsx:87` |
| mkt | Button | `handleConfirm` | `src/components/mkt/leader-queue-actions.tsx:207` |
| mkt | button | `() => setPreview(item)` | `src/components/mkt/media-library.tsx:220` |
| mkt | Button | `() => toggleStatus(preview)` | `src/components/mkt/media-library.tsx:332` |
| mkt | Button | `submit` | `src/components/mkt/media-library.tsx:493` |
| mkt | Button | `() => inputRef.current?.click()` | `src/components/mkt/media-uploader.tsx:67` |
| mkt | MktLink | `() => setMoreOpen(false)` | `src/components/mkt/mkt-nav.tsx:90` |
| mkt | MktLink | `() => setMoreOpen(false)` | `src/components/mkt/mkt-nav.tsx:116` |
| mkt | button | `() => void openItem(n)` | `src/components/mkt/notification-bell.tsx:196` |
| mkt | button | `() => toggle(a.id)` | `src/components/mkt/pillar-board.tsx:175` |
| mkt | Button | `save` | `src/components/mkt/pillar-board.tsx:379` |
| mkt | Button | `save` | `src/components/mkt/pillar-board.tsx:529` |
| mkt | Button | `submit` | `src/components/mkt/plan-controls.tsx:151` |
| mkt | Button | `() => setOpen(true)` | `src/components/mkt/plan-controls.tsx:531` |
| mkt | Button | `quickCreateContent` | `src/components/mkt/plan-controls.tsx:837` |
| mkt | Button | `save` | `src/components/mkt/plan-controls.tsx:852` |
| mkt | Button | `submitPlan` | `src/components/mkt/plan-controls.tsx:855` |
| mkt | Button | `() => review("approve")` | `src/components/mkt/plan-controls.tsx:1069` |
| mkt | Button | `submit` | `src/components/mkt/plan-controls.tsx:1134` |
| mkt | Button | `() => act(t.id, "reassign", reassignTo)` | `src/components/mkt/plan-controls.tsx:1231` |
| mkt | Button | `() => { setReassignFor(t.id); setReassignTo(""); }` | `src/components/mkt/plan-controls.tsx:1238` |
| mkt | Button | `() => act(t.id, "cancel")` | `src/components/mkt/plan-controls.tsx:1241` |
| mkt | button | `() => setHealth(h.value)` | `src/components/mkt/plan-progress.tsx:186` |
| mkt | Button | `submit` | `src/components/mkt/plan-progress.tsx:271` |
| mkt | button | `submit` | `src/components/mkt/planning-tree.tsx:202` |
| mkt | span | `(e) => { e.preventDefault(); e.stopPropagation(); }` | `src/components/mkt/planning-tree.tsx:459` |
| mkt | Button | `handleConfirm` | `src/components/mkt/reason-dialog.tsx:98` |
| mkt | button | `() => setRows((v) => v.filter((_, i) => i !== idx))` | `src/components/mkt/split-dialog.tsx:258` |
| mkt | Button | `quickCreateContent` | `src/components/mkt/split-dialog.tsx:309` |
| mkt | Button | `handleSubmit` | `src/components/mkt/split-dialog.tsx:326` |
| mkt | button | `() => setDialog("submit")` | `src/components/mkt/task-actions.tsx:105` |
| mkt | SubmitReviewDialog | `(contentUrl, note) =>
          run("submit-review", { contentItemId: task.contentItemId, contentUrl, note })` | `src/components/mkt/task-actions.tsx:166` |
| mkt | Button | `handleConfirm` | `src/components/mkt/task-actions.tsx:307` |
| mkt | button | `ping` | `src/components/mkt/team-actions.tsx:46` |
| mkt | ReassignDialog | `async (newAssigneeId, reason) => {
            await mktPost(`/api/mkt/v1/tasks/${reassignTask.id}/reassign`, {
              newAssigneeId,
              reason,
            });
            refresh(() => setReassignTask(null));
          }` | `src/components/mkt/team-actions.tsx:71` |
| mkt | button | `handleConnect` | `src/components/mkt/telegram-link-card.tsx:93` |
| component | button | `onBackToBranch` | `src/components/shared/all-branches-banner.tsx:28` |
| component | button | `() => setOpen((v) => !v)` | `src/components/shared/app-sidebar.tsx:211` |
| component | button | `onToggle` | `src/components/shared/app-sidebar.tsx:276` |
| component | Button | `() => handleSave(branch.id)` | `src/components/shared/branch-print-info-card.tsx:283` |
| component | button | `handleFilePick` | `src/components/shared/business-logo-upload.tsx:175` |
| component | button | `() => item.onSelect()` | `src/components/shared/command-palette.tsx:428` |
| component | Checkbox | `(e) => e.stopPropagation()` | `src/components/shared/data-table/data-table.tsx:329` |
| component | DropdownMenuItem | `(e) => {
                        e.stopPropagation();
                        action.onClick();
                      }` | `src/components/shared/data-table/data-table.tsx:366` |
| component | button | `async () => {
                  if (!onSelectAllMatching) return;
                  setAllMatchingLoading(true);
                  try {
                    const allIds = await onSelectAllMatching();
                    const newSelection: RowSelectionState = {};
                    allIds.forEach((id) => {
                      newSelection[id] = true;
                    });
                    setRowSelection(newSelection);
                    setAllMatchingMode(true);
                  } finally {
                    setAllMatchingLoading(false);
                  }
                }` | `src/components/shared/data-table/data-table.tsx:533` |
| component | TableHead | `header.column.getToggleSortingHandler()` | `src/components/shared/data-table/data-table.tsx:604` |
| component | TableRow | `() => handleRowClick(row.original, rowIndex)` | `src/components/shared/data-table/data-table.tsx:709` |
| component | div | `() => handleRowClick(row.original, rowIndex)` | `src/components/shared/data-table/data-table.tsx:793` |
| component | Checkbox | `(e) => e.stopPropagation()` | `src/components/shared/data-table/data-table.tsx:807` |
| component | DropdownMenuTrigger | `(e) => e.stopPropagation()` | `src/components/shared/data-table/data-table.tsx:819` |
| component | DropdownMenuItem | `(e) => {
                                  e.stopPropagation();
                                  action.onClick();
                                }` | `src/components/shared/data-table/data-table.tsx:835` |
| component | button | `() => action.onClick(selectedRows, selectedRowIds)` | `src/components/shared/data-table/data-table.tsx:936` |
| component | Button | `() => onPageChange?.(0)` | `src/components/shared/data-table/pagination.tsx:59` |
| component | Button | `() => onPageChange?.(pageIndex - 1)` | `src/components/shared/data-table/pagination.tsx:68` |
| component | Button | `() => onPageChange?.(pageIndex + 1)` | `src/components/shared/data-table/pagination.tsx:80` |
| component | Button | `() => onPageChange?.(pageCount - 1)` | `src/components/shared/data-table/pagination.tsx:89` |
| component | button | `() => selectProduct(p)` | `src/components/shared/dialogs/add-price-tier-item-dialog.tsx:163` |
| component | button | `() => setScope(opt.value)` | `src/components/shared/dialogs/adjust-price-tier-percent-dialog.tsx:222` |
| component | Button | `handleSave` | `src/components/shared/dialogs/assign-expiry-existing-stock-dialog.tsx:795` |
| component | Button | `toggleAllBranches` | `src/components/shared/dialogs/auto-breakdown-dialog.tsx:374` |
| component | button | `() => removeItem(idx)` | `src/components/shared/dialogs/bom-editor-dialog.tsx:482` |
| component | Button | `handleConfirm` | `src/components/shared/dialogs/cancel-impact-dialog.tsx:296` |
| component | Button | `() => onOpenChange(false)` | `src/components/shared/dialogs/confirm-dialog.tsx:59` |
| component | Button | `onConfirm` | `src/components/shared/dialogs/confirm-dialog.tsx:66` |
| component | Button | `handleSave` | `src/components/shared/dialogs/create-customer-dialog.tsx:623` |
| component | Button | `handleSave` | `src/components/shared/dialogs/create-delivery-partner-dialog.tsx:171` |
| component | button | `() => {
                              setSelectedSupplier({ id: s.id, name: s.name });
                              setSupplierSearch(s.name);
                              setShowSupplierDropdown(false);
                            }` | `src/components/shared/dialogs/create-input-invoice-dialog.tsx:350` |
| component | button | `() => addProduct(p)` | `src/components/shared/dialogs/create-input-invoice-dialog.tsx:400` |
| component | button | `() => removeItem(item.productId)` | `src/components/shared/dialogs/create-internal-sale-dialog.tsx:379` |
| component | button | `() => {
                              setSelectedCustomer(c.id);
                              setCustomerSearch(c.name);
                              setShowCustomerDropdown(false);
                            }` | `src/components/shared/dialogs/create-invoice-dialog.tsx:370` |
| component | button | `() => addProduct(p)` | `src/components/shared/dialogs/create-invoice-dialog.tsx:419` |
| component | button | `() => {
                              setSelectedCustomer({ id: c.id, name: c.name });
                              setCustomerSearch(c.name);
                              setShowCustomerDropdown(false);
                              // Prefill người nhận từ khách (chỉ khi ô còn trống)
                              setReceiverName((v) => v || c.name);
                              setReceiverPhone((v) => v || c.phone || "");
                            }` | `src/components/shared/dialogs/create-order-dialog.tsx:525` |
| component | button | `() => addProduct(p)` | `src/components/shared/dialogs/create-order-dialog.tsx:577` |
| component | Button | `() => onOpenChange(false)` | `src/components/shared/dialogs/create-order-dialog.tsx:770` |
| component | Button | `isEdit ? handleReviewChanges : handleSave` | `src/components/shared/dialogs/create-order-dialog.tsx:773` |
| component | button | `() => selectProduct(p)` | `src/components/shared/dialogs/create-price-book-dialog.tsx:191` |
| component | button | `() => setStockUnit(stockUnitDup)` | `src/components/shared/dialogs/create-product-dialog.tsx:1570` |
| component | button | `() => setBomPickerTypeFilter(o.v)` | `src/components/shared/dialogs/create-product-dialog.tsx:2571` |
| component | button | `() =>
                                    setBomPickerSelected((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(p.id)) next.delete(p.id);
                                      else next.add(p.id);
                                      return next;
                                    })` | `src/components/shared/dialogs/create-product-dialog.tsx:2755` |
| component | button | `() => toggleDay(idx)` | `src/components/shared/dialogs/create-promotion-dialog.tsx:605` |
| component | button | `() => toggleBranch(b.id)` | `src/components/shared/dialogs/create-promotion-dialog.tsx:636` |
| component | Button | `handleSave` | `src/components/shared/dialogs/create-promotion-dialog.tsx:742` |
| component | button | `() => {
                              setSelectedSupplier({ id: s.id, name: s.name });
                              setSupplierSearch(s.name);
                              setShowSupplierDropdown(false);
                            }` | `src/components/shared/dialogs/create-purchase-entry-dialog.tsx:332` |
| component | button | `() => addProduct(p)` | `src/components/shared/dialogs/create-purchase-entry-dialog.tsx:382` |
| component | button | `() => {
                              setSelectedSupplier({ id: s.id, name: s.name });
                              setSupplierSearch(s.name);
                              setShowSupplierDropdown(false);
                            }` | `src/components/shared/dialogs/create-purchase-order-dialog.tsx:679` |
| component | button | `() => addProduct(p)` | `src/components/shared/dialogs/create-purchase-order-dialog.tsx:732` |
| component | button | `() => {
                              setSelectedPO(po);
                              setPOSearch(po.code);
                              setShowPODropdown(false);
                              loadPOItems(po.id);
                            }` | `src/components/shared/dialogs/create-purchase-return-dialog.tsx:282` |
| component | button | `() => setPaymentMethod(method.value)` | `src/components/shared/dialogs/create-purchase-return-dialog.tsx:309` |
| component | button | `() => {
                              setSelectedInvoice(inv);
                              setInvoiceSearch(inv.code);
                              setShowInvoiceDropdown(false);
                              loadInvoiceItems(inv.id);
                            }` | `src/components/shared/dialogs/create-return-dialog.tsx:345` |
| component | button | `() => {
                        setRefundMode(opt.value);
                        if (opt.value === "partial" && partialRefund === 0) {
                          setPartialRefund(Math.round(returnTotal / 2));
                        }
                      }` | `src/components/shared/dialogs/create-return-dialog.tsx:376` |
| component | button | `() => setRefundPaymentMethod(method.value)` | `src/components/shared/dialogs/create-return-dialog.tsx:410` |
| component | Button | `handleSave` | `src/components/shared/dialogs/create-shipment-dialog.tsx:193` |
| component | button | `() => {
                          setSelectedInvoice(inv);
                          setInvoiceSearch(inv.code);
                          setShowInvoiceDropdown(false);
                          if (!receiverName) setReceiverName(inv.customerName);
                        }` | `src/components/shared/dialogs/create-shipping-order-dialog.tsx:211` |
| component | Button | `handleSave` | `src/components/shared/dialogs/create-supplier-dialog.tsx:332` |
| component | Button | `handleSave` | `src/components/shared/dialogs/edit-invoice-dialog.tsx:218` |
| component | button | `() => toggleKpiType(t)` | `src/components/shared/dialogs/edit-playbook-rule-dialog.tsx:196` |
| component | button | `() => togglePeriod(p)` | `src/components/shared/dialogs/edit-playbook-rule-dialog.tsx:221` |
| component | Button | `handleSave` | `src/components/shared/dialogs/edit-playbook-rule-dialog.tsx:479` |
| component | Button | `luu` | `src/components/shared/dialogs/edit-purchase-order-dialog.tsx:340` |
| component | Button | `handleConfirmImport` | `src/components/shared/dialogs/import-excel-dialog.tsx:301` |
| component | Button | `handleVerify` | `src/components/shared/dialogs/otp-approval-dialog.tsx:278` |
| component | RadioBtn | `() => onChange("default")` | `src/components/shared/dialogs/permission-override-dialog.tsx:333` |
| component | RadioBtn | `() => onChange("grant")` | `src/components/shared/dialogs/permission-override-dialog.tsx:339` |
| component | RadioBtn | `() => onChange("revoke")` | `src/components/shared/dialogs/permission-override-dialog.tsx:345` |
| component | button | `onClick` | `src/components/shared/dialogs/permission-override-dialog.tsx:381` |
| component | button | `() => handleSelectUser(u)` | `src/components/shared/dialogs/pos-pin-switch-dialog.tsx:188` |
| component | button | `() => handleKeypadPress(d)` | `src/components/shared/dialogs/pos-pin-switch-dialog.tsx:250` |
| component | button | `() => setStep("select")` | `src/components/shared/dialogs/pos-pin-switch-dialog.tsx:260` |
| component | button | `handleBackspace` | `src/components/shared/dialogs/pos-pin-switch-dialog.tsx:276` |
| component | Button | `handleVerify` | `src/components/shared/dialogs/pos-pin-switch-dialog.tsx:303` |
| component | button | `() => setScope(opt.value)` | `src/components/shared/dialogs/price-tier-dialog.tsx:183` |
| component | Button | `handleSave` | `src/components/shared/dialogs/price-tier-dialog.tsx:238` |
| component | button | `() => setSelected(opt.id)` | `src/components/shared/dialogs/print-size-picker-dialog.tsx:79` |
| component | Button | `handleSave` | `src/components/shared/dialogs/record-payment-dialog.tsx:193` |
| component | Button | `handleConfirm` | `src/components/shared/dialogs/set-pin-dialog.tsx:276` |
| component | Button | `handleConfirm` | `src/components/shared/dialogs/settle-debt-dialog.tsx:460` |
| component | button | `() => onChange(option.value)` | `src/components/shared/filter-sidebar/chip-toggle-filter.tsx:24` |
| component | Button | `() => setMobileOpen(false)` | `src/components/shared/filter-sidebar/filter-sidebar.tsx:77` |
| component | button | `() => setOpen((v) => !v)` | `src/components/shared/filter-sidebar/filter-sidebar.tsx:170` |
| component | button | `clear` | `src/components/shared/filter-sidebar/person-filter.tsx:45` |
| component | button | `(trigger)` | `src/components/shared/filter-sidebar/person-filter.tsx:74` |
| component | DecorationNode | `() => {
                if (mode === "edit") {
                  onSelectedDecorationIdChange?.(d.id);
                  onSelectedTableIdChange?.(null);
                }
              }` | `src/components/shared/floor-plan/floor-plan-canvas.tsx:308` |
| component | TableNode | `() => {
                if (mode === "view") onSelectTable?.(t);
                else onSelectedTableIdChange?.(t.id);
              }` | `src/components/shared/floor-plan/floor-plan-canvas.tsx:328` |
| component | Group | `onSelect` | `src/components/shared/floor-plan/floor-plan-canvas.tsx:492` |
| component | Group | `onSelect` | `src/components/shared/floor-plan/floor-plan-canvas.tsx:727` |
| component | button | `() => {
                      setActiveZoneId(z.id);
                      setSelectedTableId(null);
                      setSelectedDecorationId(null);
                    }` | `src/components/shared/floor-plan/floor-plan-editor.tsx:522` |
| component | button | `() =>
                    handleTableLayoutChange(selectedTable.id, {
                      locked: !selectedTable.locked,
                    })` | `src/components/shared/floor-plan/floor-plan-editor.tsx:684` |
| component | ActionButton | `() => onAction("open", table)` | `src/components/shared/floor-plan/table-action-sheet.tsx:92` |
| component | ActionButton | `() => onAction("transfer", table)` | `src/components/shared/floor-plan/table-action-sheet.tsx:100` |
| component | ActionButton | `() => onAction("merge", table)` | `src/components/shared/floor-plan/table-action-sheet.tsx:105` |
| component | ActionButton | `() => onAction("cancel-reservation", table)` | `src/components/shared/floor-plan/table-action-sheet.tsx:113` |
| component | button | `onClick` | `src/components/shared/floor-plan/table-action-sheet.tsx:142` |
| component | button | `actionLink.onClick` | `src/components/shared/inline-detail-panel/detail-header.tsx:88` |
| component | button | `() => setActiveTab(tab.id)` | `src/components/shared/inline-detail-panel/detail-tabs.tsx:31` |
| component | div | `() => onCardClick?.(item)` | `src/components/shared/kanban-board.tsx:172` |
| component | Button | `handleSubmit` | `src/components/shared/kitchen-stations-card.tsx:594` |
| component | button | `() => onCheckedChange(!checked)` | `src/components/shared/kitchen-stations-card.tsx:622` |
| component | MenuCardItem | `onClose` | `src/components/shared/mobile-bottom-nav.tsx:423` |
| component | MenuCardItem | `onClose` | `src/components/shared/mobile-bottom-nav.tsx:505` |
| component | Link | `onClick` | `src/components/shared/mobile-bottom-nav.tsx:573` |
| component | button | `() =>
                          group.collapsible ? toggleGroup(gi) : undefined` | `src/components/shared/module-sidebar-layout.tsx:194` |
| component | Button | `handleIssue` | `src/components/shared/otp-issuer-content.tsx:351` |
| component | Button | `handleCopy` | `src/components/shared/otp-issuer-content.tsx:608` |
| component | Button | `handleClick` | `src/components/shared/page-header.tsx:118` |
| component | DropdownMenuItem | `() => runAction(action)` | `src/components/shared/page-header.tsx:133` |
| component | DropdownMenuItem | `action.onClick` | `src/components/shared/page-header.tsx:542` |
| component | IconButton | `onColumnToggle` | `src/components/shared/page-header.tsx:555` |
| component | IconButton | `onSettings` | `src/components/shared/page-header.tsx:562` |
| component | IconButton | `onHelp` | `src/components/shared/page-header.tsx:569` |
| component | DropdownMenuItem | `() => handleTransition(t)` | `src/components/shared/pipeline/pipeline-transition-actions.tsx:122` |
| component | DropdownMenuItem | `() => switchBranch(branch.id)` | `src/components/shared/pos-branch-selector.tsx:155` |
| component | button | `() => onCheckedChange(!checked)` | `src/components/shared/print-template-manager.tsx:250` |
| component | button | `() => {
                    if (w !== world) setChannel(channelsForWorld(w)[0]);
                  }` | `src/components/shared/print-template-manager.tsx:516` |
| component | button | `() => setPaperSize(p)` | `src/components/shared/print-template-manager.tsx:995` |
| component | button | `() => setFontSize(fs.value)` | `src/components/shared/print-template-manager.tsx:1063` |
| component | button | `handleFilePick` | `src/components/shared/product-image-upload.tsx:176` |
| component | Button | `handleSave` | `src/components/shared/product-platform-prices-tab.tsx:301` |
| component | Button | `() => void handleExportExcel()` | `src/components/shared/product-stock-movements-tab.tsx:194` |
| component | Button | `handleAdd` | `src/components/shared/product-uom-conversions-tab.tsx:204` |
| component | button | `() => setTab(t.id)` | `src/components/shared/receipt-preview-panel.tsx:189` |
| component | button | `() => handlePresetClick(p.key)` | `src/components/shared/report/report-date-range-picker.tsx:99` |
| component | Link | `() => setPickerVisibility(false)` | `src/components/shared/report/report-shell.tsx:170` |
| component | input | `(event) => event.stopPropagation()` | `src/components/shared/report/report-table-display.tsx:236` |
| component | DropdownMenuItem | `() =>
                      setPreferences((current) => ({
                        ...current,
                        hiddenColumnKeys: [],
                      }))` | `src/components/shared/report/report-table-display.tsx:278` |
| component | DropdownMenuItem | `onReset` | `src/components/shared/report/report-table-display.tsx:296` |
| component | DropdownMenuItem | `() => switchBranch(branch.id)` | `src/components/shared/top-nav.tsx:144` |
| component | Link | `onClose` | `src/components/shared/top-nav.tsx:317` |
| component | button | `() => setOpen((v) => !v)` | `src/components/shared/top-nav.tsx:358` |
| component | button | `() => setOpen((v) => !v)` | `src/components/shared/top-nav.tsx:418` |
| component | SheetTrigger | `(trigger)` | `src/components/shared/top-nav.tsx:481` |
| component | button | `() => switchBranch(branch.id)` | `src/components/shared/top-nav.tsx:510` |
| component | Button | `(trigger)` | `src/components/shared/top-nav.tsx:677` |
| component | Button | `(trigger)` | `src/components/ui/dialog.tsx:68` |
| component | Button | `(trigger)` | `src/components/ui/dialog.tsx:114` |
| component | MenuPrimitive.Item | `handleClick` | `src/components/ui/dropdown-menu.tsx:126` |
| component | Button | `(trigger)` | `src/components/ui/sheet.tsx:66` |

## Lưu ý nghiệm thu

- Không có `disabled` chưa chắc là lỗi; phải kiểm tra handler có chống bấm lặp và trạng thái đang xử lý hay không.
- Nút biểu tượng phải có `aria-label` hoặc tooltip rõ nghĩa.
- Mọi nút ghi dữ liệu phải có phản hồi thành công, lỗi và cập nhật dữ liệu sau thao tác.
