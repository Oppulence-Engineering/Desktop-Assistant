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
    rollupOptions: {
      // A second entry for the always-on-top recording indicator. It is a separate
      // document rather than a route because it loads in its own BrowserWindow, and
      // pulling the 4 MB app bundle into a 264-pixel pill would be absurd.
      input: {
        main: path.resolve(__dirname, "index.html"),
        indicator: path.resolve(__dirname, "indicator.html"),
      },
    },
  },
});
