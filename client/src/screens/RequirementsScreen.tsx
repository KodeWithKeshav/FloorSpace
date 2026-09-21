import { ArrowLeft, ArrowRight, Check, CircleAlert, Loader2, Plus, Sparkles, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Alternative, FeasibilityResult, FloorPlan, Requirements, ZoneRequest, ZoneType } from "../../../shared/types";
import { checkFeasibility, getSampleRequirements } from "../lib/api";
import { PREFERENCES, STYLES, ZONE_META, ZONE_ORDER, defaultRequirements, defaultZone } from "../lib/requirements";
import Stepper from "../components/Stepper";

interface Props {
  plan: FloorPlan;
  sampleId: string | null;
  onBack: () => void;
  onGenerate: (req: Requirements) => void;
  generating: boolean;
}

export default function RequirementsScreen({ plan, sampleId, onBack, onGenerate, generating }: Props) {
  const [req, setReq] = useState<Requirements | null>(null);
  const [feas, setFeas] = useState<FeasibilityResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  // Start from the sample's suggested brief when there is one.
  useEffect(() => {
    let alive = true;
    const start = async () => {
      if (sampleId) {
        try {
          const r = await getSampleRequirements(sampleId);
          if (alive) return setReq({ ...r, floorPlanId: undefined, expectedOutcome: undefined, expectedResponse: undefined });
        } catch {
          /* fall through to the default brief */
        }
      }
      if (alive) setReq(defaultRequirements());
    };
    start();
    return () => {
      alive = false;
    };
  }, [plan.id, sampleId]);

  // Live feasibility, debounced, ignoring stale answers.
  useEffect(() => {
    if (!req) return;
    const my = ++seq.current;
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const f = await checkFeasibility(plan, req);
        if (my === seq.current) (setFeas(f), setError(null));
      } catch (e) {
        if (my === seq.current) setError((e as Error).message);
      } finally {
        if (my === seq.current) setChecking(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [plan, req]);

  const unused = useMemo(() => ZONE_ORDER.filter((t) => !req?.zones.some((z) => z.type === t)), [req]);

  const updateZone = (type: ZoneType, patch: Partial<ZoneRequest>) => setReq((r) => r && { ...r, zones: r.zones.map((z) => (z.type === type ? { ...z, ...patch } : z)) });
  const removeZone = (type: ZoneType) => setReq((r) => r && { ...r, zones: r.zones.filter((z) => z.type !== type) });
  const addZone = (type: ZoneType) => setReq((r) => r && { ...r, zones: [...r.zones, defaultZone(type)] });

  if (!req) return <div className="mx-auto max-w-[1180px] px-6 py-16 text-ink-2">Loading brief…</div>;

  const canGenerate = req.zones.length > 0 && !generating;
  const infeasible = feas?.status === "infeasible";

  return (
    <div>
      <main className="mx-auto grid max-w-[1180px] gap-8 px-6 pb-32 pt-8 lg:grid-cols-[minmax(0,1fr)_388px]">
        <div className="space-y-6">
          <div>
            <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">What does this floor need to hold?</h1>
            <p className="mt-2 max-w-[60ch] text-[14px] leading-relaxed text-ink-2">
              Tell us the rooms and seats. We check the brief against <strong className="font-semibold text-ink">{plan.name}</strong> as you go, before anything is generated.
            </p>
          </div>

          <label className="block">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">Project name</span>
            <input value={req.projectName ?? ""} onChange={(e) => setReq({ ...req, projectName: e.target.value })} className="mt-2 w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-[15px] text-ink outline-none focus:border-brand" />
          </label>

          <div className="space-y-3">
            {ZONE_ORDER.filter((t) => req.zones.some((z) => z.type === t)).map((type) => {
              const z = req.zones.find((q) => q.type === type)!;
              return <ZoneRow key={type} zone={z} onChange={(p) => updateZone(type, p)} onRemove={() => removeZone(type)} />;
            })}
          </div>

          {unused.length > 0 && (
            <div>
              <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">Add to the brief</div>
              <div className="flex flex-wrap gap-2">
                {unused.map((t) => (
                  <button key={t} onClick={() => addZone(t)} className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-1.5 text-[13px] font-medium text-ink-2 transition hover:border-brand hover:text-brand">
                    <Plus size={13} /> {ZONE_META[t].label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <FeasibilityPanel feas={feas} checking={checking} error={error} onApply={(a) => setReq({ ...a.requirements, projectName: req.projectName })} />
        </aside>
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-[68px] max-w-[1180px] items-center justify-between gap-4 px-6">
          <button onClick={onBack} className="flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-[14px] font-medium text-ink-2 transition hover:border-[#cfcabd] hover:text-ink">
            <ArrowLeft size={16} /> Floor plan
          </button>
          <button
            disabled={!canGenerate}
            onClick={() => onGenerate(req)}
            className="flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-[14px] font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {generating ? "Generating…" : infeasible ? `Generate best fit (${feas?.maxSeats} seats)` : "Generate layout"}
            {!generating && <ArrowRight size={16} />}
          </button>
        </div>
      </footer>
    </div>
  );
}

function ZoneRow({ zone, onChange, onRemove }: { zone: ZoneRequest; onChange: (p: Partial<ZoneRequest>) => void; onRemove: () => void }) {
  const meta = ZONE_META[zone.type];
  const t = zone.type;
  const showCount = t !== "workstation" && t !== "reception";
  const showPref = ["cabin", "meeting", "lounge", "phonebooth", "storage", "pantry", "reception", "cafeteria"].includes(t);
  return (
    <div className="fade-up rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="h-9 w-1.5 rounded-full" style={{ background: meta.color }} />
          <div>
            <div className="text-[15px] font-semibold text-ink">{meta.label}</div>
            <div className="text-[12.5px] text-muted">{meta.hint}</div>
          </div>
        </div>
        <button onClick={onRemove} aria-label={`Remove ${meta.label}`} className="rounded-lg p-1.5 text-muted transition hover:bg-canvas hover:text-danger">
          <X size={16} />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3">
        {t === "workstation" && <Stepper label="Seats" value={zone.seats ?? 1} max={500} onChange={(v) => onChange({ seats: v })} />}
        {t === "workstation" && (
          <Field label="Desk layout">
            <select value={zone.preferredStyle ?? "linear_6pack"} onChange={(e) => onChange({ preferredStyle: e.target.value })} className="h-9 rounded-xl border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-brand">
              {STYLES.concat([{ value: "linear_10pack", label: "10-desk pods" }]).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
        )}
        {showCount && <Stepper label="How many" value={zone.count ?? 1} max={t === "meeting" || t === "cabin" || t === "phonebooth" ? 20 : 4} onChange={(v) => onChange({ count: v })} />}
        {t === "meeting" && <Stepper label="People each" value={zone.capacityEach ?? 6} min={2} max={10} onChange={(v) => onChange({ capacityEach: v })} />}
        {t === "cafeteria" && <Stepper label="Seats" value={zone.seats ?? 16} min={4} max={80} step={4} onChange={(v) => onChange({ seats: v })} />}
        {showPref && (
          <Field label="Position">
            <select value={zone.preference ?? "none"} onChange={(e) => onChange({ preference: e.target.value as ZoneRequest["preference"] })} className="h-9 rounded-xl border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-brand">
              {PREFERENCES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Field>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">{label}</span>
      {children}
    </label>
  );
}

const TONE = {
  ok: { bar: "bg-brand", pill: "bg-brand-soft text-brand-600", label: "Fits comfortably", icon: <Check size={14} /> },
  tight: { bar: "bg-[#d99a2b]", pill: "bg-warn-soft text-warn", label: "Fits, but tightly", icon: <TriangleAlert size={14} /> },
  infeasible: { bar: "bg-danger", pill: "bg-danger-soft text-danger", label: "Does not fit", icon: <CircleAlert size={14} /> },
} as const;

function FeasibilityPanel({ feas, checking, error, onApply }: { feas: FeasibilityResult | null; checking: boolean; error: string | null; onApply: (a: Alternative) => void }) {
  if (error) return <div role="alert" className="rounded-2xl border border-danger/25 bg-danger-soft p-4 text-[13.5px] text-danger">{error}</div>;
  if (!feas) return <div className="h-64 animate-pulse rounded-2xl border border-line bg-surface" />;
  const tone = TONE[feas.status];
  const ratio = feas.requestedSeats > 0 ? Math.min(1, feas.maxSeats / feas.requestedSeats) : 1;
  return (
    <section className={"overflow-hidden rounded-2xl border border-line bg-surface shadow-card transition " + (checking ? "opacity-70" : "")} aria-live="polite">
      <div className={`h-1 ${tone.bar}`} />
      <div className="p-5">
        <div className="flex items-center justify-between">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-semibold ${tone.pill}`}>{tone.icon}{tone.label}</span>
          {checking && <Loader2 size={15} className="animate-spin text-muted" />}
        </div>
        <p className="mt-3 text-[14px] leading-relaxed text-ink">{feas.headline}</p>

        <dl className="mt-4 grid grid-cols-2 gap-3">
          <Stat label="Floor area" value={`${Math.round(feas.floorAreaSqM).toLocaleString()} m²`} />
          <Stat label="Usable area" value={`${Math.round(feas.usableAreaSqM).toLocaleString()} m²`} />
        </dl>

        {feas.requestedSeats > 0 && (
          <div className="mt-4">
            <div className="flex items-baseline justify-between text-[13px]">
              <span className="text-ink-2">Desk seats that fit</span>
              <span className="font-semibold tabular-nums text-ink">{feas.maxSeats} <span className="font-normal text-muted">of {feas.requestedSeats}</span></span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-canvas">
              <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${Math.round(ratio * 100)}%`, transition: "width .4s ease" }} />
            </div>
          </div>
        )}
      </div>

      {feas.alternatives.length > 0 && (
        <div className="border-t border-line-2 p-5">
          <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">What would fit</div>
          <ul className="mt-3 space-y-2.5">
            {feas.alternatives.map((a) => (
              <li key={a.id} className="rounded-xl border border-line-2 bg-paper p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[13.5px] font-semibold text-ink">{a.title}</div>
                    <div className="mt-0.5 text-[12.5px] leading-snug text-ink-2">{a.detail}</div>
                  </div>
                  <button onClick={() => onApply(a)} className="shrink-0 rounded-lg bg-brand-soft px-2.5 py-1.5 text-[12.5px] font-semibold text-brand-600 transition hover:bg-brand hover:text-white">
                    Apply
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-canvas px-3.5 py-2.5">
      <dt className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">{label}</dt>
      <dd className="mt-0.5 text-[16px] font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  );
}
