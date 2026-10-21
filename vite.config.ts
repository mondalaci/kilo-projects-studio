import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // The Electron main process loads this dev server URL directly, so the HMR
  // websocket can use the same host and port.
  server: {
    host: "127.0.0.1",
    port: 5273,
    strictPort: true,
  },
  build: {
    target: "es2022",
  },
})
