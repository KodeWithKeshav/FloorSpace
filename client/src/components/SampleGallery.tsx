import { Ruler, TriangleAlert } from "lucide-react";
import type { SampleSummary } from "../../../shared/types";

import type { DrawPlan } from "../lib/plan";
import PlanPreview from "./PlanPreview";

interface Props {
  samples: SampleSummary[];
  thumbs: Record<string, DrawPlan | null>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function SampleGallery({ samples, thumbs, selectedId, onSelect }: Props) {
  return (
    <ul className="space-y-2.5">
      {samples.map((s) => {
        const active = s.id === selectedId;
        const thumb = thumbs[s.id];
        const infeasible = s.brief?.expectedOutcome === "infeasible";
        return (
          <li key={s.id}>
            <button
              onClick={() => onSelect(s.id)}
              aria-pressed={active}
              className={
                "group flex w-full items-stretch gap-3.5 rounded-2xl border p-2.5 text-left transition " +
                (active ? "border-brand bg-brand-soft/60 shadow-card" : "border-line bg-surface hover:border-[#cfcabd] hover:shadow-card")
              }
            >
              <div className="h-[76px] w-[104px] shrink-0 overflow-hidden rounded-xl border border-line-2 bg-canvas p-1">
                {thumb ? <PlanPreview plan={thumb} mini /> : <div className="h-full w-full animate-pulse rounded-lg bg-line-2" />}
              </div>
              <div className="min-w-0 flex-1 py-0.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="truncate text-[14px] font-semibold text-ink">{s.name}</div>
                  {!s.valid && <TriangleAlert size={15} className="mt-0.5 shrink-0 text-danger" aria-label="Has validation errors" />}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-2">
                  {s.stats && (
                    <>
                      <span className="tabular-nums">{Math.round(s.stats.floorAreaSqM).toLocaleString()} m²</span>
                      <span className="text-line">•</span>
                      <span>{s.stats.shape}</span>
                    </>
                  )}
                </div>
                {s.brief && (
                  <div
                    className={
                      "mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium " +
                      (infeasible ? "bg-warn-soft text-warn" : "bg-canvas text-ink-2")
                    }
                  >
                    <Ruler size={11} />
                    {infeasible ? `Won't fit ${s.brief.workstationSeats} seats` : `Sample brief · ${s.brief.workstationSeats} seats`}
                  </div>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}


