import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const serverPort = Number(process.env.PORT ?? 47831);

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    port: 47832,
    strictPort: true,
    host: "0.0.0.0",
    proxy: { "/ws": { target: `ws://localhost:${serverPort}`, ws: true } },
  },
  build: { outDir: "dist", sourcemap: false },
});
