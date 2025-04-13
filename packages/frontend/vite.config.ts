import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on mode (development, production)
  // assumes .env files are in the root of the frontend package
  const env = loadEnv(mode, path.resolve(__dirname, './'), '');

  // Determine backend URL (adjust if backend runs elsewhere)
  const backendPort = env.VITE_BACKEND_PORT || 3001;
  //const backendUrl = `http://localhost:${backendPort}`;
  const backendUrl = "https://57c9-189-216-169-29.ngrok-free.app/"
  console.log(`[Vite Config] Proxying /api to backend at: ${backendUrl}`);

  return {
    plugins: [react()],
    server: {
      port: 5173, // Default Vite port
      host: true, // Listen on all addresses (useful for Docker/VMs)
      proxy: {
        // Proxy API requests starting with /api to the backend server
        '/api': {
          target: backendUrl,
          changeOrigin: true, // Needed for virtual hosted sites
          secure: false,      // Allow proxying to http backend
          ws: true,           // Proxy websockets if needed later
          rewrite: (path) => path.replace(/^\/api/, '/api'), // Ensure /api is kept if backend expects it
        },
      },
    },
    resolve: {
       alias: {
         // Setup alias for cleaner imports if desired
         '@': path.resolve(__dirname, './src'),
       },
     },
     // Optional: Define global constants accessible in frontend code
     define: {
       // Expose specific env variables to frontend code (prefix with VITE_)
       'import.meta.env.VITE_APP_TITLE': JSON.stringify(env.VITE_APP_TITLE || 'Kintask'),
       // Example: 'import.meta.env.VITE_SOME_PUBLIC_KEY': JSON.stringify(env.VITE_SOME_PUBLIC_KEY),
     }
  }
})
