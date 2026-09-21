import { useRef, useState } from "react";
import type { MutableRefObject } from "react";

/** On-screen thumb stick. Writes a vector in [-1, 1] (x right, y forward) into a ref. */
export default function Joystick({ value, label }: { value: MutableRefObject<{ x: number; y: number }>; label: string }) {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const origin = useRef<{ x: number; y: number; id: number } | null>(null);
  const R = 46;

  const set = (dx: number, dy: number) => {
    const l = Math.hypot(dx, dy);
    const k = l > R ? R / l : 1;
    const x = dx * k, y = dy * k;
    setKnob({ x, y });
    value.current = { x: x / R, y: -y / R };
  };

  return (
    <div
      role="application"
      aria-label={label}
      className="pointer-events-auto relative h-[124px] w-[124px] touch-none select-none rounded-full border border-white/40 bg-black/25 backdrop-blur"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const r = e.currentTarget.getBoundingClientRect();
        origin.current = { x: r.left + r.width / 2, y: r.top + r.height / 2, id: e.pointerId };
        set(e.clientX - origin.current.x, e.clientY - origin.current.y);
      }}
      onPointerMove={(e) => origin.current && e.pointerId === origin.current.id && set(e.clientX - origin.current.x, e.clientY - origin.current.y)}
      onPointerUp={() => ((origin.current = null), set(0, 0))}
      onPointerCancel={() => ((origin.current = null), set(0, 0))}
    >
      <div className="absolute left-1/2 top-1/2 h-[52px] w-[52px] rounded-full bg-white/85 shadow-lg" style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }} />
    </div>
  );
}
