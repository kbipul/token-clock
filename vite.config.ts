import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Required for GitHub Pages: site serves from /token-clock/
  base: "/token-clock/",
  plugins: [react()],
  test: {
    environment: "node",
  },
});
