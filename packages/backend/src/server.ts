// src/server.ts
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import config from './config'; // Assuming src/config.ts
import verifyRoutes from './routes/verify'; // Assuming src/routes/verify.ts
import askRoutes from './routes/ask';       // Assuming src/routes/ask.ts
import statusRoutes from './routes/status'; // Assuming src/routes/status.ts
import questionsRoutes from './routes/questions'; // Assuming src/routes/status.ts
// Import the new service start/stop functions
import { startEvaluationPayoutService, stopEvaluationPayoutService } from './services/evaluationPayoutService'; // Assuming src/services/evaluationPayoutService.ts
// Keep timelock service imports if still used elsewhere
import { startRevealListener, stopRevealListener } from './services/timelockService'; // Assuming src/services/timelockService.ts

import evaluationRoutes from './routes/evaluation';

const app: Express = express();
const port = config.port;

app.set('etag', false); // Disable Etag generation globally

// --- Middleware ---
app.use(cors()); // Enable Cross-Origin Resource Sharing
app.use(express.json({ limit: '1mb' })); // Parse JSON request bodies, limit size
// Basic request logger
app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
         const duration = Date.now() - start;
         // Log request details
         console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
    });
    next(); // Pass control to the next middleware function
});

// --- Routes ---
app.use('/api', verifyRoutes); // Mount verify routes under /api
app.use('/api', askRoutes);    // Mount ask routes under /api
app.use('/api', statusRoutes); // Mount status routes under /api
app.use('/api', questionsRoutes); // Mount status routes under /api
app.use('/api', evaluationRoutes);


// Root Route / Health Check
app.get('/', (req: Request, res: Response) => {
  // Simple health check endpoint
  res.status(200).json({ status: 'ok', message: 'Kintask Backend API is running!'});
});

// --- 404 Handler ---
// This should come AFTER all other specific routes are mounted
app.use((req, res, next) => {
    // Handles any request that doesn't match the routes above
    res.status(404).json({ error: 'Not Found', message: `Endpoint ${req.method} ${req.path} does not exist.` });
});


// --- Global Error Handler ---
// Catches errors passed via next(error) or thrown in async route handlers
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("[Global Error Handler]:", err.stack || err); // Log the full error stack
  // Send generic error message in production, detailed in development
  const message = process.env.NODE_ENV === 'production' ? 'An unexpected error occurred.' : err.message;
  // Ensure response isn't already sent
  if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error', message: message });
  }
  // If headers were sent, Node's default handler will close the connection.
});

// --- Start Server ---
const server = app.listen(port, () => {
  console.log(`[server]: Kintask Backend API server is running at http://localhost:${port}`);
  try {
      // Start the combined evaluation and payout service polling loops
      startEvaluationPayoutService();
      // startRevealListener(); // Start timelock listener if needed (currently commented out)
      console.log("[Server Startup] Evaluation/Payout service started. Timelock listener NOT started by default.");
  } catch (serviceError: any) { // Catch potential errors during service start
       console.error("[Server Startup] Failed to start background services:", serviceError.message || serviceError);
  }
  console.log("------------------------------------------------------");
  console.log("--- Answering Agent runs separately. ---");
  console.log("--- Evaluation & Payout logic runs in backend. ---");
  console.log("------------------------------------------------------");
});

// --- Graceful Shutdown ---
const gracefulShutdown = (signal: string) => {
    console.log(`\n${signal} signal received: closing HTTP server and stopping services...`);
    // Stop the combined service polling loops
    stopEvaluationPayoutService();
    // stopRevealListener(); // Stop timelock listener if it was started
    server.close(() => {
        console.log('HTTP server closed.');
        console.log("Exiting process.");
        process.exit(0); // Exit cleanly
    });
     // Force shutdown if graceful closing takes too long
     setTimeout(() => {
         console.error('Could not close connections in time, forcefully shutting down');
         process.exit(1); // Exit with error code
     }, 10000); // 10 seconds timeout
};

// Listen for termination signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT')); // Handles Ctrl+C
// ==== ./src/server.ts ====