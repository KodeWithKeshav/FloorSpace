import { FileJson, Upload, ClipboardPaste } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  onText: (text: string, name: string) => void;
  active: boolean;
  busy: boolean;
}

export default function UploadPanel({ onText, active, busy }: Props) {
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [dragging, setDragging] = useState(false);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);

  const readFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      setFileName(file.name);
      const reader = new FileReader();
      reader.onload = () => onText(String(reader.result ?? ""), file.name);
      reader.readAsText(file);
    },
    [onText],
  );

  // Live validation while pasting, debounced so typing stays smooth.
  useEffect(() => {
    if (mode !== "paste" || !text.trim()) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onText(text, "Pasted plan"), 450);
    return () => window.clearTimeout(timer.current);
  }, [text, mode, onText]);

  return (
    <div className={"rounded-2xl border bg-surface " + (active ? "border-brand shadow-card" : "border-line")}>
      <div className="flex gap-1 border-b border-line-2 p-1.5">
        <Tab on={mode === "file"} onClick={() => setMode("file")} icon={<Upload size={14} />} label="Upload file" />
        <Tab on={mode === "paste"} onClick={() => setMode("paste")} icon={<ClipboardPaste size={14} />} label="Paste JSON" />
      </div>

      {mode === "file" ? (
        <div className="p-3">
          <div
            onDragOver={(e) => (e.preventDefault(), setDragging(true))}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              readFile(e.dataTransfer.files[0]);
            }}
            onClick={() => input.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
            className={
              "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-7 text-center transition " +
              (dragging ? "border-brand bg-brand-soft" : "border-line hover:border-[#cfcabd] hover:bg-paper")
            }
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-canvas text-ink-2">
              <FileJson size={20} />
            </span>
            <div className="text-[13.5px] font-medium text-ink">{busy ? "Checking…" : "Drop a floor plan .json here"}</div>
            <div className="text-[12.5px] text-muted">{fileName ? fileName : "or click to browse"}</div>
            <input ref={input} type="file" accept=".json,application/json" className="hidden" onChange={(e) => (readFile(e.target.files?.[0]), (e.target.value = ""))} />
          </div>
          <a href="/api/schemas/floorplan" target="_blank" rel="noreferrer" className="mt-3 block text-center text-[12.5px] font-medium text-brand hover:underline">
            View the floor plan format (JSON Schema)
          </a>
        </div>
      ) : (
        <div className="p-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            placeholder={'{\n  "schemaVersion": "1.0",\n  "id": "my-floor",\n  ...\n}'}
            className="h-44 w-full resize-y rounded-xl border border-line bg-paper p-3 font-mono text-[12px] leading-relaxed text-ink outline-none placeholder:text-muted focus:border-brand"
          />
          <div className="mt-2 text-[12.5px] text-muted">Checked automatically as you paste.</div>
        </div>
      )}
    </div>
  );
}

function Tab({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={"flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[13px] font-medium transition " + (on ? "bg-canvas text-ink" : "text-muted hover:text-ink-2")}
    >
      {icon}
      {label}
    </button>
  );
}
