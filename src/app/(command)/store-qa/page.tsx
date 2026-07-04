import { auditStore, type StoreQaReport } from "@/lib/ajax/store-qa/audit";
import { fetchStoreListingsForQa } from "@/lib/ajax/store-qa/queries";
import { createClient } from "@/lib/supabase/server";

function configReady() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

const SEV_CLASS: Record<string, string> = {
  critical: "border-red-500/40 bg-red-500/10 text-red-200",
  warning: "border-amber-500/40 bg-amber-500/10 text-amber-100",
  info: "border-sky-500/40 bg-sky-500/10 text-sky-100",
};

function scoreColor(score: number): string {
  if (score >= 80) return "text-emerald-400";
  if (score >= 60) return "text-amber-400";
  return "text-red-400";
}

export default async function StoreQaPage() {
  const ready = configReady();
  let authed = false;
  let report: StoreQaReport | null = null;

  if (ready) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        authed = true;
        report = auditStore(await fetchStoreListingsForQa(supabase, user.id));
      }
    } catch (err) {
      console.error("[store-qa page] failed", err);
    }
  }

  if (!ready || !authed) {
    return (
      <div className="factory-panel panel-glow-orange max-w-xl">
        <h1 className="text-xl font-bold">Store QA</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Sign in to run a whole-shop quality sweep.
        </p>
      </div>
    );
  }

  const r = report!;

  return (
    <div className="space-y-6">
      <header className="factory-panel">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--accent-blue)]">
          Store QA · professionalism sweep
        </p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">
              Shop health
            </h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {r.listingCount} listing{r.listingCount === 1 ? "" : "s"} scanned ·{" "}
              <span className="text-red-300">{r.counts.critical} critical</span>,{" "}
              <span className="text-amber-200">{r.counts.warning} warnings</span>,{" "}
              <span className="text-sky-200">{r.counts.info} tips</span>
            </p>
          </div>
          <div className="text-right">
            <span className="font-mono text-[10px] uppercase text-[var(--text-muted)]">
              Score
            </span>
            <p
              className={`font-mono text-4xl font-bold tabular-nums ${scoreColor(
                r.overallScore,
              )}`}
            >
              {r.overallScore}
              <span className="text-base text-[var(--text-muted)]">/100</span>
            </p>
          </div>
        </div>
      </header>

      {r.listingCount === 0 ? (
        <div className="factory-panel text-center">
          <p className="text-lg font-semibold">No listings to audit yet</p>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Run a factory cycle — approved listings show up here for a store-wide QA sweep.
          </p>
        </div>
      ) : (
        <>
          {r.storeFlags.length > 0 ? (
            <section className="factory-panel">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Store-level flags
              </h2>
              <ul className="mt-3 space-y-2">
                {r.storeFlags.map((f) => (
                  <li
                    key={f.code}
                    className={`rounded-md border px-3 py-2 text-sm ${SEV_CLASS[f.severity]}`}
                  >
                    <p className="font-medium">{f.message}</p>
                    <p className="mt-1 opacity-90">Fix: {f.fix}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {r.topFixes.length > 0 ? (
            <section className="factory-panel panel-glow-blue">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--accent-blue)]">
                Do these first
              </h2>
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-[var(--foreground)]">
                {r.topFixes.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ol>
            </section>
          ) : null}

          <section className="space-y-3">
            {r.listings
              .slice()
              .sort((a, b) => a.score - b.score)
              .map((l) => (
                <article key={l.listingId} className="factory-panel">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-semibold text-[var(--foreground)]">
                      {l.title}
                    </h3>
                    <span
                      className={`shrink-0 font-mono text-lg font-bold ${scoreColor(l.score)}`}
                    >
                      {l.score}
                    </span>
                  </div>
                  {l.issues.length === 0 ? (
                    <p className="mt-2 text-xs text-emerald-300">
                      Clean — no issues found.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {l.issues.map((i) => (
                        <li
                          key={i.code}
                          className={`rounded border px-2.5 py-1.5 text-xs ${SEV_CLASS[i.severity]}`}
                        >
                          <span className="font-semibold uppercase">
                            {i.severity}
                          </span>{" "}
                          · {i.message}{" "}
                          <span className="opacity-80">— {i.fix}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
          </section>
        </>
      )}
    </div>
  );
}
