// kintask/packages/frontend/src/App.tsx

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ethers } from 'ethers';

// Core Components & Services
import ChatInterface from './components/ChatInterface';
import MessageDisplay from './components/MessageDisplay'; // Assuming MessageDisplay is used now
import {
    askQuestion,
    getUserQuestions,
    pollForResult // Use the new polling function
} from './services/apiService';

// Type Definitions
import {
    ChatMessage,
    FinalVerificationResult,
    ApiErrorResponse,
    HistoryEntry,
    QuestionData
} from './types';

const IPFS_GATEWAY_URL = import.meta.env.VITE_IPFS_GATEWAY_URL || 'https://w3s.link/ipfs/';
const POLLING_INTERVAL_MS = 10000; // Check status every 10 seconds

// --- Helper Function ---
function createSystemMessage(
    text: string,
    requestContext?: string,
    status: string = 'System Notification'
): ChatMessage {
    const verificationResultPart = (status !== 'System Notification')
        ? { status: status, requestContext: requestContext } as Partial<FinalVerificationResult>
        : undefined;
    return {
        id: Date.now() + Math.random(),
        sender: 'System',
        text: text,
        verificationResult: verificationResultPart,
        requestContext: requestContext,
    };
}

// --- App Component ---
function App() {
    // --- State ---
    const [messages, setMessages] = useState<ChatMessage[]>(() => [
        createSystemMessage("Welcome! Connect your wallet to view history. Ask a question & provide the Knowledge Base CID.")
    ]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isHistoryLoading, setIsHistoryLoading] = useState(false);
    const [walletAddress, setWalletAddress] = useState<string | null>(null);
    const [userHistory, setUserHistory] = useState<HistoryEntry[]>([]);
    const [showHistoryList, setShowHistoryList] = useState<boolean>(false);
    const [selectedHistoryDetail, setSelectedHistoryDetail] = useState<HistoryEntry | null>(null);
    // Stores contextId -> { question, kbCid, lastStatus } for active polling
    const [pendingRequests, setPendingRequests] = useState<Map<string, { question: string; kbCid: string; lastStatus?: string }>>(new Map());
    const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // --- Callback Functions ---
    const addSystemMessage = useCallback((text: string, requestContext?: string, status?: string) => {
        console.log(`[System Message][${requestContext?.substring(4,10) || 'General'}]: ${text}`);
        const systemMessage = createSystemMessage(text, requestContext, status);
        setMessages(prev => {
            // Avoid duplicate status messages for same context if polling quickly
            const lastMsg = prev[prev.length - 1];
            if (lastMsg?.sender === 'System' && lastMsg.requestContext === requestContext && lastMsg.text.startsWith(text.split("(")[0])) {
                 // Update text if status changes
                 if (lastMsg.verificationResult?.status !== status) {
                      const updatedMessages = [...prev];
                      updatedMessages[prev.length-1] = systemMessage; // Replace last system message
                      return updatedMessages;
                 }
                 return prev;
            }
            return [...prev, systemMessage];
        });
    }, []);

    // Adds a new message or updates by ID
    const addOrUpdateMessage = useCallback((newMessage: ChatMessage) => {
        setMessages(prev => {
            const existingIndex = prev.findIndex(msg => msg.id === newMessage.id);
            if (existingIndex !== -1) {
                const updatedMessages = [...prev];
                updatedMessages[existingIndex] = newMessage;
                return updatedMessages;
            } else {
                return [...prev, newMessage];
            }
        });
    }, []);

    // --- Wallet & History Logic ---

    // Loads history from Backend
    const loadHistory = useCallback(async (address: string) => {
        if (!address) return;
        console.log(`[History] Fetching history for ${address.substring(0, 6)}...`);
        setIsHistoryLoading(true);
        setUserHistory([]);
        setPendingRequests(new Map()); // Clear pending list on new history load

        const response = await getUserQuestions(address);

        if ('isError' in response) {
            console.error("[History] Failed to fetch:", response.error);
            addSystemMessage(`⛔ Error fetching history: ${response.error}`);
            setUserHistory([]);
        } else if (Array.isArray(response)) {
            console.log(`[History] Received ${response.length} question entries.`);
            const initialPending = new Map<string, { question: string; kbCid: string; lastStatus?: string }>();
            const fetchedHistory: HistoryEntry[] = response
                .map((qData): HistoryEntry | null => {
                    if (!qData?.requestContext || !qData.question || !qData.cid || !qData.status) return null;

                    // Define NON-terminal statuses (indicating polling is needed)
                    const isPendingStatus = ['PendingAnswer', 'Processing', 'PendingVerification', 'PendingEvaluation', 'Submitted'].includes(qData.status);

                    if (isPendingStatus) {
                        initialPending.set(qData.requestContext, { question: qData.question, kbCid: qData.cid, lastStatus: qData.status });
                    }

                    return {
                        requestContext: qData.requestContext,
                        questionText: qData.question,
                        knowledgeBaseCid: qData.cid,
                        submissionTimestamp: qData.timestamp,
                        // Pre-fill basic status for completed items, otherwise null
                        finalResult: !isPendingStatus ? {
                             status: qData.status,
                             requestContext: qData.requestContext,
                             question: qData.question,
                             kbCid: qData.cid,
                        } : null,
                    };
                })
                .filter((entry): entry is HistoryEntry => entry !== null)
                .sort((a, b) => new Date(b.submissionTimestamp).getTime() - new Date(a.submissionTimestamp).getTime());

            setUserHistory(fetchedHistory);
            setPendingRequests(initialPending);
            console.log(`[History] Processed ${fetchedHistory.length} entries. ${initialPending.size} requests pending polling.`);
        } else {
            console.error("[History] Unexpected response format:", response);
            addSystemMessage("⛔ Error: Received unexpected history data.");
            setUserHistory([]);
        }
        setIsHistoryLoading(false);
    }, [addSystemMessage]);

    // Updates the userHistory state array when polling gets a final result
    const updateHistoryEntryWithFinalResult = useCallback((requestContext: string, finalResult: FinalVerificationResult) => {
        if (!requestContext || !finalResult) return;
        console.log(`[History State] Updating entry ${requestContext.substring(4,10)} with final result:`, finalResult.status);
        setUserHistory(prev => {
            const entryIndex = prev.findIndex(entry => entry.requestContext === requestContext);
            if (entryIndex === -1) {
                console.warn(`[History State] Cannot find entry ${requestContext} to update final result.`);
                // If history hasn't loaded yet but polling finished, we might need to add it
                // This requires having the original question/CID stored alongside pendingRequests
                return prev;
            }
            const updatedEntry: HistoryEntry = { ...prev[entryIndex], finalResult: finalResult };
            const updatedHistory = [...prev];
            updatedHistory[entryIndex] = updatedEntry;
            return updatedHistory;
        });
    }, []);

    // Connect Wallet
    const connectWallet = useCallback(async () => {
        console.log("[App] Attempting to connect wallet...");
        setShowHistoryList(false); setSelectedHistoryDetail(null);
        if (typeof window.ethereum !== 'undefined') {
            try {
                const provider = new ethers.BrowserProvider(window.ethereum, 'any');
                const accounts = await provider.send("eth_requestAccounts", []);
                if (!accounts || accounts.length === 0) throw new Error("No accounts returned.");
                const signer = await provider.getSigner();
                const signerAddress = await signer.getAddress();
                const checksumAddress = ethers.getAddress(signerAddress);
                setWalletAddress(checksumAddress);
                setMessages(prev => [prev.length > 0 ? prev[0] : createSystemMessage("Welcome!")]);
                addSystemMessage(`Wallet ${checksumAddress.substring(0, 6)}... connected.`);
                await loadHistory(checksumAddress);
            } catch (error: any) {
                console.error("Wallet connection failed:", error);
                addSystemMessage(`⚠️ Wallet connection failed: ${error.message?.split('(')[0] || 'Unknown error'}`);
                setWalletAddress(null); setUserHistory([]); setPendingRequests(new Map());
            }
        } else { addSystemMessage("🦊 Wallet not detected. Please install MetaMask or similar."); }
    }, [loadHistory, addSystemMessage]);

    // Disconnect Wallet
    const disconnectWallet = useCallback(() => {
        if (!walletAddress) return;
        const address = walletAddress;
        console.log(`[App] Disconnecting wallet ${address.substring(0,6)}...`);
        setWalletAddress(null); setUserHistory([]); setShowHistoryList(false);
        setSelectedHistoryDetail(null); setPendingRequests(new Map());
        setMessages(prev => [prev.length > 0 ? prev[0] : createSystemMessage("Welcome!")]);
        addSystemMessage(`Wallet ${address.substring(0, 6)}... disconnected.`);
    }, [walletAddress, addSystemMessage]);


    // --- Submit New Question Handler ---
    const handleSubmitForVerification = useCallback(async (question: string, knowledgeBaseCid: string) => {
        // Validation
        if (!question.trim() || !knowledgeBaseCid.trim()) {
            addSystemMessage("⛔ Please enter both a question and a Knowledge Base CID.", undefined, 'Error: Verification Failed'); return;
        }
        if (!/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[A-Za-z2-7]{58,})$/.test(knowledgeBaseCid)) {
            addSystemMessage(`⛔ Error: Invalid CID format.`, undefined, 'Error: Verification Failed'); return;
        }
        if (isSubmitting) return;
        if (!walletAddress) { addSystemMessage("⚠️ Please connect your wallet first."); connectWallet(); return; }

        console.log(`[App] Submitting Q: "${question.substring(0,30)}...", CID: ${knowledgeBaseCid.substring(0,10)}...`);
        setIsSubmitting(true);
        const userTimestamp = Date.now();

        // Add User Message
        addOrUpdateMessage({ id: userTimestamp, sender: 'User', text: `${question}\n(KB: ${knowledgeBaseCid.substring(0, 10)}...)` });

        // Add System placeholder message
        const loadingId = userTimestamp + 1;
        addOrUpdateMessage(createSystemMessage("⏳ Submitting request...", undefined, 'Processing'));

        // Call apiService.askQuestion (ensure this name matches your service)
        const response = await askQuestion(question, knowledgeBaseCid, walletAddress);

        // Remove "Submitting..." placeholder
        setMessages(prev => prev.filter(msg => msg.id !== loadingId));

        // Handle acknowledgement
        if ('isError' in response) {
            console.error("[App] Backend Submission Failed:", response.error);
            addSystemMessage(`⛔ Backend submission failed: ${response.error || 'Unknown error'}`, undefined, 'Error: Verification Failed');
        } else if (response.requestContext) {
            console.log("[App] Backend Submission Acknowledged:", response);
            const contextId = response.requestContext;
            addSystemMessage(`✅ Request submitted (ID: ${contextId.substring(4, 10)}). Checking status...`, contextId, 'Pending Answer'); // Start with Pending Answer status
            // Add to pending requests map for polling
            setPendingRequests(prev => new Map(prev).set(contextId, { question, kbCid: knowledgeBaseCid, lastStatus: 'Pending Answer' }));
        } else {
            console.error("[App] Backend acknowledgement missing requestContext:", response);
            addSystemMessage(`⛔ Backend error: Missing Request ID.`, undefined, 'Error: Verification Failed');
        }
        setIsSubmitting(false);

    }, [isSubmitting, walletAddress, addSystemMessage, addOrUpdateMessage, connectWallet]);


    // --- Status Polling Logic using new API structure ---
    useEffect(() => {
        // Stop condition
        if (pendingRequests.size === 0 || !walletAddress) {
            if (pollingIntervalRef.current) {
                console.log("[Polling] Stopping interval (no pending requests or wallet disconnected).");
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
            }
            return;
        }

        // Start interval if not already running
        if (!pollingIntervalRef.current) {
            console.log(`[Polling] Starting polling interval for ${pendingRequests.size} request(s)...`);
            pollingIntervalRef.current = setInterval(async () => {
                console.log(`[Polling] Tick: Checking ${pendingRequests.size} pending request(s)...`);
                if (pendingRequests.size === 0) { // Double check inside interval
                    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
                    pollingIntervalRef.current = null;
                    return;
                }

                // Create promises for all pending requests
                const checkPromises = Array.from(pendingRequests.entries()).map(
                    async ([contextId, queryInfo]) => {
                        try {
                            // Use the combined pollForResult function
                            const result = await pollForResult(contextId, queryInfo.question, queryInfo.kbCid);

                            if ('isError' in result) {
                                console.error(`[Polling] Error polling ${contextId.substring(4, 10)}:`, result.error, result.details);
                                // Decide on error handling: remove from pending? Show error message?
                                if (result.status === 404 && result.error?.includes('Evaluation data not ready')) {
                                     // It's okay if eval data is not ready, keep polling status 'Pending Evaluation'
                                     if (queryInfo.lastStatus !== 'Pending Evaluation') {
                                          setPendingRequests(prev => new Map(prev).set(contextId, { ...queryInfo, lastStatus: 'Pending Evaluation'}));
                                          addSystemMessage(`Verifying... (Status: Pending Evaluation) ID: ${contextId.substring(4, 10)}`, contextId, 'Pending Evaluation');
                                     }
                                } else {
                                     // For other errors, maybe stop polling and mark as failed
                                     addSystemMessage(`⛔ Error checking ${contextId.substring(4,10)}: ${result.error}`, contextId, 'Error: Polling Failed');
                                     // Update history and remove from pending
                                      const errorResult: FinalVerificationResult = { ...queryInfo, requestContext: contextId, status: 'Error: Polling Failed', error: result.error };
                                      updateHistoryEntryWithFinalResult(contextId, errorResult);
                                      setPendingRequests(prev => { const next = new Map(prev); next.delete(contextId); return next; });
                                }
                            } else {
                                // Define terminal statuses based on your backend logic
                                const terminalStatuses = ['Completed', 'NoValidAnswers', 'EvaluationFailed', 'Failed', 'Error: Verification Failed', 'Error: Evaluation Failed']; // Add all states that mean "stop polling"
                                const isTerminal = terminalStatuses.includes(result.status);

                                if (isTerminal) {
                                    console.log(`[Polling] Final result for ${contextId.substring(4, 10)}: Status ${result.status}`);
                                    const finalAiMessage: ChatMessage = {
                                        id: Date.now() + Math.random(), sender: 'AI',
                                        text: result.answer || "[No answer content]",
                                        verificationResult: result as FinalVerificationResult, // Cast as final result is expected here
                                        requestContext: contextId
                                    };
                                    // Update chat and history
                                    setMessages(prev => [
                                        ...prev.filter(m => m.requestContext !== contextId || m.sender === 'User'),
                                        finalAiMessage
                                    ]);
                                    updateHistoryEntryWithFinalResult(contextId, result as FinalVerificationResult);
                                    // Remove from pending
                                    setPendingRequests(prev => {
                                        const next = new Map(prev);
                                        next.delete(contextId);
                                        console.log(`[Polling] Removed ${contextId.substring(4,10)} from pending. Remaining: ${next.size}`);
                                        return next;
                                    });
                                } else {
                                    // Still processing, update status if changed
                                    if (queryInfo.lastStatus !== result.status) {
                                        console.log(`[Polling] Status update for ${contextId.substring(4, 10)}: ${queryInfo.lastStatus} -> ${result.status}`);
                                        setPendingRequests(prev => new Map(prev).set(contextId, { ...queryInfo, lastStatus: result.status }));
                                        addSystemMessage(`Verifying... (Status: ${result.status}) ID: ${contextId.substring(4,10)}`, contextId, result.status);
                                    }
                                }
                            }
                        } catch (e) {
                            console.error(`[Polling] Unhandled exception checking ${contextId}:`, e);
                            // Consider removing from pending to avoid infinite loops on critical errors
                            // setPendingRequests(prev => { const next = new Map(prev); next.delete(contextId); return next; });
                        }
                    }
                );
                await Promise.allSettled(checkPromises); // Process all checks

            }, POLLING_INTERVAL_MS);
        }

        // Cleanup function for useEffect
        return () => {
            if (pollingIntervalRef.current) {
                console.log("[Polling] Cleaning up polling interval.");
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
            }
        };
    }, [pendingRequests, walletAddress, updateHistoryEntryWithFinalResult, addSystemMessage]); // Dependencies


    // --- History Detail View Handlers ---
    const handleHistoryItemClick = useCallback(async (entry: HistoryEntry) => {
        console.log(`[History] Clicked item: ${entry.requestContext.substring(4,10)}`);
        // Immediately show modal, fetch details if needed
        setSelectedHistoryDetail(entry); // Show current data first
        setShowHistoryList(false);

        // If result is not yet fetched or looks incomplete/pending, fetch fresh data
         const terminalStatuses = ['Completed', 'NoValidAnswers', 'EvaluationFailed', 'Failed', 'Error: Verification Failed', 'Error: Evaluation Failed', 'Error: Polling Failed'];
        if (!entry.finalResult || !terminalStatuses.includes(entry.finalResult.status)) {
             console.log(`[History Detail] Fetching potentially updated details for ${entry.requestContext.substring(4,10)}...`);
             // Show loading state within the modal maybe? For now, just fetch.
            const result = await pollForResult(entry.requestContext, entry.questionText, entry.knowledgeBaseCid);

             if ('isError' in result) {
                  console.error(`[History Detail] Error fetching details for ${entry.requestContext}:`, result.error);
                  const errorResult = { ...entry, finalResult: { ...queryInfo, requestContext: entry.requestContext, status: 'Error: Polling Failed', error: result.error } as FinalVerificationResult };
                  updateHistoryEntryWithFinalResult(entry.requestContext, errorResult.finalResult);
                  setSelectedHistoryDetail(errorResult); // Update modal view with error
             } else {
                  const finalResult = result as FinalVerificationResult; // Cast needed
                  updateHistoryEntryWithFinalResult(entry.requestContext, finalResult);
                  setSelectedHistoryDetail({ ...entry, finalResult }); // Update modal view with fetched data
             }
        }
    }, [updateHistoryEntryWithFinalResult]);

    const closeHistoryDetail = useCallback(() => {
        setSelectedHistoryDetail(null);
    }, []);

    // Helper to get display text for history list item
    const getHistoryDisplayQuestion = useCallback((entry: HistoryEntry): string => {
        const currentStatus = pendingRequests.get(entry.requestContext)?.lastStatus ?? entry.finalResult?.status ?? 'Unknown';
        const displayStatus = currentStatus.startsWith('Error:') ? '[Error]'
                             : currentStatus.startsWith('Pending') || currentStatus === 'Processing' || currentStatus === 'Submitted' ? '[Processing]'
                             : currentStatus === 'Completed' && entry.finalResult?.evaluation ? `[${entry.finalResult.evaluation}]` // Show evaluation result if completed
                             : `[${currentStatus}]`;

         const questionSnippet = entry.questionText.length > 40 ? entry.questionText.substring(0, 37) + '...' : entry.questionText;
         return `${displayStatus} ${questionSnippet}`;
    }, [pendingRequests]);

    // Helper to get title attribute for history list item
     const getHistoryTitle = useCallback((entry: HistoryEntry): string => {
         const time = new Date(entry.submissionTimestamp).toLocaleString();
         let statusText = entry.finalResult?.status ?? "Loading...";
         if (pendingRequests.has(entry.requestContext)) {
            statusText = `Polling (${pendingRequests.get(entry.requestContext)?.lastStatus ?? 'Checking'})...`;
         }
         return `Q: ${entry.questionText}\nCID: ${entry.knowledgeBaseCid}\nSubmitted: ${time}\nStatus: ${statusText}`;
     }, [pendingRequests]);


    // --- Render ---
    return (
        <div className="flex flex-col h-screen max-w-5xl mx-auto p-4 md:p-6 bg-gradient-to-br from-gray-100 to-blue-100 dark:from-gray-900 dark:to-slate-800 relative font-sans overflow-hidden">
            {/* Header */}
            <header className="mb-4 text-center shrink-0 pt-4 md:pt-6 relative z-20">
                {/* Wallet & History Buttons */}
                 <div className="absolute top-0 right-0 flex items-center space-x-2 p-2">
                     {!walletAddress ? (
                        <button onClick={connectWallet} className="px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm transition-colors shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"> Connect Wallet </button>
                     ) : (
                        <>
                         <button onClick={() => { setShowHistoryList(prev => !prev); setSelectedHistoryDetail(null); }} disabled={isHistoryLoading} className={`px-3 py-1.5 rounded-md text-sm transition-colors shadow flex items-center space-x-1 ${ isHistoryLoading ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-wait opacity-70 animate-pulse' : userHistory.length === 0 ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed opacity-70' : 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-1' }`} title={showHistoryList ? "Hide History" : (userHistory.length > 0 ? "Show History" : "No History Yet")}>
                             {isHistoryLoading ? <div className="h-4 w-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div> : <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                             <span>({isHistoryLoading ? '...' : userHistory.length})</span>
                         </button>
                         <button onClick={disconnectWallet} title="Disconnect Wallet" className="px-2 py-1.5 bg-red-500 text-white rounded-md hover:bg-red-600 text-sm transition-colors shadow focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1">
                             <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                         </button>
                        </>
                     )}
                 </div>

                 {/* Main Title Area */}
                <img src="/kintask-logo.png" alt="Kintask Logo" className="h-16 md:h-20 w-auto mx-auto mb-2 rounded-lg shadow-md" onError={(e) => (e.currentTarget.style.display = 'none')} />
                <h1 className="text-3xl md:text-4xl font-bold text-blue-600 dark:text-blue-400 tracking-tight">Kintask</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Verifiable AI Q&A with Decentralized Trust</p>
                {walletAddress && ( <p className="text-xs text-green-600 dark:text-green-400 mt-1 font-mono" title={walletAddress}> Connected: {walletAddress.substring(0, 6)}...{walletAddress.substring(walletAddress.length - 4)} </p> )}
            </header>

            {/* Main Chat Area */}
            <div style={{overflow:"auto"}}className="flex-grow min-h-0 rounded-lg shadow-inner overflow-hidden bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border border-gray-200 dark:border-gray-700 relative z-10 mt-2">
                 <ChatInterface
                     messages={messages}
                     onSendMessage={handleSubmitForVerification}
                     isLoading={isSubmitting} // Pass submission loading state
                     walletConnected={!!walletAddress}
                     onConnectWallet={connectWallet}
                     addSystemMessage={addSystemMessage}
                 />
            </div>

            {/* Footer Section */}
            <footer className="mt-4 text-center text-xs text-gray-400 dark:text-gray-500 shrink-0 relative z-10">
                 Encode Club AI Blueprints | Kintask Demo
            </footer>

            {/* History Panel (List) */}
            {walletAddress && showHistoryList && (
                <div className="absolute top-16 right-4 w-72 max-h-[calc(100vh-10rem)] overflow-y-auto bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-xl p-3 z-30 animate-fade-in scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600">
                     <div className="flex justify-between items-center mb-2 border-b pb-1.5 dark:border-gray-600 sticky top-0 bg-white dark:bg-gray-800 z-10 px-1 -mx-1">
                         <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Query History</h3>
                         <button onClick={() => setShowHistoryList(false)} className="p-1 rounded-full text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700" title="Close History">
                             <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                         </button>
                     </div>
                     {isHistoryLoading ? (
                        <p className="text-xs text-center text-gray-500 dark:text-gray-400 italic py-4">Loading history...</p>
                     ) : userHistory.length > 0 ? (
                        <ul className="space-y-1">
                            {userHistory.map((entry, index) => {
                                const displayQuestion = getHistoryDisplayQuestion(entry);
                                const titleText = getHistoryTitle(entry);
                                const isPending = pendingRequests.has(entry.requestContext);
                                const key = `${entry.requestContext}-${index}`;
                                return (
                                    <li key={key}>
                                        <button
                                            onClick={() => handleHistoryItemClick(entry)}
                                            className={`w-full text-left text-xs px-2 py-1.5 rounded truncate transition-colors ${
                                                isPending
                                                ? 'text-gray-500 dark:text-gray-400 italic hover:bg-gray-100 dark:hover:bg-gray-700 animate-pulse'
                                                : entry.finalResult?.status?.startsWith('Error')
                                                    ? 'text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30'
                                                    : 'text-gray-700 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-blue-900/30'
                                             }`}
                                             title={titleText}
                                        >
                                            {displayQuestion}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                     ) : (
                        <p className="text-xs text-center text-gray-500 dark:text-gray-400 italic py-2">No history found.</p>
                     )}
                </div>
            )}

            {/* History Detail Modal */}
            {selectedHistoryDetail && (
                 <div className="fixed inset-0 bg-black bg-opacity-60 dark:bg-opacity-75 flex justify-center items-center p-4 z-50 backdrop-blur-sm animate-fade-in" onClick={closeHistoryDetail} >
                     <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 md:p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-400 dark:scrollbar-thumb-gray-600" onClick={(e) => e.stopPropagation()} >
                         {/* Modal Header */}
                         <div className="flex justify-between items-center mb-4 border-b border-gray-200 dark:border-gray-600 pb-3">
                             <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Query Detail</h3>
                             <button onClick={closeHistoryDetail} className="p-1 rounded-full text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400" title="Close Details">
                                 <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                             </button>
                         </div>
                         {/* Modal Body */}
                         <div className="space-y-4">
                             {/* Request Info */}
                             <div className="text-xs font-mono text-gray-500 dark:text-gray-400 break-all"> Request ID: {selectedHistoryDetail.requestContext} </div>
                             {/* Question */}
                             <div>
                                 <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-1">Question:</p>
                                 <p className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded text-gray-800 dark:text-gray-200 whitespace-pre-wrap text-sm border dark:border-gray-600">{selectedHistoryDetail.questionText}</p>
                             </div>
                             {/* KB CID */}
                              {selectedHistoryDetail.knowledgeBaseCid && ( <div> <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-1">Knowledge Base CID:</p> <p className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded text-gray-800 dark:text-gray-200 text-xs break-all font-mono border dark:border-gray-600"><a href={`${IPFS_GATEWAY_URL}${selectedHistoryDetail.knowledgeBaseCid}`} target="_blank" rel="noopener noreferrer" className="hover:underline text-blue-600 dark:text-blue-400">{selectedHistoryDetail.knowledgeBaseCid}</a></p> </div> )}
                             {/* Submission Time */}
                              {selectedHistoryDetail.submissionTimestamp && ( <div> <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">Submitted:</p> <p className="text-gray-700 dark:text-gray-300 text-xs">{new Date(selectedHistoryDetail.submissionTimestamp).toLocaleString()}</p> </div> )}

                             {/* Final Answer/Status Bubble */}
                             <div>
                                 <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-1">
                                     {selectedHistoryDetail.finalResult ? 'Final Result:' : 'Current Status:'}
                                 </p>
                                 {selectedHistoryDetail.finalResult ? (
                                      <MessageDisplay message={{
                                           id: Date.now(), // Dummy ID
                                           sender: 'AI',
                                           text: selectedHistoryDetail.finalResult.answer || "[No Answer Available]",
                                           verificationResult: selectedHistoryDetail.finalResult, // Pass the full result object
                                           isLoading: false
                                       }} />
                                 ) : (
                                      <div className="p-3 bg-blue-50 dark:bg-blue-900/30 rounded border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 text-sm italic">
                                         Status: {pendingRequests.get(selectedHistoryDetail.requestContext)?.lastStatus ?? 'Fetching status...'}
                                      </div>
                                 )}
                             </div>
                         </div>
                     </div>
                 </div>
             )}

        </div>
    );
}

export default App;