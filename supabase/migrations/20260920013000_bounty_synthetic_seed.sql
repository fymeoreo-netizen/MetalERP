-- Synthetic data for the isolated MetalERP security-testing environment.
-- Every business record is fictional. No production identifiers or balances
-- belong in this migration.

begin;

set local search_path = erp, public, pg_temp;

-- Application roles and permissions required by RLS helpers.
insert into erp.roles (id, code, name, is_system)
values
  ('a0000000-0000-4000-8000-000000000001', 'ADMIN', 'Bounty Administrator', true),
  ('a0000000-0000-4000-8000-000000000002', 'ACCOUNTANT', 'Bounty Accountant', true)
on conflict (code) do update set
  name = excluded.name,
  is_system = excluded.is_system;

insert into erp.permissions (id, code, name, module_name)
values
  ('a1000000-0000-4000-8000-000000000001', 'ledger.read', 'Read ledgers', 'financials'),
  ('a1000000-0000-4000-8000-000000000002', 'masters.read', 'Read master data', 'masters'),
  ('a1000000-0000-4000-8000-000000000003', 'masters.write', 'Write master data', 'masters'),
  ('a1000000-0000-4000-8000-000000000004', 'reports.financial.read', 'Read financial reports', 'reports'),
  ('a1000000-0000-4000-8000-000000000005', 'reports.operational.read', 'Read operational reports', 'reports'),
  ('a1000000-0000-4000-8000-000000000006', 'transactions.post', 'Post transactions', 'transactions'),
  ('a1000000-0000-4000-8000-000000000007', 'transactions.read', 'Read transactions', 'transactions')
on conflict (code) do update set
  name = excluded.name,
  module_name = excluded.module_name;

insert into erp.role_permissions (role_id, permission_id)
select r.id, p.id
from erp.roles r
cross join erp.permissions p
where r.code = 'ADMIN'
on conflict do nothing;

insert into erp.role_permissions (role_id, permission_id)
select r.id, p.id
from erp.roles r
join erp.permissions p on p.code in (
  'ledger.read',
  'masters.read',
  'masters.write',
  'transactions.post',
  'transactions.read'
)
where r.code = 'ACCOUNTANT'
on conflict do nothing;

-- Generic accounting configuration. These are test-only account definitions;
-- no journal entries or balances are seeded.
insert into erp.coa_accounts (
  code, name, account_type, account_nature, report_group,
  is_group, is_posting, level, is_anchor, is_active
)
values
  ('11102', 'Test Cash', 'asset', 'debit', 'current_assets', false, true, 3, false, true),
  ('11201', 'Test Accounts Receivable', 'asset', 'debit', 'current_assets', false, true, 3, true, true),
  ('11202', 'Test Parchi Receivable', 'asset', 'debit', 'current_assets', false, true, 3, false, true),
  ('11203', 'Test Vendor Advances', 'asset', 'debit', 'current_assets', false, true, 3, false, true),
  ('11410', 'Test Input Sales Tax', 'asset', 'debit', 'current_assets', false, true, 3, false, true),
  ('12101', 'Test Scrap Copper Inventory', 'asset', 'debit', 'inventory_assets', false, true, 3, false, true),
  ('12104', 'Test Raw Material Inventory', 'asset', 'debit', 'inventory_assets', false, true, 3, false, true),
  ('12190', 'Test Scrap Clearing', 'asset', 'debit', 'inventory_assets', false, true, 3, false, true),
  ('12201', 'Test Work in Process', 'asset', 'debit', 'inventory_assets', false, true, 3, false, true),
  ('12301', 'Test Finished Goods Inventory', 'asset', 'debit', 'inventory_assets', false, true, 3, false, true),
  ('12400', 'Test Packing Inventory', 'asset', 'debit', 'inventory_assets', false, true, 3, false, true),
  ('12500', 'Test Varnish Inventory', 'asset', 'debit', 'inventory_assets', false, true, 3, false, true),
  ('21101', 'Test Accounts Payable', 'liability', 'credit', 'current_liabilities', false, true, 3, true, true),
  ('21103', 'Test Parchi Payable', 'liability', 'credit', 'current_liabilities', false, true, 3, false, true),
  ('21104', 'Test Customer Advances', 'liability', 'credit', 'current_liabilities', false, true, 3, false, true),
  ('21190', 'Test Pending Rate Accrual', 'liability', 'credit', 'current_liabilities', false, true, 3, false, true),
  ('21201', 'Test Output Sales Tax', 'liability', 'credit', 'current_liabilities', false, true, 3, false, true),
  ('31001', 'Test Opening Equity', 'equity', 'credit', 'equity', false, true, 2, false, true),
  ('41001', 'Test Sales Revenue', 'income', 'credit', 'operating_revenue', false, true, 2, true, true),
  ('51001', 'Test COGS Clearing', 'expense', 'debit', 'cogs', false, true, 2, true, true),
  ('51006', 'Test Factory Wastage', 'expense', 'debit', 'cogs', false, true, 2, false, true),
  ('51007', 'Test Freight Inward', 'expense', 'debit', 'cogs', false, true, 2, false, true),
  ('51010', 'Test COGS Copper', 'expense', 'debit', 'cogs', false, true, 2, false, true),
  ('51011', 'Test COGS Varnish', 'expense', 'debit', 'cogs', false, true, 2, false, true),
  ('51012', 'Test COGS Packing', 'expense', 'debit', 'cogs', false, true, 2, false, true),
  ('51013', 'Test COGS Absorbed Overhead', 'expense', 'debit', 'cogs', false, true, 2, false, true),
  ('51014', 'Test Purchase Return Variance', 'expense', 'debit', 'cogs', false, true, 2, false, true),
  ('51999', 'Test Absorbed Factory Overhead', 'expense', 'credit', 'cogs', false, true, 2, false, true)
on conflict (code) do update set
  name = excluded.name,
  account_type = excluded.account_type,
  account_nature = excluded.account_nature,
  report_group = excluded.report_group,
  is_group = excluded.is_group,
  is_posting = excluded.is_posting,
  level = excluded.level,
  is_anchor = excluded.is_anchor,
  is_active = true;

insert into erp.posting_map_registry (doc_type, line_role, account_code, is_required, description)
values
  ('sales_invoice', 'ar', '11201', true, 'Test accounts receivable'),
  ('sales_invoice', 'sales_revenue', '41001', true, 'Test sales revenue'),
  ('sales_invoice', 'output_tax', '21201', true, 'Test output tax'),
  ('sales_invoice', 'cogs', '51001', true, 'Test COGS clearing'),
  ('sales_invoice', 'cogs_copper', '51010', true, 'Test copper COGS'),
  ('sales_invoice', 'cogs_varnish', '51011', true, 'Test varnish COGS'),
  ('sales_invoice', 'cogs_packing', '51012', true, 'Test packing COGS'),
  ('sales_invoice', 'cogs_overhead', '51013', true, 'Test overhead COGS'),
  ('sales_invoice', 'inventory', '12301', true, 'Test finished goods inventory'),
  ('sales_invoice', 'freight_inward', '51007', false, 'Reserved test mapping'),
  ('purchase_invoice', 'inventory', '12104', true, 'Test raw material inventory'),
  ('purchase_invoice', 'ap', '21101', true, 'Test accounts payable'),
  ('purchase_invoice', 'input_tax', '11410', true, 'Test input tax'),
  ('purchase_invoice', 'freight_inward', '51007', false, 'Test freight inward'),
  ('sales_return', 'ar', '11201', true, 'Test AR reversal'),
  ('sales_return', 'sales_revenue', '41001', true, 'Test revenue reversal'),
  ('sales_return', 'output_tax', '21201', true, 'Test tax reversal'),
  ('purchase_return', 'ap', '21101', true, 'Test AP reversal'),
  ('purchase_return', 'inventory', '12104', true, 'Test inventory reversal'),
  ('purchase_return', 'cost_variance', '51014', true, 'Test return cost variance'),
  ('payment_receipt', 'cash', '11102', true, 'Test cash receipt'),
  ('payment_receipt', 'ar', '11201', true, 'Test AR allocation'),
  ('payment_receipt', 'customer_advance', '21104', true, 'Test customer advance'),
  ('payment_payment', 'cash', '11102', true, 'Test cash payment'),
  ('payment_payment', 'ap', '21101', true, 'Test AP allocation'),
  ('payment_payment', 'vendor_advance', '11203', true, 'Test vendor advance'),
  ('opening_stock', 'inventory', '12104', true, 'Test RM opening inventory'),
  ('opening_stock', 'inventory_fg', '12301', true, 'Test FG opening inventory'),
  ('opening_stock', 'inventory_varnish', '12500', true, 'Test varnish opening inventory'),
  ('opening_stock', 'opening_equity', '31001', true, 'Test opening equity offset'),
  ('supplies_restock', 'inventory', '12500', true, 'Test supplies inventory'),
  ('supplies_restock', 'offset', '31001', true, 'Test supplies offset'),
  ('production_batch', 'wip', '12201', true, 'Test WIP bridge'),
  ('production_batch', 'inventory_fg', '12301', true, 'Test FG receipt'),
  ('production_batch', 'inventory_rm', '12104', true, 'Test RM issue'),
  ('production_batch', 'packing_consumed', '12400', true, 'Test packing consumption'),
  ('production_batch', 'absorbed_overhead', '51999', true, 'Test absorbed overhead'),
  ('scrap_trade', 'ar', '11201', true, 'Test scrap AR'),
  ('scrap_trade', 'ap', '21101', true, 'Test scrap AP'),
  ('scrap_trade', 'inventory', '12101', true, 'Test scrap inventory'),
  ('scrap_trade', 'scrap_expense', '51001', true, 'Test scrap expense'),
  ('factory_scrap_dispatch', 'ar', '11201', true, 'Test factory scrap AR'),
  ('factory_scrap_dispatch', 'revenue', '41001', true, 'Test factory scrap revenue'),
  ('factory_scrap_dispatch', 'inventory_rm', '12104', true, 'Test RM backflush'),
  ('factory_scrap_dispatch', 'wastage', '51006', true, 'Test factory wastage'),
  ('factory_scrap_dispatch', 'cogs', '51006', true, 'Test factory scrap COGS'),
  ('parchi_issue', 'parchi_receivable', '11202', true, 'Test parchi receivable'),
  ('parchi_issue', 'parchi_payable', '21103', true, 'Test parchi payable'),
  ('parchi_clearance', 'cash', '11102', true, 'Test parchi cash')
on conflict (doc_type, line_role) do update set
  account_code = excluded.account_code,
  is_required = excluded.is_required,
  description = excluded.description;

select erp.fn_upsert_posting_maps_from_registry();

-- Company and open accounting period.
insert into erp.company_settings (id, company_name, tax_id, address, default_currency)
values (
  'e0000000-0000-4000-8000-000000000001',
  'MetalERP Security Test Company',
  'TEST-TAX-ID',
  'Fictional test environment - no physical address',
  'PKR'
)
on conflict (id) do update set
  company_name = excluded.company_name,
  tax_id = excluded.tax_id,
  address = excluded.address,
  default_currency = excluded.default_currency,
  updated_at = now();

insert into erp.accounting_periods (id, fiscal_year, period_no, name, starts_on, ends_on, status)
values (
  'e1000000-0000-4000-8000-000000000001',
  2026,
  1,
  'FY 2026 - Bounty Test',
  date '2026-01-01',
  date '2026-12-31',
  'open'
)
on conflict (fiscal_year, period_no) do update set
  name = excluded.name,
  starts_on = excluded.starts_on,
  ends_on = excluded.ends_on,
  status = excluded.status;

-- Warehouses contain no opening stock. Only the transit warehouse allows
-- negative stock, matching the application's intended clearing behavior.
insert into erp.warehouses (id, code, name, wh_type, is_active, allow_negative_stock)
values
  ('b0000000-0000-4000-8000-000000000001', 'STORE_FG_ENAMELED', 'Test Enameled FG Store', 'finished_goods', true, false),
  ('b0000000-0000-4000-8000-000000000002', 'STORE_FG_STRIP', 'Test Strip FG Store', 'finished_goods', true, false),
  ('b0000000-0000-4000-8000-000000000003', 'STORE_RM', 'Test Raw Material Store', 'raw_material', true, false),
  ('b0000000-0000-4000-8000-000000000004', 'STORE_PACK', 'Test Packing Store', 'packing_material', true, false),
  ('b0000000-0000-4000-8000-000000000005', 'STORE_VARNISH', 'Test Varnish Store', 'varnish', true, false),
  ('b0000000-0000-4000-8000-000000000006', 'WH-TRIANGLE', 'Test Triangle Transit', 'triangle_transit', true, true)
on conflict (code) do update set
  name = excluded.name,
  wh_type = excluded.wh_type,
  is_active = true,
  allow_negative_stock = excluded.allow_negative_stock;

-- Product types used by item forms.
insert into erp.item_product_types (
  id, top_category, label, slug, inventory_group, item_type,
  code_prefix, form_template, sort_order, is_active, is_system, tracks_unit_count
)
values
  ('e3000000-0000-4000-8000-000000000001', 'Finished Goods', 'Enameled Wire', 'enamel_wire', 'enameled', 'Enameled Wire', 'FG-ENW', 'enamel_gauge_color', 10, true, true, true),
  ('e3000000-0000-4000-8000-000000000002', 'Finished Goods', 'Copper Strip', 'copper_strip', 'strip', 'Strip', 'FG-STR', 'strip_dimensions', 20, true, true, true),
  ('e3000000-0000-4000-8000-000000000003', 'Finished Goods', 'Copper Wire', 'copper_wire', 'copper_wire', 'Copper Wire', 'FG-CUW', 'free_text', 30, true, true, true),
  ('e3000000-0000-4000-8000-000000000004', 'Raw Material', 'Wire No 8', 'wire_no_8', 'raw_material', 'Wire', 'RM-W8', 'none', 10, true, true, true),
  ('e3000000-0000-4000-8000-000000000005', 'Raw Material', 'Copper Rod', 'copper_rod', 'raw_material', 'Rod', 'RM-CR', 'none', 20, true, true, true),
  ('e3000000-0000-4000-8000-000000000006', 'Raw Material', 'Copper Scrap', 'copper_scrap', 'raw_material', 'Scrap Feed', 'RM-SCP', 'none', 30, true, true, true),
  ('e3000000-0000-4000-8000-000000000007', 'Packing Material', 'Goats', 'goats', 'packing_material', 'Goats', 'CON-GOT', 'goat_packing', 10, true, true, false),
  ('e3000000-0000-4000-8000-000000000008', 'Chemicals', 'Varnish Drum', 'varnish_drum', 'chemicals', 'Varnish', 'CHM-VAR', 'varnish_drum', 10, true, true, true)
on conflict (id) do update set
  label = excluded.label,
  inventory_group = excluded.inventory_group,
  item_type = excluded.item_type,
  code_prefix = excluded.code_prefix,
  form_template = excluded.form_template,
  sort_order = excluded.sort_order,
  is_active = true,
  is_system = true,
  tracks_unit_count = excluded.tracks_unit_count,
  updated_at = now();

-- Canonical example SKUs with deliberately synthetic rates and zero stock.
insert into erp.items (
  id, code, name, inventory_group, item_type, size_spec, base_uom,
  standard_cost, reorder_level, gst_rate, is_active
)
values
  ('d0000000-0000-4000-8000-000000000001', 'FG-ENW-001', 'Test Enameled Wire SWG 18 Golden', 'enameled', 'Enameled Wire', 'SWG 18 Golden', 'KG', 3900, 100, 0, true),
  ('d0000000-0000-4000-8000-000000000002', 'FG-ENW-002', 'Test Enameled Wire SWG 20 Black', 'enameled', 'Enameled Wire', 'SWG 20 Black', 'KG', 3925, 100, 0, true),
  ('d0000000-0000-4000-8000-000000000003', 'FG-STR-001', 'Test Copper Strip 6 x 1.5 mm', 'strip', 'Strip', '6 x 1.5 mm', 'KG', 3800, 100, 0, true),
  ('d0000000-0000-4000-8000-000000000004', 'RM-W8-001', 'Test Wire No 8', 'raw_material', 'Wire', '8 mm', 'KG', 3700, 250, 0, true),
  ('d0000000-0000-4000-8000-000000000005', 'RM-CR-001', 'Test Copper Rod 8 mm', 'raw_material', 'Rod', '8 mm', 'KG', 3725, 250, 0, true),
  ('d0000000-0000-4000-8000-000000000006', 'RM-SCP-001', 'Test Copper Scrap', 'raw_material', 'Scrap Feed', 'Mixed test grade', 'KG', 3300, 100, 0, true),
  ('d0000000-0000-4000-8000-000000000007', 'CHM-VAR-001', 'Test Varnish Drum Golden', 'chemicals', 'Varnish', '200 kg/drum Golden', 'KG', 390, 400, 0, true),
  ('d0000000-0000-4000-8000-000000000008', 'CHM-VAR-002', 'Test Varnish Drum Black', 'chemicals', 'Varnish', '200 kg/drum Black', 'KG', 395, 400, 0, true),
  ('d0000000-0000-4000-8000-000000000009', 'CON-GOT-001', 'Test Goat 5 kg', 'packing_material', 'Goats', '5 kg', 'KG', 50, 20, 0, true),
  ('d0000000-0000-4000-8000-000000000010', 'CON-GOT-002', 'Test Goat 10 kg', 'packing_material', 'Goats', '10 kg', 'KG', 80, 20, 0, true),
  ('d0000000-0000-4000-8000-000000000011', 'CON-PAP-001', 'Test Packing Paper', 'packing_material', 'Paper', 'Standard test roll', 'KG', 20, 20, 0, true),
  ('d0000000-0000-4000-8000-000000000012', 'CON-WRP-001', 'Test Wrapper', 'packing_material', 'Wrappers', 'Standard test wrapper', 'KG', 15, 20, 0, true),
  ('d0000000-0000-4000-8000-000000000013', 'CON-STK-001', 'Test Sticker', 'packing_material', 'Stickers', 'Standard test sticker', 'KG', 2, 100, 0, true)
on conflict (code) do update set
  name = excluded.name,
  inventory_group = excluded.inventory_group,
  item_type = excluded.item_type,
  size_spec = excluded.size_spec,
  base_uom = excluded.base_uom,
  standard_cost = excluded.standard_cost,
  reorder_level = excluded.reorder_level,
  gst_rate = excluded.gst_rate,
  is_active = true;

-- Fictional parties. All opening balances remain zero.
insert into erp.parties (
  id, code, name, party_type, city, phone, tax_reg_no, credit_limit,
  opening_fin_balance, opening_metal_balance, opening_scrap_kg,
  opening_scrap_ref_rate, is_active
)
values
  ('c0000000-0000-4000-8000-000000000001', 'TEST-CUST-001', 'Bounty Customer Alpha', 'customer', 'Test City', null, 'TEST-CUST-TAX', 5000000, 0, 0, 0, 0, true),
  ('c0000000-0000-4000-8000-000000000002', 'TEST-VEND-001', 'Bounty Supplier Beta', 'vendor', 'Test City', null, 'TEST-VEND-TAX', 5000000, 0, 0, 0, 0, true),
  ('c0000000-0000-4000-8000-000000000003', 'TEST-BOTH-001', 'Bounty Trading Gamma', 'both', 'Test City', null, 'TEST-BOTH-TAX', 5000000, 0, 0, 0, 0, true)
on conflict (code) do update set
  name = excluded.name,
  party_type = excluded.party_type,
  city = excluded.city,
  phone = null,
  tax_reg_no = excluded.tax_reg_no,
  credit_limit = excluded.credit_limit,
  opening_fin_balance = 0,
  opening_metal_balance = 0,
  opening_scrap_kg = 0,
  opening_scrap_ref_rate = 0,
  is_active = true;

-- Production configuration; no production batches are seeded.
insert into erp.production_machines (id, machine_code, name, department, is_active, sort_order)
values
  ('e2000000-0000-4000-8000-000000000001', 'TEST-DRW-01', 'Test Drawing Machine 01', 'drawing', true, 10),
  ('e2000000-0000-4000-8000-000000000002', 'TEST-ENM-01', 'Test Enamel Machine 01', 'enamel', true, 20),
  ('e2000000-0000-4000-8000-000000000003', 'TEST-WS-01', 'Test Workshop Machine 01', 'workshop', true, 30)
on conflict (machine_code) do update set
  name = excluded.name,
  department = excluded.department,
  is_active = true,
  sort_order = excluded.sort_order;

insert into erp.production_standards (standard_key, numeric_value, text_value, effective_from)
values
  ('enamel_scrap_pct', 2.0, null, date '2026-01-01'),
  ('enamel_varnish_pct', 2.7, null, date '2026-01-01'),
  ('workshop_wastage_pct', 3.5, null, date '2026-01-01'),
  ('goat_packing_threshold_low_kg', 7.5, null, date '2026-01-01'),
  ('goat_packing_threshold_mid_lo_kg', 8.0, null, date '2026-01-01'),
  ('goat_packing_threshold_mid_hi_kg', 13.0, null, date '2026-01-01'),
  ('varnish_golden_item_code', null, 'CHM-VAR-001', date '2026-01-01'),
  ('varnish_black_item_code', null, 'CHM-VAR-002', date '2026-01-01'),
  ('goat_packing_5kg_item_code', null, 'CON-GOT-001', date '2026-01-01'),
  ('goat_packing_10kg_item_code', null, 'CON-GOT-002', date '2026-01-01'),
  ('rod_input_item_code', null, 'RM-CR-001', date '2026-01-01'),
  ('wire8_item_code', null, 'RM-W8-001', date '2026-01-01'),
  ('machine_wastage_pct:TEST-DRW-01', 2.0, null, date '2026-01-01'),
  ('machine_wastage_pct:TEST-ENM-01', 2.0, null, date '2026-01-01'),
  ('machine_wastage_pct:TEST-WS-01', 3.5, null, date '2026-01-01')
on conflict (standard_key, effective_from) do update set
  numeric_value = excluded.numeric_value,
  text_value = excluded.text_value,
  updated_at = now();

-- Open orders provide list/search/detail coverage without inventory or GL impact.
insert into erp.sales_orders (
  id, order_no, order_date, party_id, delivery_date, status,
  total_ordered_qty, total_fulfilled_qty, remarks
)
values (
  'f0000000-0000-4000-8000-000000000001',
  'TEST-SO-0001',
  date '2026-09-10',
  'c0000000-0000-4000-8000-000000000001',
  date '2026-09-25',
  'open',
  200,
  0,
  'Synthetic bounty sales order'
)
on conflict (order_no) do update set
  party_id = excluded.party_id,
  delivery_date = excluded.delivery_date,
  status = 'open',
  total_ordered_qty = excluded.total_ordered_qty,
  total_fulfilled_qty = 0,
  remarks = excluded.remarks;

insert into erp.sales_order_lines (
  id, sales_order_id, line_no, item_id, warehouse_id,
  qty_ordered, qty_fulfilled, unit_price
)
values (
  'f0100000-0000-4000-8000-000000000001',
  'f0000000-0000-4000-8000-000000000001',
  1,
  'd0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001',
  200,
  0,
  4250
)
on conflict (sales_order_id, line_no) do update set
  item_id = excluded.item_id,
  warehouse_id = excluded.warehouse_id,
  qty_ordered = excluded.qty_ordered,
  qty_fulfilled = 0,
  unit_price = excluded.unit_price;

insert into erp.purchase_orders (
  id, order_no, order_date, party_id, expected_date, status,
  warehouse_id, total_ordered_qty, total_received_qty, remarks
)
values (
  'f1000000-0000-4000-8000-000000000001',
  'TEST-PO-0001',
  date '2026-09-10',
  'c0000000-0000-4000-8000-000000000002',
  date '2026-09-22',
  'open',
  'b0000000-0000-4000-8000-000000000003',
  1000,
  0,
  'Synthetic bounty purchase order'
)
on conflict (order_no) do update set
  party_id = excluded.party_id,
  expected_date = excluded.expected_date,
  status = 'open',
  warehouse_id = excluded.warehouse_id,
  total_ordered_qty = excluded.total_ordered_qty,
  total_received_qty = 0,
  remarks = excluded.remarks;

insert into erp.purchase_order_lines (
  id, purchase_order_id, line_no, item_id,
  qty_ordered, qty_received, unit_price
)
values (
  'f1100000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000001',
  1,
  'd0000000-0000-4000-8000-000000000004',
  1000,
  0,
  3750
)
on conflict (purchase_order_id, line_no) do update set
  item_id = excluded.item_id,
  qty_ordered = excluded.qty_ordered,
  qty_received = 0,
  unit_price = excluded.unit_price;

-- Draft invoices are intentionally unposted: no inventory, AR/AP, COGS, or GL
-- rows are created by this seed.
insert into erp.sales_invoices (
  id, invoice_no, invoice_date, due_date, party_id, currency_code,
  sale_mode, subtotal_amount, discount_amount, tax_amount, grand_total,
  remarks, posting_status, financial_status
)
values (
  'f2000000-0000-4000-8000-000000000001',
  'TEST-SI-0001',
  date '2026-09-15',
  date '2026-10-15',
  'c0000000-0000-4000-8000-000000000001',
  'PKR',
  'direct',
  837000,
  0,
  0,
  837000,
  'Synthetic draft invoice - safe to edit or delete',
  'draft',
  'complete'
)
on conflict (invoice_no) do update set
  party_id = excluded.party_id,
  subtotal_amount = excluded.subtotal_amount,
  discount_amount = 0,
  tax_amount = 0,
  grand_total = excluded.grand_total,
  remarks = excluded.remarks,
  posting_status = 'draft',
  financial_status = 'complete';

insert into erp.sales_invoice_lines (
  id, sales_invoice_id, line_no, item_id, warehouse_id, qty, uom_code,
  gross_weight, tare_weight, net_weight, unit_count, unit_price,
  tax_rate, line_amount, rate_status
)
values
  ('f2100000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 1, 'd0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 125, 'KG', 125, 0, 125, 25, 4200, 0, 525000, 'fixed'),
  ('f2100000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001', 2, 'd0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000002', 80, 'KG', 80, 0, 80, 8, 3900, 0, 312000, 'fixed')
on conflict (sales_invoice_id, line_no) do update set
  item_id = excluded.item_id,
  warehouse_id = excluded.warehouse_id,
  qty = excluded.qty,
  gross_weight = excluded.gross_weight,
  tare_weight = excluded.tare_weight,
  net_weight = excluded.net_weight,
  unit_count = excluded.unit_count,
  unit_price = excluded.unit_price,
  tax_rate = 0,
  line_amount = excluded.line_amount,
  rate_status = 'fixed';

insert into erp.purchase_invoices (
  id, invoice_no, invoice_date, due_date, party_id, currency_code,
  purchase_mode, warehouse_id, subtotal_amount, discount_amount, tax_amount,
  additional_charges, grand_total, remarks, posting_status, financial_status
)
values (
  'f3000000-0000-4000-8000-000000000001',
  'TEST-PI-0001',
  date '2026-09-15',
  date '2026-10-15',
  'c0000000-0000-4000-8000-000000000002',
  'PKR',
  'cash',
  'b0000000-0000-4000-8000-000000000003',
  2031000,
  0,
  0,
  0,
  2031000,
  'Synthetic draft invoice - safe to edit or delete',
  'draft',
  'complete'
)
on conflict (invoice_no) do update set
  party_id = excluded.party_id,
  warehouse_id = excluded.warehouse_id,
  subtotal_amount = excluded.subtotal_amount,
  discount_amount = 0,
  tax_amount = 0,
  additional_charges = 0,
  grand_total = excluded.grand_total,
  remarks = excluded.remarks,
  posting_status = 'draft',
  financial_status = 'complete';

insert into erp.purchase_invoice_lines (
  id, purchase_invoice_id, line_no, item_id, warehouse_id, qty, uom_code,
  gross_weight, tare_weight, net_weight, unit_count, unit_price,
  tax_rate, line_amount, rate_status, wire8_grade
)
values
  ('f3100000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001', 1, 'd0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000003', 500, 'KG', 500, 0, 500, 50, 3750, 0, 1875000, 'fixed', 'Fail'),
  ('f3100000-0000-4000-8000-000000000002', 'f3000000-0000-4000-8000-000000000001', 2, 'd0000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000005', 400, 'KG', 400, 0, 400, 2, 390, 0, 156000, 'fixed', null)
on conflict (purchase_invoice_id, line_no) do update set
  item_id = excluded.item_id,
  warehouse_id = excluded.warehouse_id,
  qty = excluded.qty,
  gross_weight = excluded.gross_weight,
  tare_weight = excluded.tare_weight,
  net_weight = excluded.net_weight,
  unit_count = excluded.unit_count,
  unit_price = excluded.unit_price,
  tax_rate = 0,
  line_amount = excluded.line_amount,
  rate_status = 'fixed',
  wire8_grade = excluded.wire8_grade;

-- Guardrail: this migration must never create operational balances.
do $$
begin
  if exists (select 1 from erp.inventory_movements)
     or exists (select 1 from erp.inventory_balances where on_hand_qty <> 0 or stock_value <> 0)
     or exists (select 1 from erp.journal_entries)
     or exists (select 1 from erp.journal_lines)
     or exists (select 1 from erp.ar_documents)
     or exists (select 1 from erp.ap_documents)
     or exists (select 1 from erp.payments) then
    raise exception 'Synthetic seed guard failed: operational balances or postings exist';
  end if;
end;
$$;

commit;
