import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: { outDir: "dist", target: "es2022", sourcemap: false },
  server: { host: true, port: 5173 },
});
