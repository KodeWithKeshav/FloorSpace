import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { getHealth } from "../lib/api";
import type { Health } from "../lib/api";

const STEPS = [
  { key: "plan", label: "Floor plan" },
  { key: "requirements", label: "Requirements" },
  { key: "result", label: "Layout" },
  { key: "walk", label: "Walkthrough" },
];

export default function Header({ current = 0, reached = 0, onStep }: { current?: number; reached?: number; onStep?: (i: number) => void }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1480px] items-center gap-6 px-6">
        <Brand />
        <nav aria-label="Progress" className="mx-auto hidden md:block">
          <ol className="flex items-center gap-1.5">
            {STEPS.map((s, i) => {
              const done = i < current;
              const active = i === current;
              const enabled = i <= reached;
              return (
                <li key={s.key} className="flex items-center gap-1.5" aria-current={active ? "step" : undefined}>
                  <button
                    disabled={!enabled}
                    onClick={() => onStep?.(i)}
                    className={
                      "flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 text-[13px] font-medium transition-colors " +
                      (active ? "bg-brand-soft text-brand-600" : enabled ? "text-ink-2 hover:bg-canvas" : "cursor-default text-muted")
                    }
                  >
                    <span
                      className={
                        "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold " +
                        (active ? "bg-brand text-white" : done ? "bg-brand/15 text-brand" : "border border-line bg-surface text-muted")
                      }
                    >
                      {done ? <Check size={12} strokeWidth={3} /> : i + 1}
                    </span>
                    {s.label}
                  </button>
                  {i < STEPS.length - 1 && <span className="h-px w-6 bg-line" aria-hidden />}
                </li>
              );
            })}
          </ol>
        </nav>
        <ServerStatus />
      </div>
    </header>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="9" fill="#0f6b5c" />
        <path d="M8 9h9v6h7v8H8z" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
        <path d="M8 15h5" stroke="#fff" strokeWidth="2" />
      </svg>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight text-ink">SpacePlanner</div>
        <div className="text-[11.5px] text-muted">Workplace layout studio</div>
      </div>
    </div>
  );
}

function ServerStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  const [down, setDown] = useState(false);

  useEffect(() => {
    let alive = true;
    const ping = () =>
      getHealth()
        .then((h) => alive && (setHealth(h), setDown(false)))
        .catch(() => alive && setDown(true));
    ping();
    const t = setInterval(ping, 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const anyKey = health && Object.values(health.providers).some(Boolean);
  const label = down ? "Server offline" : !health ? "Connecting…" : anyKey ? "AI-assisted mode" : "Offline mode";
  const dot = down ? "bg-danger" : !health ? "bg-muted" : "bg-brand";
  const title = down
    ? "The backend is not reachable. Start it with npm run dev."
    : anyKey
      ? "An LLM provider key is configured; zoning can be AI-assisted."
      : "No API keys set: layouts use the built-in rule-based engine, no network needed.";

  return (
    <div title={title} className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-2">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </div>
  );
}
