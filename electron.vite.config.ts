import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Three parts, built separately:
//   main     = the Windows program itself (opens the window, later: printer, drawer, local database)
//   preload  = the small, safe bridge between that program and the screen
//   renderer = the screen the cashier sees (React)
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react()],
  },
})
