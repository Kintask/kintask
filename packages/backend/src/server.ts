import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import config from './config';
import verifyRoutes from './routes/verify';
import KintaskCommitmentAbi from './contracts/abi/KintaskCommitment.json'; // Load ABI here
import { initializeTimelockService, stopRevealListener } from './services/timelockService';

// --- Initial Checks ---
// Check if ABI was copied correctly BEFORE starting server
if (!KintaskCommitmentAbi || !KintaskCommitmentAbi.abi || KintaskCommitmentAbi.abi.length === 0 || (KintaskCommitmentAbi as any)._comment) {
    console.error("\nFATAL ERROR: KintaskCommitment ABI not found, empty, or still placeholder in 'packages/backend/src/contracts/abi/KintaskCommitment.json'.");
    console.error("Please run 'pnpm contracts:compile' in the root and copy the generated ABI:\n");
    console.error("cp packages/contracts/artifacts/contracts/KintaskCommitment.sol/KintaskCommitment.json packages/backend/src/contracts/abi/\n");
    process.exit(1);
} else {
    console.log("[Server] KintaskCommitment ABI loaded successfully.");
}

const app: Express = express();
const port = config.port;

// --- Middleware ---
app.use(cors()); // Allow requests from frontend (configure origins for production)
app.use(express.json()); // Parse JSON request bodies
app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
         // Avoid logging favicon requests if too noisy
         if (!req.originalUrl.includes('favicon')) {
             console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
         }
    });
    next();
});

// --- Routes ---
app.use('/api', verifyRoutes);

// Root Route / Health Check
app.get('/', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', message: 'Kintask Backend is running!'});
});

// --- Global Error Handler ---
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("[Global Error Handler]:", err.stack || err);
  // Avoid sending stack trace in production
  const message = process.env.NODE_ENV === 'production' ? 'An unexpected error occurred.' : err.message;
  res.status(500).json({
      error: 'Internal Server Error',
      message: message,
  });
});

// --- Start Server ---
const server = app.listen(port, () => {
  console.log(`[Server]: Kintask Backend server is running at http://localhost:${port}`);
  // Initialize Timelock Service (including listener) after server starts listening
  // This ensures config and ABI checks passed
  initializeTimelockService();
});

// --- Graceful Shutdown ---
const gracefulShutdown = (signal: string) => {
    console.log(`\n${signal} signal received: closing HTTP server...`);
    stopRevealListener(); // Stop listener first
    server.close((err) => {
         if (err) {
             console.error("Error closing HTTP server:", err);
             process.exit(1); // Exit with error if server close fails
         }
        console.log('HTTP server closed.');
        // Perform other cleanup if needed (e.g., DB connection)
        process.exit(0);
    });

    // Force close server after 10 seconds if it hasn't closed gracefully
     setTimeout(() => {
         console.error('Could not close connections in time, forcefully shutting down');
         process.exit(1);
     }, 10000); // 10 seconds timeout
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT')); // Catches Ctrl+C
