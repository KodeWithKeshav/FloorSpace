export interface VisionRequest {
  system: string;
  user: string;
  /** Raw base64 (no data: prefix). */
  imageBase64: string;
  mimeType: string;
  /** JSON Schema (draft-07 style subset) describing the answer. */
  schema: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
}

export interface LlmResult {
  json: unknown;
  raw: string;
  provider: "gemini" | "openrouter" | "groq";
  model: string;
  latencyMs: number;
}

export interface VisionProvider {
  name: LlmResult["provider"];
  model: string;
  available: () => boolean;
  complete: (req: VisionRequest) => Promise<LlmResult>;
}

export class LlmError extends Error {
  constructor(message: string, readonly status?: number, readonly retryable = false) {
    super(message);
  }
}
