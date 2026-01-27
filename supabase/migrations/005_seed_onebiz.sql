-- OneBiz ERP - Seed data for quick demo (safe to re-run)

do $$
declare
  t_id uuid;
  w_main uuid;
  c_furniture uuid;
  c_tech uuid;
  c_accessories uuid;
  c_lighting uuid;
  p1 uuid;
  p2 uuid;
  p3 uuid;
  p4 uuid;
  p5 uuid;
  cust_a uuid;
  cust_b uuid;
  cust_c uuid;
  o1 uuid;
  o2 uuid;
begin
  select id into t_id from public.tenants where custom_domain = 'onebiz.com.vn' limit 1;
  if t_id is null then
    raise exception 'tenant onebiz.com.vn not found; run 001_core.sql first';
  end if;

  -- Categories
  insert into public.inventory_categories (tenant_id, name, code)
  values
    (t_id, 'Nội thất', 'NOI-THAT'),
    (t_id, 'Công nghệ', 'CONG-NGHE'),
    (t_id, 'Phụ kiện', 'PHU-KIEN'),
    (t_id, 'Đèn', 'DEN')
  on conflict do nothing;

  select id into c_furniture from public.inventory_categories where tenant_id = t_id and code = 'NOI-THAT';
  select id into c_tech from public.inventory_categories where tenant_id = t_id and code = 'CONG-NGHE';
  select id into c_accessories from public.inventory_categories where tenant_id = t_id and code = 'PHU-KIEN';
  select id into c_lighting from public.inventory_categories where tenant_id = t_id and code = 'DEN';

  -- Warehouse
  insert into public.inventory_warehouses (tenant_id, name, code, address)
  values (t_id, 'Kho trung tam', 'KHO-CT', 'TP. Ho Chi Minh')
  on conflict do nothing;

  select id into w_main from public.inventory_warehouses where tenant_id = t_id and code = 'KHO-CT';

  -- Products
  insert into public.inventory_products (tenant_id, sku, name, category_id, selling_price, min_stock_level, image_url)
  values
    (t_id, 'FUR-001', 'Ghe Cong Thai Hoc ErgoPro', c_furniture, 4500000, 10, 'https://picsum.photos/100/100?random=11'),
    (t_id, 'FUR-002', 'Ban Dung Thong Minh', c_furniture, 8900000, 10, 'https://picsum.photos/100/100?random=12'),
    (t_id, 'LIG-001', 'Den Ban LED Chong Can', c_lighting, 650000, 20, 'https://picsum.photos/100/100?random=13'),
    (t_id, 'ACC-005', 'Gia Do Laptop Nhom', c_accessories, 350000, 5, 'https://picsum.photos/100/100?random=14'),
    (t_id, 'TEC-008', 'Ban Phim Co Keychron', c_tech, 2100000, 8, 'https://picsum.photos/100/100?random=15')
  on conflict do nothing;

  select id into p1 from public.inventory_products where tenant_id = t_id and sku = 'FUR-001';
  select id into p2 from public.inventory_products where tenant_id = t_id and sku = 'FUR-002';
  select id into p3 from public.inventory_products where tenant_id = t_id and sku = 'LIG-001';
  select id into p4 from public.inventory_products where tenant_id = t_id and sku = 'ACC-005';
  select id into p5 from public.inventory_products where tenant_id = t_id and sku = 'TEC-008';

  -- Stock
  insert into public.inventory_stock (tenant_id, product_id, warehouse_id, quantity)
  values
    (t_id, p1, w_main, 45),
    (t_id, p2, w_main, 12),
    (t_id, p3, w_main, 120),
    (t_id, p4, w_main, 0),
    (t_id, p5, w_main, 25)
  on conflict (tenant_id, product_id, warehouse_id) do update
  set quantity = excluded.quantity,
      updated_at = now();

  -- Customers
  insert into public.sales_customers (tenant_id, code, name, email, phone, customer_type, status)
  values
    (t_id, 'CUST-001', 'Cong ty TNHH XYZ', 'contact@xyz.vn', '0901234567', 'company', 'active'),
    (t_id, 'CUST-002', 'Nguyen Van A', 'nva@gmail.com', '0987222111', 'individual', 'active'),
    (t_id, 'CUST-003', 'Tran Thi B', 'ttb@gmail.com', '0933888555', 'individual', 'active')
  on conflict do nothing;

  select id into cust_a from public.sales_customers where tenant_id = t_id and code = 'CUST-001';
  select id into cust_b from public.sales_customers where tenant_id = t_id and code = 'CUST-002';
  select id into cust_c from public.sales_customers where tenant_id = t_id and code = 'CUST-003';

  -- Orders (use non-accent ascii in seed)
  insert into public.sales_orders (tenant_id, order_number, customer_id, order_date, status, total, payment_status)
  values
    (t_id, 'ORD-7784', cust_b, current_date - 1, 'confirmed', 350000, 'paid'),
    (t_id, 'ORD-7783', cust_c, current_date - 2, 'processing', 8900000, 'partial')
  on conflict do nothing;

  select id into o1 from public.sales_orders where tenant_id = t_id and order_number = 'ORD-7784';
  select id into o2 from public.sales_orders where tenant_id = t_id and order_number = 'ORD-7783';

  -- Order items
  insert into public.sales_order_items (tenant_id, order_id, product_id, quantity, unit_price)
  values
    (t_id, o1, p4, 1, 350000),
    (t_id, o2, p2, 1, 8900000)
  on conflict do nothing;

  -- Stock movements reflecting sales
  insert into public.inventory_stock_movements (tenant_id, product_id, warehouse_id, movement_type, quantity, reference_type, reference_id, notes)
  values
    (t_id, p4, w_main, 'sale', -1, 'sales_order', o1, 'Ban hang'),
    (t_id, p2, w_main, 'sale', -1, 'sales_order', o2, 'Ban hang')
  on conflict do nothing;

  -- Finance accounts (minimal)
  insert into public.finance_accounts (tenant_id, code, name, account_type, is_system)
  values
    (t_id, '111', 'Tien mat', 'asset', true),
    (t_id, '112', 'Tien gui ngan hang', 'asset', true),
    (t_id, '131', 'Phai thu khach hang', 'asset', true),
    (t_id, '331', 'Phai tra nha cung cap', 'liability', true),
    (t_id, '511', 'Doanh thu ban hang', 'revenue', true),
    (t_id, '641', 'Chi phi ban hang', 'expense', true)
  on conflict do nothing;

  -- Finance transactions: use positive for inflow, negative for outflow
  insert into public.finance_transactions (tenant_id, transaction_number, transaction_date, description, reference_type, reference_id, total_amount, status)
  values
    (t_id, 'TRX-2312', current_date - 1, 'Thu tien don ORD-7784', 'sales_order', o1, 350000, 'posted'),
    (t_id, 'TRX-2311', current_date - 1, 'Chi phi van chuyen', 'expense', null, -1200000, 'posted'),
    (t_id, 'TRX-2310', current_date - 2, 'Chi nha cung cap', 'expense', null, -8500000, 'posted')
  on conflict do nothing;

  -- Ensure base roles exist for this tenant
  perform public.seed_default_roles(t_id);

end $$;
