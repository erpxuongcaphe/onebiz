import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import OperationsWorkspace from "../../src/components/operations/workspace";
import { PageLeaveGuard } from "../../src/components/shared/page-leave-guard";
import "../../src/app/globals.css";
import "./harness.css";
function AcceptanceRole(){
 const [actor,setActor]=useState("");
 useEffect(()=>{void fetch("/__test__/actor").then(response=>response.json()).then(result=>setActor(result.actor));},[]);
 return <div className="acceptance-role"><strong>KIỂM THỬ CÔ LẬP · DATABASE TRONG BỘ NHỚ</strong><label>Vai trò kiểm thử <select aria-label="Vai trò kiểm thử" disabled={!actor} value={actor} onChange={async event=>{const nextActor=event.target.value;const response=await fetch("/__test__/actor",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({actor:nextActor})});if(response.ok)location.reload();}}><option value="">Đang tải</option><option value="owner">CEO</option><option value="manager">Quản lý A</option><option value="manager2">Quản lý B</option><option value="qc">QC</option><option value="operator">Người phối hợp</option><option value="accounting">Kế toán</option></select></label></div>;
}
createRoot(document.getElementById("root")!).render(<><AcceptanceRole/><PageLeaveGuard /><OperationsWorkspace /></>);
