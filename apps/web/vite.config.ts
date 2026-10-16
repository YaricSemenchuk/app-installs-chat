import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API = process.env.API_URL ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Один origin в разработке, как и в production: cookie сессии и WebSocket идут через прокси.
    proxy: {
      "/api": { target: API },
      "/ws": { target: API, ws: true },
    },
  },
});
