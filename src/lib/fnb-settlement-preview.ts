/** Preview the existing server settlement rule; RPC remains authoritative. */
export function previewFnbSettlement(grossBeforeTip: number, tip = 0, commissionPercent = 0) {
  const gross = Math.max(0, grossBeforeTip + tip);
  const commission = Math.round(gross * Math.min(100, Math.max(0, commissionPercent)) / 100);
  return { gross, commission, net: Math.max(0, gross - commission) };
}
