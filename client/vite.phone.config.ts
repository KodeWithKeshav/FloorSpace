import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

// A second dev server for phones. WebXR only runs on secure origins, so this one serves HTTPS on the local
// network with a throw-away self-signed certificate. The main dev server (vite.config.ts) is unchanged.
const apiPort = process.env.PORT ?? "3001";

export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
  publicDir: "../public",
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    fs: { allow: [".."] },
    proxy: { "/api": `http://localhost:${apiPort}` },
  },
});
