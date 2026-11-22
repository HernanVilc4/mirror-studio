import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'

// The protocol package ships TS source, so it must be bundled instead of externalized.
const bundle = { exclude: ['@mirror-studio/protocol'] }
export default defineConfig({
  main: { plugins: [externalizeDepsPlugin(bundle)], build: { rollupOptions: { input: resolve('src/main/index.ts') } } },
  preload: { plugins: [externalizeDepsPlugin(bundle)], build: { rollupOptions: { input: resolve('src/preload/index.ts') } } },
  renderer: { root: 'src/renderer', plugins: [react(), tailwind()], build: { rollupOptions: { input: resolve('src/renderer/index.html') } } }
})
