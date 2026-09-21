import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { ValidationIssue, ValidationResult } from "../../../shared/types";
import { issueTarget } from "../lib/plan";

interface Props {
  result: ValidationResult | null;
  parseError: { message: string; line?: number; col?: number } | null;
  onHoverTarget: (key: string | null) => void;
}

export default function ValidationPanel({ result, parseError, onHoverTarget }: Props) {
  if (parseError) {
    return (
      <Shell tone="danger" title="This isn't valid JSON" subtitle={parseError.line ? `Problem near line ${parseError.line}, column ${parseError.col}` : undefined}>
        <p className="px-5 pb-4 text-[13.5px] text-ink-2">{parseError.message}</p>
      </Shell>
    );
  }
  if (!result) return null;

  const errors = result.issues.filter((i) => i.severity === "error");
  const warnings = result.issues.filter((i) => i.severity === "warning");
  const infos = result.issues.filter((i) => i.severity === "info");

  const title = result.valid ? "Floor plan is valid" : `${errors.length} ${errors.length === 1 ? "problem" : "problems"} to fix`;
  const subtitle = result.valid
    ? warnings.length
      ? `Ready to use, with ${warnings.length} ${warnings.length === 1 ? "note" : "notes"} worth a look`
      : "Geometry checks passed. Ready for requirements."
    : "Fix these in your JSON. Hover a row to find it on the plan.";

  return (
    <Shell tone={result.valid ? (warnings.length ? "warn" : "ok") : "danger"} title={title} subtitle={subtitle}>
      {result.issues.length > 0 && (
        <ul className="divide-y divide-line-2 border-t border-line-2">
          {[...errors, ...warnings, ...infos].map((i, k) => (
            <Row key={k} issue={i} onHoverTarget={onHoverTarget} />
          ))}
        </ul>
      )}
    </Shell>
  );
}

const TONES = {
  ok: { bar: "bg-brand", icon: <CircleCheck size={20} className="text-brand" /> },
  warn: { bar: "bg-[#d99a2b]", icon: <TriangleAlert size={20} className="text-warn" /> },
  danger: { bar: "bg-danger", icon: <CircleAlert size={20} className="text-danger" /> },
};

function Shell({ tone, title, subtitle, children }: { tone: keyof typeof TONES; title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <section className="fade-up overflow-hidden rounded-2xl border border-line bg-surface shadow-card" aria-live="polite">
      <div className={`h-1 ${TONES[tone].bar}`} />
      <div className="flex items-start gap-3 px-5 py-4">
        <span className="mt-0.5">{TONES[tone].icon}</span>
        <div>
          <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[13px] text-ink-2">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Row({ issue, onHoverTarget }: { issue: ValidationIssue; onHoverTarget: (k: string | null) => void }) {
  const target = issueTarget(issue.path);
  const icon =
    issue.severity === "error" ? <CircleAlert size={16} className="text-danger" /> : issue.severity === "warning" ? <TriangleAlert size={16} className="text-warn" /> : <Info size={16} className="text-info" />;
  return (
    <li
      onMouseEnter={() => target && onHoverTarget(target)}
      onMouseLeave={() => target && onHoverTarget(null)}
      className={"flex items-start gap-3 px-5 py-3 text-[13.5px] " + (target ? "hover:bg-paper" : "")}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        {issue.path && <code className="mr-2 rounded-md bg-canvas px-1.5 py-0.5 font-mono text-[12px] font-medium text-ink">{issue.path}</code>}
        <span className="text-ink-2">{issue.message}</span>
      </div>
    </li>
  );
}
