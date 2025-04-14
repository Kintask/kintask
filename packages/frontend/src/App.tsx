// kintask/packages/frontend/src/App.tsx

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ethers } from 'ethers';

// Core Components & Services
import ChatInterface from './components/ChatInterface';
import MessageDisplay from './components/MessageDisplay';
import LoadingModal from './components/LoadingModal'; // Import LoadingModal
import {
    askQuestion,
    getUserQuestions,
    pollForResult,
    checkEvaluationStatus
} from './services/apiService';

// Type Definitions
import {
    ChatMessage,
    FinalVerificationResult,
    ApiErrorResponse,
    HistoryEntry,
    QuestionData,
    VerificationStatus
} from './types';

const IPFS_GATEWAY_URL = import.meta.env.VITE_IPFS_GATEWAY_URL || 'https://w3s.link/ipfs/';
const POLLING_INTERVAL_MS = 10000;

// Define terminal statuses
const TERMINAL_STATUSES: VerificationStatus[] = [
    'Completed', 'Verified', 'Flagged: Uncertain', 'Flagged: Contradictory',
    'NoValidAnswers', 'EvaluationFailed', 'PayoutComplete',
    'Error: Verification Failed', 'Error: Evaluation Failed', 'Error: Timelock Failed',
    'Error: Polling Failed', 'Error: No Valid Answers', 'Error: Network/Server Issue',
    'Error: Invalid Response Format', 'Error: Request Setup Failed',
    'Error: Unknown Client Issue', 'Error: No Response'
];

// Define non-terminal statuses
const PENDING_STATUSES: VerificationStatus[] = [
    'PendingAnswer', 'Processing', 'PendingVerification', 'PendingEvaluation',
    'PendingPayout', 'Submitted', 'Unverified'
];

// --- Helper Function ---
function createSystemMessage(
    text: string,
    requestContext?: string,
    status: VerificationStatus | string = 'System Notification'
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
    const [isApiCallInProgress, setIsApiCallInProgress] = useState(false); // For the askQuestion API call duration
    const [isHistoryLoading, setIsHistoryLoading] = useState(false);
    const [walletAddress, setWalletAddress] = useState<string | null>(null);
    const [userHistory, setUserHistory] = useState<HistoryEntry[]>([]);
    const [showHistoryList, setShowHistoryList] = useState<boolean>(false);
    const [selectedHistoryDetail, setSelectedHistoryDetail] = useState<HistoryEntry | null>(null);
    const [pendingRequests, setPendingRequests] = useState<Map<string, { question: string; kbCid: string; lastStatus?: VerificationStatus | string }>>(new Map());
    const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // --- Loading Modal State ---
    const [isLoadingModalVisible, setIsLoadingModalVisible] = useState(false);
    const [loadingModalMessage, setLoadingModalMessage] = useState("Processing Request...");
    const [loadingModalSubMessage, setLoadingModalSubMessage] = useState<string | undefined>(undefined);
    const [loadingModalContextId, setLoadingModalContextId] = useState<string | undefined>(undefined);

    // --- Callback Functions ---
    const addSystemMessage = useCallback((text: string, requestContext?: string, status?: VerificationStatus | string) => {
        console.log(`[System Message][${requestContext?.substring(0,10) || 'General'}]: ${text} (${status ?? 'General'})`);
        const systemMessage = createSystemMessage(text, requestContext, status);
        setMessages(prev => {
            const lastMsg = prev[prev.length - 1];
            // Update last system message if context matches and status is different
            if (lastMsg?.sender === 'System' && lastMsg.requestContext === requestContext && lastMsg.verificationResult?.status !== status) {
                const updatedMessages = [...prev];
                updatedMessages[prev.length - 1] = systemMessage;
                return updatedMessages;
            }
            // Avoid adding duplicate consecutive system messages for the same context/status
             if (lastMsg?.sender === 'System' && lastMsg.requestContext === requestContext && lastMsg.verificationResult?.status === status && lastMsg.text === text) {
                return prev;
            }
            return [...prev, systemMessage];
        });
    }, []);

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

    // --- Wallet & History Logic --- (Keep as before)
    const loadHistory = useCallback(async (address: string) => {
        if (!address) return;
        console.log(`[History] Fetching history for ${address.substring(0, 6)}...`);
        setIsHistoryLoading(true);
        setUserHistory([]);
        setPendingRequests(new Map());

        const response = await getUserQuestions(address);

        if ('isError' in response) {
            console.error("[History] Failed to fetch:", response.error);
            addSystemMessage(`⛔ Error fetching history: ${response.error}`, undefined, 'Error: Network/Server Issue');
            setUserHistory([]);
        } else if (Array.isArray(response)) {
            console.log(`[History] Received ${response.length} question entries.`);
            const initialPending = new Map<string, { question: string; kbCid: string; lastStatus?: VerificationStatus | string }>();
            const fetchedHistory: HistoryEntry[] = response
                .map((qData): HistoryEntry | null => {
                    if (!qData?.requestContext || !qData.question || !qData.cid || !qData.status) return null;
                    //const isFinished = await checkEvaluationStatus(qData.requestContext);
                    const isPendingStatus = !TERMINAL_STATUSES.includes(qData.status as VerificationStatus);
                    if (isPendingStatus) {
                        initialPending.set(qData.requestContext, { question: qData.question, kbCid: qData.cid, lastStatus: qData.status });
                    }
                    return {
                        requestContext: qData.requestContext,
                        questionText: qData.question,
                        knowledgeBaseCid: qData.cid,
                        submissionTimestamp: qData.timestamp,
                        finalResult: !isPendingStatus ? {
                             status: qData.status, requestContext: qData.requestContext,
                             question: qData.question, kbCid: qData.cid,
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
            addSystemMessage("⛔ Error: Received unexpected history data.", undefined, 'Error: Invalid Response Format');
            setUserHistory([]);
        }
        setIsHistoryLoading(false);
    }, [addSystemMessage]);

    const updateHistoryEntryWithFinalResult = useCallback((requestContext: string, finalResult: FinalVerificationResult) => {
        if (!requestContext || !finalResult) return;
        console.log(`[History State] Updating entry ${requestContext.substring(0,10)} with final result:`, finalResult.status);
        setUserHistory(prev => {
            const entryIndex = prev.findIndex(entry => entry.requestContext === requestContext);
            if (entryIndex === -1) {
                console.warn(`[History State] Cannot find entry ${requestContext} to update final result.`);
                return prev;
            }
            const updatedEntry: HistoryEntry = { ...prev[entryIndex], finalResult: finalResult };
            const updatedHistory = [...prev];
            updatedHistory[entryIndex] = updatedEntry;
            return updatedHistory;
        });
        setSelectedHistoryDetail(prev => {
            if (prev?.requestContext === requestContext) {
                return { ...prev, finalResult: finalResult };
            }
            return prev;
        });
    }, []);

    const connectWallet = useCallback(async () => {
        console.log("[App] Attempting to connect wallet...");
        setShowHistoryList(false); setSelectedHistoryDetail(null); setIsLoadingModalVisible(false); // Hide modal on connect
        if (typeof window.ethereum !== 'undefined') {
            try {
                const provider = new ethers.BrowserProvider(window.ethereum, 'any');
                await provider.send("eth_requestAccounts", []);
                const signer = await provider.getSigner();
                const signerAddress = await signer.getAddress();
                const checksumAddress = ethers.getAddress(signerAddress);
                setWalletAddress(checksumAddress);
                setMessages(prev => [prev.length > 0 ? prev[0] : createSystemMessage("Welcome!")]);
                await loadHistory(checksumAddress);
            } catch (error: any) {
                console.error("Wallet connection failed:", error);
                let friendlyError = 'Wallet connection failed.';
                if ((error as any).code === 4001) friendlyError = '⚠️ Wallet connection rejected by user.';
                else if ((error as any).message) friendlyError = `⚠️ Wallet connection failed: ${error.message?.split('(')[0] || 'Unknown error'}`;
                addSystemMessage(friendlyError);
                setWalletAddress(null); setUserHistory([]); setPendingRequests(new Map());
            }
        } else { addSystemMessage("🦊 Wallet not detected. Please install MetaMask or similar."); }
    }, [loadHistory, addSystemMessage]);

    const disconnectWallet = useCallback(() => {
        if (!walletAddress) return;
        const address = walletAddress;
        console.log(`[App] Disconnecting wallet ${address.substring(0,6)}...`);
        setWalletAddress(null); setUserHistory([]); setShowHistoryList(false);
        setSelectedHistoryDetail(null); setPendingRequests(new Map()); setIsLoadingModalVisible(false); // Hide modal on disconnect
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
            console.log("[Polling] Stopped interval due to wallet disconnect.");
        }
        setMessages(prev => [prev.length > 0 ? prev[0] : createSystemMessage("Welcome!")]);
        addSystemMessage(`Wallet ${address.substring(0, 6)}... disconnected.`);
    }, [walletAddress, addSystemMessage]);


    // --- Submit New Question Handler ---
    const handleSubmitForVerification = useCallback(async (question: string, knowledgeBaseCid: string) => {
        // Validation
        if (!question.trim() || !knowledgeBaseCid.trim()) {
            addSystemMessage("⛔ Please enter both a question and a Knowledge Base CID.", undefined, 'Error: Request Setup Failed'); return;
        }
        if (!/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[A-Za-z2-7]{58,})$/.test(knowledgeBaseCid)) {
            addSystemMessage(`⛔ Error: Invalid CID format provided: ${knowledgeBaseCid.substring(0,10)}...`, undefined, 'Error: Request Setup Failed'); return;
        }
        if (isApiCallInProgress || isLoadingModalVisible) return; // Prevent submit if API call or polling modal is active
        if (!walletAddress) { addSystemMessage("⚠️ Please connect your wallet first."); connectWallet(); return; }

        console.log(`[App] Submitting Q: "${question.substring(0,30)}...", CID: ${knowledgeBaseCid.substring(0,10)}...`);
        setIsApiCallInProgress(true); // Indicate API call start
        setLoadingModalMessage("Submitting Request..."); // Initial modal message
        setLoadingModalSubMessage(undefined);
        setLoadingModalContextId(undefined);
        
        const userTimestamp = Date.now();
        // Add User Message to chat
        addOrUpdateMessage({ id: userTimestamp, sender: 'User', text: `${question}\n(KB: ${knowledgeBaseCid.substring(0, 10)}...)` });
        setIsLoadingModalVisible(true)
        setLoadingModalContextId(userTimestamp.toString());

        setLoadingModalSubMessage(`${question}\n(KB: ${knowledgeBaseCid.substring(0, 10)}...)`);

        // Add temporary system message to chat (optional, modal is primary indicator)
        // addSystemMessage("⏳ Submitting request...", undefined, 'Processing');

        // Call apiService.askQuestion
        const response = await askQuestion(question, knowledgeBaseCid, walletAddress);


        // Handle acknowledgement
        if ('isError' in response) {
            console.error("[App] Backend Submission Failed:", response.error, response.details);
            addSystemMessage(`⛔ Backend submission failed: ${response.error || 'Unknown error'}`, undefined, 'Error: Network/Server Issue');
            // Don't show loading modal on error
            setIsLoadingModalVisible(false);
        } else if (response.requestContext) {
            console.log("[App] Backend Submission Acknowledged:", response);
            const contextId = response.requestContext;

            // **Show Loading Modal**
            setLoadingModalContextId(contextId);
            setLoadingModalMessage("Request Received");
            setLoadingModalSubMessage("Processing... Status: Submitted");
            setIsLoadingModalVisible(true); // Show modal now
            setLoadingModalMessage(`✅ Request submitted (ID: ${contextId.substring(0, 10)}). Processing...`, contextId, 'Submitted');
            // Add system message to chat confirming submission and start
            //addSystemMessage(`✅ Request submitted (ID: ${contextId.substring(0, 10)}). Processing...`, contextId, 'Submitted');

            // Add to pending requests map for polling
            setPendingRequests(prev => new Map(prev).set(contextId, { question, kbCid: knowledgeBaseCid, lastStatus: 'Submitted' }));

            // Add new entry to history immediately
            const newHistoryEntry: HistoryEntry = {
                requestContext: contextId, questionText: question,
                knowledgeBaseCid: knowledgeBaseCid, submissionTimestamp: new Date().toISOString(),
                finalResult: { status: 'Submitted', requestContext: contextId, question: question, kbCid: knowledgeBaseCid }, // Initial status
            };
            setUserHistory(prev => [newHistoryEntry, ...prev.sort((a, b) => new Date(b.submissionTimestamp).getTime() - new Date(a.submissionTimestamp).getTime())]); // Ensure sort order

        } else {
            console.error("[App] Backend acknowledgement missing requestContext:", response);
            addSystemMessage(`⛔ Backend error: Missing Request ID.`, undefined, 'Error: Invalid Response Format');
            setIsLoadingModalVisible(false); // Don't show modal if context ID is missing
        }
        setIsApiCallInProgress(false); // API call finished

    }, [isApiCallInProgress, isLoadingModalVisible, walletAddress, addSystemMessage, addOrUpdateMessage, connectWallet]); // Added isLoadingModalVisible


    // --- Status Polling Logic ---
    useEffect(() => {
        // Stop condition
        if (pendingRequests.size === 0 || !walletAddress) {
            if (pollingIntervalRef.current) {
                setIsApiCallInProgress(false);
                console.log("[Polling] Stopping interval (no pending requests or wallet disconnected).");
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
                 // Ensure modal is hidden if polling stops unexpectedly
                 if (isLoadingModalVisible && pendingRequests.size === 0) {
                     setIsLoadingModalVisible(false);
                 }
            }
            return;
        }
        setIsApiCallInProgress(true);
        // Start interval if not already running
        if (!pollingIntervalRef.current) {
            console.log(`[Polling] Starting polling interval for ${pendingRequests.size} request(s)...`);
            pollingIntervalRef.current = setInterval(async () => {
                console.log(`[Polling] Tick: Checking ${pendingRequests.size} pending request(s)...`);
                if (pendingRequests.size === 0) {
                    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
                    pollingIntervalRef.current = null;
                    console.log("[Polling] Stopping interval (queue empty).");
                     // Ensure modal is hidden
                     if (isLoadingModalVisible) setIsLoadingModalVisible(false);
                    return;
                }

                const checkPromises = Array.from(pendingRequests.entries()).map(
                    async ([contextId, queryInfo]) => {
                        try {
                            const result = await pollForResult(contextId, queryInfo.question, queryInfo.kbCid);

                            if ('isError' in result) {
                                console.error(`[Polling] Error polling ${contextId.substring(0, 10)}:`, result.error, result.details);
                                const errorStatus: VerificationStatus = (result.status === 404 || result.error?.includes('not found'))
                                    ? 'Error: Verification Failed' // Treat 404/not found during polling as failure
                                    : 'Error: Polling Failed';
                                addSystemMessage(`⛔ Error checking ${contextId.substring(0,10)}: ${result.error || 'Polling failed'}`, contextId, errorStatus);

                                // Update history and remove from pending
                                const errorResult: FinalVerificationResult = {
                                    requestContext: contextId, question: queryInfo.question, kbCid: queryInfo.kbCid,
                                    status: errorStatus, error: result.error, details: result.details
                                };
                                updateHistoryEntryWithFinalResult(contextId, errorResult);
                                setPendingRequests(prev => { const next = new Map(prev); next.delete(contextId); return next; });

                                // Hide modal if it was for this failed request
                                if (isLoadingModalVisible && loadingModalContextId === contextId) {
                                    setIsLoadingModalVisible(false);
                                    setIsApiCallInProgress(false);
                                }
                            } else { // Success path (intermediate or final)
                                // Assuming 'result' contains the backend response including status and the new flag
                                // Assuming 'VerificationStatus' is a type/enum for statuses
                                // Assuming 'TERMINAL_STATUSES' is an array/set of statuses that should close the modal
                                // Assuming 'isLoadingModalVisible', 'setIsLoadingModalVisible', 'loadingModalContextId',
                                // 'setLoadingModalMessage', 'setLoadingModalSubMessage', and 'contextId' are part of your component's state/props

                                const currentStatus = result.status as VerificationStatus; // Get the status from the result
                                const isTerminal = TERMINAL_STATUSES.includes(currentStatus); // Check if it's a terminal status

                                // --- MODIFICATION START ---

                                // Priority Check: Close modal immediately if evaluation.json exists
                                // This assumes 'result' object has a boolean property 'evaluationFileExists'
                                if (result.evaluationFileExists === true) {
                                    console.log("Evaluation file exists, closing loading modal."); // Optional logging
                                    setIsLoadingModalVisible(false);
                                    setIsApiCallInProgress(false);

                                }

                                // Commented out: Condition to close modal on PendingPayout is removed as requested
                                // if (currentStatus === "PendingPayout") {
                                //     console.log("Status is PendingPayout, closing loading modal."); // Optional logging
                                //     setIsLoadingModalVisible(false);
                                // }

                                // --- MODIFICATION END ---

                                // Existing logic to update/close modal based on terminal status or ongoing processing
                                // This block only runs if the modal hasn't already been closed by the evaluationFileExists check
                                if (isLoadingModalVisible && loadingModalContextId === contextId) {
                                    if (isTerminal) {
                                        // If the status is terminal (and the evaluation file didn't exist to close it sooner)
                                        console.log(`Terminal status (${currentStatus}) reached, closing loading modal.`); // Optional logging
                                        setIsLoadingModalVisible(false); // Hide modal on terminal status
                                    } else {
                                        // If the status is not terminal and the modal should still be visible
                                        setLoadingModalMessage("Processing Request..."); // Keep main message consistent
                                        setLoadingModalSubMessage(`Status: ${currentStatus}`); // Update sub-message with the current status
                                    }
                                }

                                // Rest of your state update logic or component rendering follows...

                                if (isTerminal) {
                                    console.log(`[Polling] Final result for ${contextId.substring(0, 10)}: Status ${currentStatus}`);
                                    const finalResult = result as FinalVerificationResult;
                                    const finalAiMessage: ChatMessage = {
                                        id: Date.now() + Math.random(), sender: 'AI',
                                        text: finalResult.answer || (currentStatus === 'NoValidAnswers' ? "[No valid answer submitted]" : "[No answer content received]"),
                                        verificationResult: finalResult, requestContext: contextId
                                    };
                                    setMessages(prev => [
                                        ...prev.filter(m => m.requestContext !== contextId || m.sender === 'User'),
                                        finalAiMessage
                                    ]);
                                    updateHistoryEntryWithFinalResult(contextId, finalResult);
                                    setPendingRequests(prev => {
                                        const next = new Map(prev);
                                        next.delete(contextId);
                                        console.log(`[Polling] Removed ${contextId.substring(0,10)} from pending. Remaining: ${next.size}`);
                                        return next;
                                    });

                                } else {
                                    // Still processing, update status if changed
                                    if (queryInfo.lastStatus !== currentStatus) {
                                        console.log(`[Polling] Status update for ${contextId.substring(0, 10)}: ${queryInfo.lastStatus} -> ${currentStatus}`);
                                        setPendingRequests(prev => new Map(prev).set(contextId, { ...queryInfo, lastStatus: currentStatus }));
                                        //addSystemMessage(`Processing... (Status: ${currentStatus}) ID: ${contextId.substring(0,10)}`, contextId, currentStatus);
                                    }
                                }
                            }
                        } catch (e: any) {
                            console.error(`[Polling] Unhandled exception checking ${contextId.substring(0,10)}:`, e);
                             addSystemMessage(`⛔ Critical error during poll for ${contextId.substring(0,10)}.`, contextId, 'Error: Unknown Client Issue');
                             const errorResult: FinalVerificationResult = { requestContext: contextId, question: queryInfo.question, kbCid: queryInfo.kbCid, status: 'Error: Unknown Client Issue', error: e.message || String(e) };
                             updateHistoryEntryWithFinalResult(contextId, errorResult);
                             setPendingRequests(prev => { const next = new Map(prev); next.delete(contextId); return next; });
                             // Hide modal on critical error
                             if (isLoadingModalVisible && loadingModalContextId === contextId) {
                                 setIsLoadingModalVisible(false);
                                 setIsApiCallInProgress(false);
                             }
                        }
                    }
                );
                await Promise.allSettled(checkPromises);

            }, POLLING_INTERVAL_MS);
        }

        // Cleanup
        return () => {
            if (pollingIntervalRef.current) {
                console.log("[Polling] Cleaning up polling interval.");
                clearInterval(pollingIntervalRef.current);
                setIsApiCallInProgress(false);
                setIsLoadingModalVisible(false);
                pollingIntervalRef.current = null;
            }
        };
    }, [pendingRequests, walletAddress, updateHistoryEntryWithFinalResult, addSystemMessage, isLoadingModalVisible, loadingModalContextId]); // Added modal state dependencies


    // --- History Detail View Handlers --- (Keep as before)
    const handleHistoryItemClick = useCallback(async (entry: HistoryEntry) => {
        console.log(`[History] Clicked item: ${entry.requestContext.substring(0,10)}`);
        setSelectedHistoryDetail(entry);
        setShowHistoryList(false);
        const needsUpdate = !entry.finalResult || !TERMINAL_STATUSES.includes(entry.finalResult.status as VerificationStatus);

        if (needsUpdate && !pendingRequests.has(entry.requestContext)) { // Only fetch if not actively polling
             console.log(`[History Detail] Fetching potentially updated details for ${entry.requestContext.substring(0,10)}...`);
             setSelectedHistoryDetail(prev => prev ? { ...prev, finalResult: { ...(prev.finalResult || {}), status: 'Processing', requestContext: entry.requestContext, question: entry.questionText, kbCid: entry.knowledgeBaseCid } } : null);

            const result = await pollForResult(entry.requestContext, entry.questionText, entry.knowledgeBaseCid || '');

             if ('isError' in result) {
                  console.error(`[History Detail] Error fetching details for ${entry.requestContext.substring(0,10)}:`, result.error);
                  const errorResult: FinalVerificationResult = {
                      requestContext: entry.requestContext, question: entry.questionText, kbCid: entry.knowledgeBaseCid || '',
                      status: 'Error: Polling Failed', error: result.error, details: result.details
                  };
                  updateHistoryEntryWithFinalResult(entry.requestContext, errorResult);
             } else {
                  const finalResult = result as FinalVerificationResult;
                  updateHistoryEntryWithFinalResult(entry.requestContext, finalResult);
             }
        } else if (needsUpdate && pendingRequests.has(entry.requestContext)) {
             console.log(`[History Detail] Request ${entry.requestContext.substring(0,10)} is still actively polling. Showing current state.`);
             // The selectedHistoryDetail already reflects the latest known state from history or polling map implicitly
        }
    }, [updateHistoryEntryWithFinalResult, pendingRequests]);

    const closeHistoryDetail = useCallback(() => {
        setSelectedHistoryDetail(null);
    }, []);

    // --- History List Display Helpers --- (Keep as before)
    const getHistoryDisplayQuestion = useCallback((entry: HistoryEntry): string => {
        const currentStatus = pendingRequests.get(entry.requestContext)?.lastStatus
                           ?? entry.finalResult?.status
                           ?? 'Unknown';
        let displayPrefix = `[${currentStatus}]`;
        if (TERMINAL_STATUSES.includes(currentStatus as VerificationStatus)) {
             const finalResult = entry.finalResult;
             if (finalResult?.status === 'Completed' || finalResult?.status === 'Verified' || finalResult?.status === 'PayoutComplete') {
                 displayPrefix = `[${finalResult.evaluation || 'Done'}]`;
             } else if (finalResult?.status === 'NoValidAnswers' || finalResult?.status === 'Error: No Valid Answers') {
                 displayPrefix = `[No Answer]`;
             } else if (finalResult?.status?.startsWith('Error:') || finalResult?.status?.startsWith('EvaluationFailed')) {
                 displayPrefix = `[Error]`;
             } else if (finalResult?.status?.startsWith('Flagged:')) {
                 displayPrefix = `[Flagged]`;
             } else { displayPrefix = `[${currentStatus}]`; }
        } else if (PENDING_STATUSES.includes(currentStatus as VerificationStatus)) {
            displayPrefix = '[Processing]';
        } else { displayPrefix = '[Unknown]'; }
         const questionSnippet = entry.questionText.length > 40 ? entry.questionText.substring(0, 37) + '...' : entry.questionText;
         return `${displayPrefix} ${questionSnippet}`;
    }, [pendingRequests]);

    const getHistoryTitle = useCallback((entry: HistoryEntry): string => {
        const time = new Date(entry.submissionTimestamp).toLocaleString();
        let statusText = "Loading...";
        if (pendingRequests.has(entry.requestContext)) {
            statusText = `Polling (${pendingRequests.get(entry.requestContext)?.lastStatus ?? 'Checking'})...`;
        } else if (entry.finalResult) {
            statusText = entry.finalResult.status;
            if (entry.finalResult.evaluation && (entry.finalResult.status === 'Completed' || entry.finalResult.status === 'Verified' || entry.finalResult.status === 'PayoutComplete')) {
                statusText += ` (${entry.finalResult.evaluation})`;
            }
            if (entry.finalResult.error) { statusText += ` - ${entry.finalResult.error}`; }
        }
        return `Q: ${entry.questionText}\nCID: ${entry.knowledgeBaseCid}\nSubmitted: ${time}\nStatus: ${statusText}`;
    }, [pendingRequests]);


    // --- Render ---
    return (
        <div className="flex flex-col h-screen max-w-5xl mx-auto p-4 md:p-6 bg-gradient-to-br from-gray-100 to-blue-100 dark:from-gray-900 dark:to-slate-800 relative font-sans overflow-hidden">
            {/* Loading Modal */}
            <LoadingModal
                isVisible={isLoadingModalVisible}
                message={loadingModalMessage}
                subMessage={loadingModalSubMessage}
                contextId={loadingModalContextId}
            />

            {/* Header */}
            <header className="mb-4 text-center shrink-0 pt-4 md:pt-6 relative z-20">
                {/* Wallet & History Buttons */}
                 <div className="absolute top-0 right-0 flex items-center space-x-2 p-2">
                     {!walletAddress ? (
                        <button onClick={connectWallet} disabled={isLoadingModalVisible} className="px-3 py-1.5 bg-kintask-blue text-white rounded-md hover:bg-kintask-blue-dark text-sm transition-colors shadow-md focus:outline-none focus:ring-2 focus:ring-kintask-blue focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"> Connect Wallet </button>
                     ) : (
                        <>
                         <button onClick={() => { setShowHistoryList(prev => !prev); setSelectedHistoryDetail(null); }} disabled={isHistoryLoading || isLoadingModalVisible} className={`px-3 py-1.5 rounded-md text-sm transition-colors shadow flex items-center space-x-1 ${ isHistoryLoading ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-wait opacity-70 animate-pulse' : userHistory.length === 0 ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed opacity-70' : 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed' }`} title={showHistoryList ? "Hide History" : (userHistory.length > 0 ? "Show History" : "No History Yet")}>
                             {isHistoryLoading ? <div className="h-4 w-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div> : <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                             <span>({isHistoryLoading ? '...' : userHistory.length})</span>
                         </button>
                         <button onClick={disconnectWallet} disabled={isLoadingModalVisible} title="Disconnect Wallet" className="px-2 py-1.5 bg-red-500 text-white rounded-md hover:bg-red-600 text-sm transition-colors shadow focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed">
                             <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                         </button>
                        </>
                     )}
                 </div>

                 {/* Main Title Area */}
                 <img src="/kintask-logo.png" alt="Kintask Logo" className="h-16 md:h-20 w-auto mx-auto mb-2 rounded-lg shadow-md" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                 <h1 className="text-3xl md:text-4xl font-bold text-kintask-blue dark:text-kintask-blue-light tracking-tight">Kintask</h1>
                 <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Verifiable AI Q&A with Decentralized Trust</p>
                 {walletAddress && ( <p className="text-xs text-green-600 dark:text-green-400 mt-1 font-mono" title={walletAddress}> Connected: {walletAddress.substring(0, 6)}...{walletAddress.substring(walletAddress.length - 4)} </p> )}
            </header>

            {/* Main Chat Area */}
            <div className="flex flex-col flex-grow min-h-0 rounded-lg shadow-inner overflow-hidden bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border border-gray-200 dark:border-gray-700 relative z-10 mt-2">
                 {/* Chat Interface - Pass prop to disable input when modal is shown */}
                 <ChatInterface
                     messages={messages}
                     onSendMessage={handleSubmitForVerification}
                     addSystemMessage={addSystemMessage}
                     isLoading={isApiCallInProgress} // Loading state specific to API call
                     isInputDisabled={isLoadingModalVisible} // Disable input while modal/polling is active
                 />
            </div>

            {/* Footer Section */}
            <footer className="mt-4 text-center text-xs text-gray-400 dark:text-gray-500 shrink-0 relative z-10">
                 Encode Club AI Blueprints | Kintask Demo
            </footer>

            {/* History Panel (List) - Conditionally render based on modal visibility too? */}
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
                                const isError = entry.finalResult?.status?.startsWith('Error');
                                return (
                                    <li key={key}>
                                        <button
                                            onClick={() => handleHistoryItemClick(entry)}
                                            className={`w-full text-left text-xs px-2 py-1.5 rounded truncate transition-colors ${
                                                isPending
                                                ? 'text-gray-500 dark:text-gray-400 italic hover:bg-gray-100 dark:hover:bg-gray-700 animate-pulse'
                                                : isError
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

            {/* History Detail Modal - Conditionally render based on modal visibility */}
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
                              {selectedHistoryDetail.knowledgeBaseCid && ( <div> <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-1">Knowledge Base CID:</p> <p className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded text-gray-800 dark:text-gray-200 text-xs break-all font-mono border dark:border-gray-600"><a href={`${IPFS_GATEWAY_URL}${selectedHistoryDetail.knowledgeBaseCid}`} target="_blank" rel="noopener noreferrer" className="hover:underline text-kintask-blue dark:text-kintask-blue-light">{selectedHistoryDetail.knowledgeBaseCid}</a></p> </div> )}
                             {/* Submission Time */}
                              {selectedHistoryDetail.submissionTimestamp && ( <div> <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">Submitted:</p> <p className="text-gray-700 dark:text-gray-300 text-xs">{new Date(selectedHistoryDetail.submissionTimestamp).toLocaleString()}</p> </div> )}

                             {/* Final Answer/Status Bubble */}
                             <div>
                                 <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-1">Result:</p>
                                  {/* Use MessageDisplay for consistent rendering */}
                                  <MessageDisplay message={{
                                       id: Date.now(), // Dummy ID
                                       sender: 'AI',
                                       text: selectedHistoryDetail.finalResult?.answer
                                           || (pendingRequests.has(selectedHistoryDetail.requestContext) ? `[Processing... Status: ${pendingRequests.get(selectedHistoryDetail.requestContext)?.lastStatus ?? 'Checking'}]` : '[No Answer Data]'),
                                       verificationResult: selectedHistoryDetail.finalResult ?? {
                                            requestContext: selectedHistoryDetail.requestContext,
                                            question: selectedHistoryDetail.questionText,
                                            kbCid: selectedHistoryDetail.knowledgeBaseCid || '',
                                            status: pendingRequests.get(selectedHistoryDetail.requestContext)?.lastStatus ?? 'Processing'
                                       },
                                       isLoading: pendingRequests.has(selectedHistoryDetail.requestContext) // Show loading in bubble if still polling
                                   }} />
                             </div>
                         </div>
                     </div>
                 </div>
             )}

        </div>
    );
}

export default App;
// kintask/packages/frontend/src/App.tsx