import { LlmError } from "./types";

/** Parse a model's text as JSON, tolerating code fences and stray prose around the object. */
export function parseJsonLoose(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(t.slice(a, b + 1));
      } catch {
        /* fall through */
      }
    }
    throw new LlmError("The model did not return valid JSON", undefined, true);
  }
}

/** POST JSON with a hard timeout and two retries (429 / 5xx / network) with backoff. */
export async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs = 75_000): Promise<any> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: ctl.signal });
      const text = await res.text();
      if (res.ok) return JSON.parse(text);
      const retryable = res.status === 429 || res.status >= 500;
      const msg = (() => {
        try {
          const j = JSON.parse(text);
          return j.error?.message ?? j.error ?? text;
        } catch {
          return text;
        }
      })();
      last = new LlmError(`${res.status}: ${String(msg).slice(0, 300)}`, res.status, retryable);
      if (!retryable) throw last;
      // Rate limits say how long to wait ("try again in 9.6s" / Retry-After): honour it, up to 65 s.
      const hinted = /try again in ([\d.]+)\s*(ms|s)/i.exec(String(msg));
      const secs = res.headers.get("retry-after") ? Number(res.headers.get("retry-after")) : hinted ? Number(hinted[1]) / (hinted[2].toLowerCase() === "ms" ? 1000 : 1) : 0;
      if (res.status === 429 && secs > 0 && secs <= 65) {
        await new Promise((r) => setTimeout(r, secs * 1000 + 500));
        continue;
      }
    } catch (e) {
      if (e instanceof LlmError && !e.retryable) throw e;
      last = e instanceof LlmError ? e : new LlmError(e instanceof Error && e.name === "AbortError" ? "The request timed out" : `Network error: ${(e as Error).message}`, undefined, true);
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
  }
  throw last;
}
