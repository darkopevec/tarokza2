import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/socket.io': { target: 'http://127.0.0.1:3000', ws: true }, '/health': 'http://127.0.0.1:3000', '/ready': 'http://127.0.0.1:3000' } },
});
