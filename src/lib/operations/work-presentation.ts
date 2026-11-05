export function workProgress(run: { original_due_at: string; current_due_at?: string|null; quality: string; checks: {result?:string;created_at:string}[] }, now = Date.now()) {
  const deadline = Date.parse(run.current_due_at ?? run.original_due_at);
  const last = run.checks[0];
  if (run.quality === "met" && last) return {label:Date.parse(last.created_at)>Date.parse(run.original_due_at)?"Hoàn thành trễ hạn gốc":"Hoàn thành đúng hạn gốc",tone:Date.parse(last.created_at)>Date.parse(run.original_due_at)?"pending_review":"met"};
  if(run.quality === "met")return {label:"Đã đạt · xem thời điểm trong chi tiết",tone:"met"};
  if (deadline < now) {
    const hours=Math.max(1,Math.floor((now-deadline)/3600000));
    return {label:`Quá hạn ${hours>=24?`${Math.floor(hours/24)} ngày`:`${hours} giờ`}`,tone:"overdue"};
  }
  return {label:run.quality === "unmet"?"Cần khắc phục":"Chưa đến hạn",tone:run.quality === "unmet"?"pending_review":"unknown"};
}
