import { Minus, Plus } from "lucide-react";

interface Props {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  label: string;
  suffix?: string;
}

export default function Stepper({ value, min = 1, max = 999, step = 1, onChange, label, suffix }: Props) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">{label}</span>
      <div className="flex items-center rounded-xl border border-line bg-surface">
        <button aria-label={`Decrease ${label}`} onClick={() => onChange(clamp(value - step))} disabled={value <= min} className="flex h-9 w-9 items-center justify-center rounded-l-xl text-ink-2 transition hover:bg-canvas disabled:opacity-30">
          <Minus size={14} />
        </button>
        <input
          value={value}
          inputMode="numeric"
          onChange={(e) => {
            const n = parseInt(e.target.value.replace(/\D/g, ""), 10);
            if (!Number.isNaN(n)) onChange(clamp(n));
          }}
          className="h-9 w-14 border-x border-line-2 bg-transparent text-center text-[14px] font-semibold tabular-nums text-ink outline-none"
        />
        <button aria-label={`Increase ${label}`} onClick={() => onChange(clamp(value + step))} disabled={value >= max} className="flex h-9 w-9 items-center justify-center rounded-r-xl text-ink-2 transition hover:bg-canvas disabled:opacity-30">
          <Plus size={14} />
        </button>
      </div>
      {suffix && <span className="sr-only">{suffix}</span>}
    </div>
  );
}
