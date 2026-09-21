import https from "node:https";
import os from "node:os";
import express from "express";
import type { FloorPlan, Layout } from "../../shared/types";
import { validateFloorPlan } from "./validation/floorplan";

/**
 * Phone sessions: the laptop publishes the current plan + layout under a short code, and a phone that opens
 * https://<laptop-ip>:5174/phone?code=XXXX fetches it. Held in memory only; nothing is written to disk.
 */
interface Session {
  plan: FloorPlan;
  layout: Layout;
  updatedAt: number;
}

const sessions = new Map<string, Session>();
const PHONE_PORT = Number(process.env.PHONE_PORT ?? 5174);
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function newCode(): string {
  for (;;) {
    const c = Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
    if (!sessions.has(c)) return c;
  }
}

/** IPv4 addresses of this computer on the local network, most likely Wi-Fi first. */
function lanAddresses(): string[] {
  const out: { addr: string; score: number }[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family !== "IPv4" || i.internal) continue;
      const wifi = /^(en0|wlan|wl|wi-?fi)/i.test(name) ? 0 : 1;
      out.push({ addr: i.address, score: wifi });
    }
  }
  return out.sort((a, b) => a.score - b.score).map((x) => x.addr);
}

/** Is the HTTPS phone server (npm run dev:phone) answering on this computer? */
function phoneServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = https.get({ host: "127.0.0.1", port: PHONE_PORT, path: "/", rejectUnauthorized: false, timeout: 1500 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => (req.destroy(), resolve(false)));
  });
}

export function phoneRouter(): express.Router {
  const r = express.Router();

  r.get("/api/phone/info", async (_req, res) => {
    res.json({ addresses: lanAddresses(), port: PHONE_PORT, serverUp: await phoneServerUp() });
  });

  r.post("/api/phone/session", (req, res) => {
    const planResult = validateFloorPlan(req.body?.plan);
    const layout = req.body?.layout as Layout | undefined;
    if (!planResult.valid || !planResult.plan || !layout?.placements) {
      return void res.status(422).json({ error: "Send { plan, layout } from a generated layout" });
    }
    const wanted = typeof req.body?.code === "string" ? req.body.code.toUpperCase() : "";
    const code = sessions.has(wanted) ? wanted : newCode();
    sessions.set(code, { plan: planResult.plan, layout, updatedAt: Date.now() });
    if (sessions.size > 20) sessions.delete(sessions.keys().next().value!);
    res.json({ code, updatedAt: sessions.get(code)!.updatedAt });
  });

  r.get("/api/phone/session/:code", (req, res) => {
    const s = sessions.get(req.params.code.toUpperCase());
    if (!s) return void res.status(404).json({ error: "That code is not active. Start a phone session on the laptop again." });
    res.json(s);
  });

  return r;
}
