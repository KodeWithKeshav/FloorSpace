import { parseJsonLoose, postJson } from "./http";
import { LlmError } from "./types";
import type { LlmResult, VisionProvider, VisionRequest } from "./types";

/** Gemini's responseSchema wants upper-case OpenAPI types and no unsupported keywords. */
function toGeminiSchema(s: any): any {
  if (Array.isArray(s)) return s.map(toGeminiSchema);
  if (!s || typeof s !== "object") return s;
  const out: any = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "additionalProperties" || k === "$schema" || k === "title") continue;
    if (k === "type" && typeof v === "string") out.type = v.toUpperCase();
    else if (k === "properties") out.properties = Object.fromEntries(Object.entries(v as object).map(([pk, pv]) => [pk, toGeminiSchema(pv)]));
    else out[k] = toGeminiSchema(v);
  }
  return out;
}

export function gemini(): VisionProvider {
  const model = process.env.GEMINI_MODEL || (process.env.LLM_PROVIDER === "gemini" && process.env.LLM_MODEL) || "gemini-2.5-flash";
  return {
    name: "gemini",
    model,
    available: () => Boolean(process.env.GEMINI_API_KEY),
    async complete(req: VisionRequest): Promise<LlmResult> {
      const t0 = Date.now();
      const data = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        { "x-goog-api-key": process.env.GEMINI_API_KEY! },
        {
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: "user", parts: [{ text: req.user }, { inline_data: { mime_type: req.mimeType, data: req.imageBase64 } }] }],
          generationConfig: {
            temperature: req.temperature ?? 0,
            maxOutputTokens: req.maxTokens ?? 8192,
            responseMimeType: "application/json",
            responseSchema: toGeminiSchema(req.schema),
            // Reading a drawing is perception, not reasoning: thinking tokens only eat the output budget and truncate the JSON.
            ...(/2\.5/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          },
        },
      );
      const cand = data.candidates?.[0];
      const raw: string = (cand?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
      if (!raw) throw new LlmError(data.promptFeedback?.blockReason ? `Blocked: ${data.promptFeedback.blockReason}` : `No answer (${cand?.finishReason ?? "unknown"})`, undefined, true);
      return { json: parseJsonLoose(raw), raw, provider: "gemini", model, latencyMs: Date.now() - t0 };
    },
  };
}
