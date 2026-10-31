import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { api } from './server/api.ts'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'vfs-bench-ui-api',
      configureServer(server) {
        server.middlewares.use(api())
      },
    },
  ],
  server: { host: '127.0.0.1', port: 5174 },
})
