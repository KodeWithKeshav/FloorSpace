import { gemini } from "./gemini";
import { groq, openrouter } from "./openai-compat";
import type { LlmResult, VisionProvider, VisionRequest } from "./types";

/** Providers in the order they are tried: the configured one first, then Gemini, OpenRouter, Groq. */
export function visionProviders(): VisionProvider[] {
  const all = [gemini(), openrouter(), groq()];
  const preferred = process.env.LLM_PROVIDER;
  return [...all.filter((p) => p.name === preferred), ...all.filter((p) => p.name !== preferred)].filter((p) => p.available());
}

export const anyVisionProvider = () => visionProviders().length > 0;

/** Try each configured provider until one answers. The error lists what every one said. */
export async function completeVision(req: VisionRequest): Promise<LlmResult> {
  const providers = visionProviders();
  if (providers.length === 0) throw new Error("No AI key is configured. Add GEMINI_API_KEY (or OPENROUTER_API_KEY / GROQ_API_KEY) to .env and restart.");
  const errors: string[] = [];
  for (const p of providers) {
    try {
      return await p.complete(req);
    } catch (e) {
      errors.push(`${p.name} (${p.model}): ${(e as Error).message}`);
      console.warn(`[llm] ${p.name} failed: ${(e as Error).message}`);
    }
  }
  throw new Error(`Every AI provider failed. ${errors.join(" | ")}`);
}
