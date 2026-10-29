import { redirect } from "next/navigation";

type ManagerEntryParams = Record<string, string | string[] | undefined>;

// Installed shortcuts and old bookmarks use the same dashboard and access checks.
export default async function ManagerEntryPage({
  searchParams,
}: {
  searchParams?: Promise<ManagerEntryParams>;
}) {
  const params = await searchParams;
  const branch = params?.branch;
  const validBranch = typeof branch === "string"
    && (branch === "all" || /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(branch));
  redirect(validBranch ? `/?branch=${encodeURIComponent(branch)}` : "/");
}
