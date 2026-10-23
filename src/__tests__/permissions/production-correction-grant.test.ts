import {describe,expect,it} from "vitest";
import {DEFAULT_ROLE_TEMPLATES,PERMISSIONS,PERMISSION_GROUPS} from "@/lib/permissions/constants";
describe("explicit production correction grant",()=>{
 it("does not silently grant stock/value correction to managers, cashiers or staff templates",()=>{
  for(const role of DEFAULT_ROLE_TEMPLATES.filter(r=>!["owner","admin"].includes(r.legacyRole))) expect(role.permissions).not.toContain(PERMISSIONS.PRODUCTION_CORRECT_ORDER);
  const manager=DEFAULT_ROLE_TEMPLATES.find(r=>r.legacyRole==="manager")!;
  expect(manager.permissions).toContain(PERMISSIONS.PRODUCTION_CREATE_ORDER);
  expect(manager.permissions).toContain(PERMISSIONS.PRODUCTION_COMPLETE_ORDER);
  expect(manager.permissions).toContain(PERMISSIONS.PRODUCTION_CANCEL_ORDER);
 });
 it("offers separate correction and cancellation controls in role and per-user permission grids",()=>{
  const production=PERMISSION_GROUPS.find(g=>g.group==="Sản xuất")!;
  expect(production.permissions.find(p=>p.code===PERMISSIONS.PRODUCTION_CORRECT_ORDER)?.label).toContain("kho và giá vốn");
  expect(production.permissions.find(p=>p.code===PERMISSIONS.PRODUCTION_CANCEL_ORDER)?.label).toContain("hoàn kho");
 });
});
