import { loadStorageForm } from "../load";
import { StorageForm } from "../storage-form";

export const metadata = { title: "אפסון ציוד" };

export default async function StoreInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { data, initialPersonId } = await loadStorageForm("in", searchParams);
  return <StorageForm data={data} initialPersonId={initialPersonId} />;
}
