export default function MissionLoading() {
  return (
    <main className="mx-auto max-w-[1180px] px-4 py-7 md:px-7">
      <div className="h-4 w-40 rounded bg-white/[0.06]" />
      <div className="mt-6 h-8 w-full max-w-[520px] rounded bg-white/[0.06]" />
      <section className="mt-8 grid grid-cols-1 gap-[18px] lg:grid-cols-3">
        <div className="h-72 rounded-[8px] border border-line bg-card" />
        <div className="h-72 rounded-[8px] border border-line bg-card" />
        <div className="h-72 rounded-[8px] border border-line bg-card" />
      </section>
    </main>
  );
}
