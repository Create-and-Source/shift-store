import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// vite 8 (rolldown) can emit the same [hash] filename for different content,
// which poisons immutable browser caches — stamp filenames per build instead.
const stamp = Date.now().toString(36)

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-${stamp}.js`,
        chunkFileNames: `assets/[name]-${stamp}-[hash].js`,
        assetFileNames: `assets/[name]-${stamp}[extname]`,
      },
    },
  },
})
