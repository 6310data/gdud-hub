import { Skeleton, Spinner } from "@gdud/ui";

/** Shown while a page's data loads (loading.tsx): a spinner line and the page's rough shape. */
export function PageLoading({ label = "טוען…", kpis = 4 }: { label?: string; kpis?: number }) {
  return (
    <div className="flex flex-col gap-[22px]" aria-busy="true">
      <div className="flex flex-col gap-2">
        <span className="tz-footnote flex items-center gap-2" role="status">
          <Spinner size={14} />
          {label}
        </span>
        <Skeleton height={34} width="min(280px, 70%)" />
      </div>
      {kpis ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
          {Array.from({ length: kpis }, (_, i) => (
            <Skeleton key={i} height={112} />
          ))}
        </div>
      ) : null}
      <Skeleton height={88} />
      <Skeleton height={280} />
    </div>
  );
}
