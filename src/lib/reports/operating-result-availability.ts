export function operatingResultAvailable(value: { cogsComplete: boolean; operatingExpenseComplete?: boolean }) {
  return value.cogsComplete && value.operatingExpenseComplete !== false;
}
