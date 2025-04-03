import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import config from './config';
import verifyRoutes from './routes/verify';
import { startRevealListener, stopRevealListener } from './services/timelockService'; // Import listener controls

const app: Express = express();
const port = config.port;

// --- Middleware ---
app.use(cors()); // Allow requests from frontend (configure origins for production)
app.use(express.json({ limit: '1mb' })); // Parse JSON request bodies, limit size
app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
         const duration = Date.now() - start;
         console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
    });
    next();
});

// --- Routes ---
app.use('/api', verifyRoutes);

// Root Route / Health Check
app.get('/', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', message: 'Kintask Backend is running!'});
});

// --- 404 Handler ---
// Catch-all for routes not defined
app.use((req, res, next) => {
    res.status(404).json({ error: 'Not Found', message: `Endpoint ${req.method} ${req.path} does not exist.` });
});


// --- Global Error Handler ---
// Catches errors passed via next(error)
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
  console.log(`[server]: Kintask Backend server is running at http://localhost:${port}`);
  // Initialize Timelock Listener on startup
  try {
      startRevealListener();
  } catch (listenerError) {
       console.error("[Server Startup] Failed to start Timelock listener:", listenerError);
  }
});

// --- Graceful Shutdown ---
const gracefulShutdown = (signal: string) => {
    console.log(`\n${signal} signal received: closing HTTP server...`);
    // Stop listener first
    stopRevealListener();
    server.close(() => {
        console.log('HTTP server closed.');
        // Perform other cleanup if needed (e.g., DB connections)
        console.log("Exiting process.");
        process.exit(0);
    });

    // Force close server after a timeout if graceful shutdown fails
     setTimeout(() => {
         console.error('Could not close connections in time, forcefully shutting down');
         process.exit(1);
     }, 10000); // 10 seconds timeout
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT')); // Catches Ctrl+C
