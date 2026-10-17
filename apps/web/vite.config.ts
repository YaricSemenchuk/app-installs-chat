import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API = process.env.API_URL ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  // LiveKit грузится лениво, при первом звонке. Без предсборки Vite нашёл бы его только тогда и перезагрузил страницу посреди звонка.
  optimizeDeps: { include: ["livekit-client", "@livekit/components-react"] },
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
