import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  base: "./", // Use relative paths for assets (required for Electron custom protocol)
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    fs: {
      // Electron imports the authenticated web console's canonical product
      // theme directly so both surfaces remain visually locked together.
      allow: [path.resolve(__dirname, "../../../..")],
    },
  },
  build: {
    outDir: "dist",
  },
});
