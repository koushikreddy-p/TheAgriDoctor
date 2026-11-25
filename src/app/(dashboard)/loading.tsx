// Instant placeholder shown while a dashboard page loads its data
// (the sidebar and top bar stay visible). Important on slow rural connections.
export default function Loading() {
  const block = 'animate-pulse rounded-xl bg-slate-200/70'
  return (
    <div className="max-w-6xl mx-auto space-y-6" role="status" aria-label="Loading">
      <div className={`${block} h-28`} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className={`${block} h-28`} />)}
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className={`${block} h-56 lg:col-span-2`} />
        <div className={`${block} h-56`} />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  )
}
