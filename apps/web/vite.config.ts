import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  preview: {
    port: 4173,
    proxy: {
      "/api": "http://localhost:3000",
      "/health": "http://localhost:3000"
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/health": "http://localhost:3000"
    }
  }
});
