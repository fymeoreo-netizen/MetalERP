begin;

drop policy if exists p_inventory_cost_components_all
  on erp.inventory_cost_components;
drop policy if exists p_inventory_cost_components_select
  on erp.inventory_cost_components;

create policy p_inventory_cost_components_select
  on erp.inventory_cost_components
  for select
  to authenticated
  using (
    erp.has_permission('transactions.read')
    or erp.has_permission('ledger.read')
    or erp.has_role('ADMIN')
    or erp.has_role('ACCOUNTANT')
  );

revoke insert, update, delete
  on table erp.inventory_cost_components
  from authenticated;
grant select
  on table erp.inventory_cost_components
  to authenticated;

commit;
