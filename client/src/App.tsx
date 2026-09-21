import { useCallback, useEffect, useRef, useState } from "react";
import type { Catalog, FloorPlan, Layout, Requirements } from "../../shared/types";
import { generateLayout, getCatalog, getSampleRequirements } from "./lib/api";
import Header from "./components/Header";
import PlanScreen from "./screens/PlanScreen";
import RequirementsScreen from "./screens/RequirementsScreen";
import ResultScreen from "./screens/ResultScreen";
import WalkScreen from "./screens/WalkScreen";

/** Optional deep link for demos: #sample=large-open-floor&step=walk&tp=3&view=top */
function readDeepLink() {
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const step = h.get("step");
  return { step: step === "requirements" ? 1 : step === "result" ? 2 : step === "walk" ? 3 : null, tp: h.has("tp") ? Number(h.get("tp")) : undefined, top: h.get("view") === "top" };
}

export default function App() {
  const [step, setStep] = useState(0);
  const [plan, setPlan] = useState<FloorPlan | null>(null);
  const [sampleId, setSampleId] = useState<string | null>(null);
  const [req, setReq] = useState<Requirements | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visitedReq, setVisitedReq] = useState(false);
  const deep = useRef(readDeepLink());
  const deepDone = useRef(false);

  useEffect(() => {
    getCatalog().then(setCatalog).catch((e) => setError((e as Error).message));
  }, []);

  const onPlan = useCallback((p: FloorPlan | null, id: string | null) => {
    setPlan((prev) => {
      if (prev?.id !== p?.id) {
        setLayout(null);
        setReq(null);
      }
      return p;
    });
    setSampleId(id);
  }, []);

  const generate = useCallback(
    async (r: Requirements, p: FloorPlan | null = plan) => {
      if (!p) return;
      setGenerating(true);
      setError(null);
      try {
        const l = await generateLayout(p, r);
        setReq(r);
        setLayout(l);
        setStep(2);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setGenerating(false);
      }
    },
    [plan],
  );

  // Demo deep link: load the sample's own brief, generate, and jump to the requested screen.
  useEffect(() => {
    const d = deep.current;
    if (deepDone.current || d.step === null || !plan || !sampleId || !catalog) return;
    deepDone.current = true;
    (async () => {
      try {
        const r = await getSampleRequirements(sampleId);
        setVisitedReq(true);
        if (d.step === 1) return setStep(1);
        const l = await generateLayout(plan, r);
        setReq(r);
        setLayout(l);
        setStep(d.step!);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [plan, sampleId, catalog]);

  const reached = layout ? 3 : plan ? 1 : 0;
  const go = (i: number) => {
    if (i === 1) setVisitedReq(true);
    setStep(i);
  };

  return (
    <div className="min-h-full">
      <Header current={step} reached={reached} onStep={go} />

      {error && (
        <div role="alert" className="mx-auto mt-4 max-w-[1180px] rounded-2xl border border-danger/25 bg-danger-soft px-5 py-3 text-[14px] text-danger">
          {error}
        </div>
      )}

      <PlanScreen visible={step === 0} onPlan={onPlan} onContinue={() => go(1)} />

      {plan && visitedReq && (
        <div className={step === 1 ? "" : "hidden"}>
          <RequirementsScreen key={plan.id} plan={plan} sampleId={sampleId} onBack={() => setStep(0)} onGenerate={(r) => generate(r)} generating={generating} />
        </div>
      )}

      {step === 2 && plan && layout && catalog && <ResultScreen plan={plan} layout={layout} catalog={catalog} projectName={req?.projectName} onBack={() => setStep(1)} onWalk={() => setStep(3)} />}

      {step === 3 && plan && layout && catalog && (
        <WalkScreen plan={plan} layout={layout} catalog={catalog} onBack={() => setStep(2)} initialTeleport={deep.current.tp} initialTop={deep.current.top} />
      )}
    </div>
  );
}
