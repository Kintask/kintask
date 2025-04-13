// src/controllers/statusController.ts
import { Request, Response, NextFunction } from 'express';
import { getRequestStatus } from '../services/recallService'; // Function to fetch status from Recall
import { RequestStatus } from '../types'; // Import type if needed

// Add the 'export' keyword here
export async function handleStatusRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Extract requestContext from URL parameters
    const { requestContext } = req.params;

    // --- Validation ---
    if (!requestContext || typeof requestContext !== 'string' || requestContext.trim() === '') {
        res.status(400).json({ error: 'Invalid or missing requestContext parameter in URL.' });
        return;
    }
    if (!requestContext.startsWith('req_')) { // Basic format check
        res.status(400).json({ error: 'Invalid requestContext format.' });
        return;
    }
    // --- End Validation ---

    console.log(`[Status Controller] Received status request for Context: ${requestContext.substring(0, 15)}...`);

    try {
        // --- Fetch Status from Recall Service ---
        // This function queries Recall for question, answer, verdicts based on the ID
        const statusData: RequestStatus | null = await getRequestStatus(requestContext);

        // --- Handle Response ---
        if (!statusData) {
            // If getRequestStatus returns null, it means the initial question wasn't found
            console.log(`[Status Controller] No records found for context: ${requestContext}`);
            res.status(404).json({
                status: 'Not Found', // Use the status string from RequestStatus type
                message: `No records found for request context: ${requestContext}`
            });
            return;
        }

        // Check if the status indicates an internal error during retrieval
        if (statusData.status === 'Error') {
            console.error(`[Status Controller] Error reported by getRequestStatus for ${requestContext}: ${statusData.error}`);
            res.status(500).json({
                error: 'Status Retrieval Error',
                message: statusData.error || 'An internal error occurred while fetching the request status.'
            });
            return;
        }


        // Successfully retrieved status data
        console.log(`[Status Controller] Found status data for ${requestContext.substring(0, 15)}... Status: ${statusData.status}`);
        res.status(200).json(statusData);

    } catch (error: any) { // Catch unexpected errors in controller logic
        const conciseError = error instanceof Error ? error.message.split('\n')[0] : String(error);
        console.error(`[Status Controller Error] Failed unexpectedly while getting status for ${requestContext}: ${conciseError}`);

        if (!res.headersSent) {
            res.status(500).json({
                error: 'Status Retrieval Failed',
                message: 'An unexpected internal error occurred.'
            });
        } else {
            console.error(`[Status Controller Error] Headers already sent for context ${requestContext}, cannot send error response.`);
        }
    }

    
}
// ==== ./src/controllers/statusController.ts ====