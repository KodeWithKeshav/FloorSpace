import { parseJsonLoose, postJson } from "./http";
import { LlmError } from "./types";
import type { LlmResult, VisionProvider, VisionRequest } from "./types";

/** OpenRouter and Groq both speak the OpenAI chat-completions dialect. */
function compat(opts: { name: "openrouter" | "groq"; url: string; keyEnv: string; model: string; extraHeaders?: Record<string, string> }): VisionProvider {
  return {
    name: opts.name,
    model: opts.model,
    available: () => Boolean(process.env[opts.keyEnv]),
    async complete(req: VisionRequest): Promise<LlmResult> {
      const t0 = Date.now();
      // These models don't all support schema-constrained output, so the shape is spelled out in the prompt.
      const system = `${req.system}\n\nReturn ONLY a JSON object matching this JSON Schema:\n${JSON.stringify(req.schema)}`;
      const data = await postJson(
        opts.url,
        { Authorization: `Bearer ${process.env[opts.keyEnv]}`, ...(opts.extraHeaders ?? {}) },
        {
          model: opts.model,
          temperature: req.temperature ?? 0,
          max_tokens: req.maxTokens ?? 8192,
          response_format: { type: "json_object" },
          // Qwen "thinks" before answering by default, which burns tokens and time on a task that needs neither.
          ...(opts.name === "groq" && /qwen/i.test(opts.model) ? { reasoning_effort: "none" } : {}),
          messages: [
            { role: "system", content: system },
            { role: "user", content: [{ type: "text", text: req.user }, { type: "image_url", image_url: { url: `data:${req.mimeType};base64,${req.imageBase64}` } }] },
          ],
        },
      );
      const raw: string = data.choices?.[0]?.message?.content ?? "";
      if (!raw) throw new LlmError("Empty answer", undefined, true);
      return { json: parseJsonLoose(raw), raw, provider: opts.name, model: opts.model, latencyMs: Date.now() - t0 };
    },
  };
}

export const openrouter = () =>
  compat({
    name: "openrouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    keyEnv: "OPENROUTER_API_KEY",
    model: process.env.OPENROUTER_MODEL || (process.env.LLM_PROVIDER === "openrouter" && process.env.LLM_MODEL) || "google/gemini-2.5-flash",
    extraHeaders: { "X-Title": "SpacePlanner" },
  });

export const groq = () =>
  compat({
    name: "groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    keyEnv: "GROQ_API_KEY",
    model: process.env.GROQ_MODEL || (process.env.LLM_PROVIDER === "groq" && process.env.LLM_MODEL) || "qwen/qwen3.8-27b",
  });
