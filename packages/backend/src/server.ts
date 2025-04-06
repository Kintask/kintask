// server.ts
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import config from './config';
import verifyRoutes from './routes/verify'; // Keep for potential direct verification if needed
import askRoutes from './routes/ask';       // NEW: Import the ask routes
import statusRoutes from './routes/status'; // NEW: Import the status routes
import { startRevealListener, stopRevealListener } from './services/timelockService';

// --- Agent Imports (Conceptual - Agents should run separately) ---
// import { startAnsweringAgent } from './agents/answeringAgent';
// import { startVerificationAgent } from './agents/verificationAgent';
// ---

const app: Express = express();
const port = config.port;

app.set('etag', false);

// --- Middleware ---
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
         const duration = Date.now() - start;
         console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
    });
    next();
});

// --- Routes ---
app.use('/api', verifyRoutes); // Keep or remove based on need
app.use('/api', askRoutes);    // *** ADD THIS LINE TO MOUNT THE ASK ROUTES ***
app.use('/api', statusRoutes); // Add new status route

// Root Route / Health Check
app.get('/', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', message: 'Kintask Backend API is running!'});
});

// --- 404 Handler ---
// This should come AFTER all other routes
app.use((req, res, next) => {
    res.status(404).json({ error: 'Not Found', message: `Endpoint ${req.method} ${req.path} does not exist.` });
});


// --- Global Error Handler ---
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("[Global Error Handler]:", err.stack || err);
  const message = process.env.NODE_ENV === 'production' ? 'An unexpected error occurred.' : err.message;
  // Ensure response isn't already sent
  if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error', message: message });
  }
});

// --- Start Server ---
const server = app.listen(port, () => {
  console.log(`[server]: Kintask Backend API server is running at http://localhost:${port}`);
  try {
      // Timelock listener might still be relevant if verification agents commit results
      // startRevealListener();
      console.log("[Server Startup] Timelock listener NOT started by default in agent architecture.");
  } catch (listenerError) {
       console.error("[Server Startup] Failed to start Timelock listener:", listenerError);
  }

  // --- Start Agents (Conceptual - Better to run as separate processes) ---
  console.log("------------------------------------------------------");
  console.log("--- AGENT ARCHITECTURE NOTE ---");
  console.log("--- Answering & Verification Agents should run as separate processes ---");
  console.log("--- that poll the Recall service independently. ---");
  console.log("--- Starting them here is for demonstration only. ---");
   // startAnsweringAgent(); // Example conceptual call
   // startVerificationAgent(); // Example conceptual call
  console.log("------------------------------------------------------");
  // ---
});

// --- Graceful Shutdown ---
const gracefulShutdown = (signal: string) => {
    console.log(`\n${signal} signal received: closing HTTP server...`);
    // stopRevealListener(); // Stop if started
    // stopAnsweringAgent(); // Conceptual
    // stopVerificationAgent(); // Conceptual
    server.close(() => {
        console.log('HTTP server closed.');
        console.log("Exiting process.");
        process.exit(0);
    });
     setTimeout(() => {
         console.error('Could not close connections in time, forcefully shutting down');
         process.exit(1);
     }, 10000); // 10 seconds timeout
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
// ==== ./server.ts ====