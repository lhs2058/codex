import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "remove-standalone-favicon",
      transformIndexHtml(html) {
        return html.replace(/\s*<link rel="icon"[^>]*>/, "");
      },
    },
    viteSingleFile(),
  ],
  build: {
    outDir: "dist-standalone",
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    copyPublicDir: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
