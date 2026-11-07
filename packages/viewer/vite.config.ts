import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "connect-src 'self' http: https: ws: wss:",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: mediastream:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
].join("; ");

const productionCsp = {
  name: "production-csp",
  apply: "build" as const,
  transformIndexHtml: () => [
    { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: csp }, injectTo: "head-prepend" as const },
  ],
};

const serverPort = Number(process.env.PORT ?? 47831);

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), productionCsp],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    port: 47832,
    strictPort: true,
    host: "0.0.0.0",
    proxy: {
      "/ws": { target: `ws://localhost:${serverPort}`, ws: true },
      "/api": { target: `http://localhost:${serverPort}` },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
