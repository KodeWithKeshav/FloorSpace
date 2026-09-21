import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const apiPort = process.env.PORT ?? "3001";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  publicDir: "../public",
  server: {
    port: 5173,
    fs: { allow: [".."] },
    proxy: { "/api": `http://localhost:${apiPort}` },
  },
});
