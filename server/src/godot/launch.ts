import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { zipSync } from "fflate";

/** Where a Godot 4 executable might live on this computer. */
export function findGodot(): string | null {
  const candidates = [
    process.env.GODOT_PATH,
    "/Applications/Godot.app/Contents/MacOS/Godot",
    "/Applications/Godot_mono.app/Contents/MacOS/Godot",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Godot", "Godot.exe") : undefined,
    "C:\\Program Files\\Godot\\Godot.exe",
    "/usr/bin/godot4",
    "/usr/local/bin/godot",
    "/usr/bin/godot",
    "/snap/bin/godot-4",
  ];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return null;
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "ignore" });
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`exited with code ${code}`))));
  });
}

/** Imports the models once (so the editor opens instantly), then opens the project in the Godot editor. */
export async function launchGodot(godot: string, projectDir: string): Promise<void> {
  await run(godot, ["--headless", "--path", projectDir, "--import"]);
  const p = spawn(godot, ["--editor", "--path", projectDir], { detached: true, stdio: "ignore" });
  p.on("error", () => undefined);
  p.unref();
}

/** Zips a project folder in memory (skipping Godot's import cache, which it rebuilds on first open). */
export function zipDirectory(dir: string, rootName: string): Buffer {
  const files: Record<string, Uint8Array> = {};
  const walk = (d: string, rel: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === ".godot") continue;
      const abs = path.join(d, e.name);
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(abs, r);
      else files[r] = fs.readFileSync(abs);
    }
  };
  walk(dir, rootName);
  return Buffer.from(zipSync(files, { level: 1 }));
}
