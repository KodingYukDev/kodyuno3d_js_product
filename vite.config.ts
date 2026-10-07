import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@kodyuno': fileURLToPath(new URL('./src/engine', import.meta.url)) } },
  server: { port: 5183 },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
})
