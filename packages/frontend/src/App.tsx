// kintask/packages/frontend/src/App.tsx

import React, { useState, useCallback, useEffect } from 'react';
import { ethers } from 'ethers';

// Core Components & Services
import ChatInterface from '@/components/ChatInterface';
import MessageBubble from '@/components/MessageBubble'; // For History Detail View
import { askQuestion, getVerificationResult } from '@/services/apiService'; // Use correct function name

// Type Definitions
import {
    ChatMessage,
    ApiVerifyResponse, // Represents the *final* result structure
    // AskApiResponse, // Type for initial backend ack, define VerifySubmissionResponse below
    ApiErrorResponse,  // Represents errors from apiService
    HistoryEntry,
    VerificationStatus
} from '@/types';

// Type for the acknowledgement response from backend POST /verify
interface VerifySubmissionResponse { message: string; requestContext: string; }


const LOCAL_STORAGE_HISTORY_PREFIX = 'kintask_history_v1_';

// --- Helper Function ---
function createSystemMessage(
    text: string,
    requestContext?: string,
    status: VerificationStatus | 'System Notification' | 'Pending Verification' = 'System Notification'
): ChatMessage {
    const apiResponsePart = status !== 'System Notification'
        ? { status: status, answer: "" } as Partial<ApiVerifyResponse>
        : null;
    return {
        id: Date.now() + Math.random(),
        sender: 'System',
        text: text,
        apiResponse: apiResponsePart,
        requestContext: requestContext,
    };
}

// --- App Component ---
function App() {
  // --- State ---
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
      createSystemMessage("Welcome! Connect wallet to view history. Ask a question & provide KB source (attach file or paste CID).")
    ]);
  const [isSubmitting, setIsSubmitting] = useState(false); // Tracks if backend submission/polling is active
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [userHistory, setUserHistory] = useState<HistoryEntry[]>([]);
  const [showHistoryList, setShowHistoryList] = useState<boolean>(false);
  const [selectedHistoryDetail, setSelectedHistoryDetail] = useState<HistoryEntry | null>(null);
  const [pendingRequests, setPendingRequests] = useState<Map<string, { question: string; kbCid: string }>>(new Map());


  // --- Callback Functions ---
  const addSystemMessage = useCallback((text: string, requestContext?: string) => {
      console.log(`[System Message][${requestContext || 'General'}]: ${text}`);
      const systemMessage = createSystemMessage(text, requestContext);
      setMessages(prev => [...prev, systemMessage]);
  }, []);

  const addOrUpdateMessage = useCallback((newMessage: ChatMessage) => {
      setMessages(prev => {
          const existingIndex = prev.findIndex(msg => msg.id === newMessage.id);
          if (existingIndex !== -1) {
               const updatedMessages = [...prev]; updatedMessages[existingIndex] = newMessage; return updatedMessages;
           } else { return [...prev, newMessage]; }
      });
  }, []);


  // --- Wallet & History Logic ---

  // Loads history from localStorage for the connected address
  const loadHistory = useCallback((address: string) => {
    if (!address) return;
    console.log(`[History] Loading history for ${address.substring(0,10)}...`);
    const storedHistory = localStorage.getItem(`${LOCAL_STORAGE_HISTORY_PREFIX}${address}`);
    let validHistory: HistoryEntry[] = [];
    let initialPending = new Map<string, { question: string; kbCid: string }>();

    if (storedHistory) {
      try {
        const parsedHistory = JSON.parse(storedHistory);
        if (Array.isArray(parsedHistory)) {
          validHistory = parsedHistory.filter(
            // Basic validation for required fields
            entry => entry && typeof entry.questionText === 'string' && typeof entry.requestContext === 'string' && entry.knowledgeBaseCid // Only load entries linked to verification
          );
          // Populate pending requests map for polling resume
          validHistory.forEach(entry => {
              // If aiMessage is missing OR its status indicates processing, consider it pending
              if (entry.knowledgeBaseCid && (!entry.aiMessage || entry.aiMessage.apiResponse?.status === 'Processing' || entry.aiMessage.apiResponse?.status === 'Pending Verification')) {
                 initialPending.set(entry.requestContext, { question: entry.questionText, kbCid: entry.knowledgeBaseCid });
              }
          });
          console.log(`[History] Loaded ${validHistory.length} entries. Identified ${initialPending.size} pending requests.`);
        } else {
             console.warn("[History] Parsed history is not an array.");
        }
      } catch (error) {
        console.error("[History] Error parsing history:", error);
        // Optionally clear corrupted storage: localStorage.removeItem(`${LOCAL_STORAGE_HISTORY_PREFIX}${address}`);
      }
    }
    setUserHistory(validHistory);
    setPendingRequests(initialPending);
  }, []); // No dependencies needed

  // Saves a new entry when verification is submitted
  const savePendingHistoryEntry = useCallback((requestContext: string, question: string, kbCid: string) => {
       if (!walletAddress || !requestContext || !question || !kbCid) return;
       console.log(`[History] Saving PENDING entry: ${requestContext.substring(4,10)}`);

       const newEntry: HistoryEntry = {
            questionText: question,
            knowledgeBaseCid: kbCid, // Must have CID for verifiable history
            requestContext: requestContext,
            // aiMessage is undefined initially
        };

       setUserHistory(prev => {
            // Prevent duplicates
            if (prev.some(h => h.requestContext === newEntry.requestContext)) {
                console.warn(`[History] Attempted to save duplicate pending entry for ${requestContext}`);
                return prev;
            }
            // Add to start of array
            const updated = [newEntry, ...prev];
            try {
                 localStorage.setItem(`${LOCAL_STORAGE_HISTORY_PREFIX}${walletAddress}`, JSON.stringify(updated));
                 console.log("[History] Saved pending entry:", newEntry.requestContext);
            } catch (e: any) {
                console.error("[History] Failed to save pending entry to localStorage:", e.message);
                 addSystemMessage(`⚠️ Failed to save query to history: ${e.message}`);
                 return prev.filter(entry => entry.requestContext !== newEntry.requestContext); // Revert
            }
            return updated;
       });
  }, [walletAddress, addSystemMessage]); // Added addSystemMessage dependency


  // Updates history when final verification result is polled
  const updateHistoryEntryWithResult = useCallback((requestContext: string, finalAiMessage: ChatMessage) => {
     if (!walletAddress || !requestContext || !finalAiMessage?.apiResponse) return;
      console.log(`[History] Updating entry with final result: ${requestContext.substring(4,10)}`);

      setUserHistory(prev => {
           const entryIndex = prev.findIndex(entry => entry.requestContext === requestContext);
           if (entryIndex === -1) {
               console.error(`[History] Cannot find entry with context ${requestContext} to update.`);
               return prev;
           }

            // Create updated entry, preserving original question/CID but adding final AI message
            const updatedEntry: HistoryEntry = {
                ...prev[entryIndex], // Keep original questionText, kbCid, requestContext
                aiMessage: finalAiMessage // Add the complete final message object
            };

            const updatedHistory = [...prev];
            updatedHistory[entryIndex] = updatedEntry;

            try {
                 localStorage.setItem(`${LOCAL_STORAGE_HISTORY_PREFIX}${walletAddress}`, JSON.stringify(updatedHistory));
                 console.log("[History] Updated entry with result:", requestContext);
            } catch (e: any) {
                console.error("[History] Failed to save updated entry to localStorage:", e.message);
                 addSystemMessage(`⚠️ Failed to save result to history: ${e.message}`);
                 // return prev; // Optional: revert state on save fail
            }
            return updatedHistory;
      });

  }, [walletAddress, addSystemMessage]); // Added addSystemMessage dependency


  // Connect Wallet Function
  const connectWallet = useCallback(async () => {
    console.log("[App] Attempting to connect wallet...");
    setShowHistoryList(false); setSelectedHistoryDetail(null); // Close history panels
    // Check if MetaMask (or similar provider) is installed
    if (typeof window.ethereum !== 'undefined') {
      try {
        // Use ethers v6 BrowserProvider
        const provider = new ethers.BrowserProvider(window.ethereum, 'any'); // 'any' allows network changes
        // Request account access
        await provider.send("eth_requestAccounts", []);
        const signer = await provider.getSigner();
        const signerAddress = await signer.getAddress();

        if (signerAddress) {
            const checksumAddress = ethers.getAddress(signerAddress); // Get checksummed address
            setWalletAddress(checksumAddress);
            addSystemMessage(`Wallet ${checksumAddress.substring(0, 6)}...${checksumAddress.substring(checksumAddress.length - 4)} connected.`);
            loadHistory(checksumAddress); // Load history for the connected address
        } else {
             addSystemMessage("⚠️ Could not retrieve wallet address after connection.");
        }
      } catch (error: any) {
          console.error("Failed to connect wallet:", error);
          let errorMsg = "Failed to connect wallet.";
          if (error.code === 4001) { // User rejected connection
              errorMsg = "Wallet connection request rejected.";
          } else if (error.message) {
              errorMsg += ` ${error.message}`;
          }
          addSystemMessage(`⛔ ${errorMsg}`);
          setWalletAddress(null); // Ensure wallet is null on error
       }
    } else {
        addSystemMessage("🦊 MetaMask (or other Ethereum wallet) not detected. Please install a wallet extension.");
    }
  }, [loadHistory, addSystemMessage]); // Dependencies

  // Disconnect Wallet Function
  const disconnectWallet = useCallback(() => {
      if (!walletAddress) return;
      const address = walletAddress;
      console.log(`[App] Disconnecting wallet ${address.substring(0,6)}...`);
      setWalletAddress(null);
      setUserHistory([]); // Clear history state
      setShowHistoryList(false);
      setSelectedHistoryDetail(null);
      setPendingRequests(new Map()); // Clear pending requests
      // Optionally clear localStorage for the disconnected address?
      // localStorage.removeItem(`${LOCAL_STORAGE_HISTORY_PREFIX}${address}`);
      setMessages(prev => [prev[0]]); // Keep only initial welcome message? Or clear all?
      addSystemMessage(`Wallet ${address.substring(0, 6)}... disconnected.`);
  }, [walletAddress, addSystemMessage]);


  // --- Main Handler for triggering Backend Verification ---
  const handleSubmitForVerification = useCallback(async (question: string, knowledgeBaseCid: string) => {
    // Validation
    if (!question || !knowledgeBaseCid) {
        console.error("[App] handleSubmitForVerification called with missing data!");
        addSystemMessage("⛔ Error: Missing question or KB CID for verification.");
        return;
    }
    if (!(knowledgeBaseCid.startsWith('Qm') || knowledgeBaseCid.startsWith('baf'))) {
         console.error(`[App] Invalid CID format: ${knowledgeBaseCid}`);
         addSystemMessage(`⛔ Error: Invalid KB CID format.`);
         return;
     }
    if (isSubmitting) { console.warn("[App] Ignoring submission, already processing."); return; }
    // Require wallet connection to save history and potentially resume polling
     if (!walletAddress) {
         addSystemMessage("⚠️ Please connect your wallet to submit verifiable queries and save history.");
         connectWallet(); // Prompt user to connect
         return;
     }

    setIsSubmitting(true);

    // Add User Message using the callback prop passed to ChatInterface
    const userTimestamp = Date.now();
    const userMessageText = `${question}\n(Verifying with KB CID: ${knowledgeBaseCid.substring(0, 10)}...)`;
    addOrUpdateMessage({ id: userTimestamp, sender: 'User', text: userMessageText, apiResponse: null });

    addSystemMessage(`Submitting request for backend verification...`);

    // Call apiService.askQuestion
    const response = await askQuestion(question, knowledgeBaseCid);

    // Handle acknowledgement response
     if ('isError' in response && response.isError) {
         console.error("[App] Backend Submission Failed:", response.error, response.details);
         addSystemMessage(`⛔ Backend submission failed: ${response.error || 'Unknown error'}`);
     } else if (response.requestContext) {
         // Submission acknowledged
         console.log("[App] Backend Submission Acknowledged:", response);
         addSystemMessage(`✅ Request submitted (ID: ${response.requestContext.substring(4,10)}). Polling for results...`, response.requestContext, 'Pending Verification');
         setPendingRequests(prev => new Map(prev).set(response.requestContext, { question, kbCid: knowledgeBaseCid }));
         savePendingHistoryEntry(response.requestContext, question, knowledgeBaseCid); // Save to history
     } else {
          // Unexpected success response format
          console.error("[App] Backend acknowledgement missing requestContext:", response);
          addSystemMessage(`⛔ Backend error: Submission acknowledged but missing request ID.`);
     }
     setIsSubmitting(false); // End submitting state after acknowledgement/initial error

  }, [isSubmitting, walletAddress, addSystemMessage, savePendingHistoryEntry, addOrUpdateMessage, connectWallet]); // Added connectWallet


  // --- Status Checking Logic (Polling Example) ---
  useEffect(() => {
      // Only poll if wallet connected and there are pending requests
      if (pendingRequests.size === 0 || !walletAddress) return;

      const intervalId = setInterval(async () => {
          console.log(`[Status Check] Checking ${pendingRequests.size} pending request(s)...`);
          // Create check promises for each pending request
          const checkPromises = Array.from(pendingRequests.entries()).map(async ([contextId, queryInfo]) => {
             try {
                const result = await getVerificationResult(contextId, queryInfo); // Call API service

                if ('isError' in result && result.isError) {
                     console.error(`[Status Check] Error fetching status for ${contextId}:`, result.error);
                     // Consider removing from pending after N errors? For now, keep retrying.
                } else if (result.status !== 'Processing' && result.status !== 'Pending Verification') {
                    // Final status received (Success or Backend Error Status like 'Error:...')
                    console.log(`[Status Check] Final result received for ${contextId}: Status ${result.status}`);
                    const finalAiMessage: ChatMessage = {
                        id: Date.now() + Math.random(), sender: 'AI',
                        text: result.answer, apiResponse: result, requestContext: contextId
                    };
                    // Add/Update message in chat list
                    addOrUpdateMessage(finalAiMessage);
                    // Update history entry with final result
                    updateHistoryEntryWithResult(contextId, finalAiMessage);
                    // Remove from pending map
                    setPendingRequests(prev => {
                        const next = new Map(prev);
                        next.delete(contextId);
                        console.log(`[Status Check] Removed ${contextId} from pending. Remaining: ${next.size}`);
                        return next;
                    });
                } else {
                    // Still processing according to backend
                    console.log(`[Status Check] Request ${contextId} still processing (Status: ${result.status})`);
                }
             } catch (e) { console.error(`[Status Check] Unhandled error checking ${contextId}:`, e); }
          });
          // Wait for all checks in this batch to complete (or fail)
          await Promise.allSettled(checkPromises);
      }, 15000); // Polling interval: 15 seconds

      // Cleanup function to clear interval when component unmounts or dependencies change
      return () => {
          console.log("[Status Check] Clearing polling interval.");
          clearInterval(intervalId);
      };
  // Dependencies: re-run effect if pending requests change, wallet connects/disconnects, or history update fn changes
  }, [pendingRequests, walletAddress, updateHistoryEntryWithResult, addOrUpdateMessage]);


  // --- History Detail View Handlers ---
  const handleHistoryItemClick = useCallback((entry: HistoryEntry) => {
      // Check if the entry has a final AI message with a non-processing status
      if (entry.aiMessage?.apiResponse && entry.aiMessage.apiResponse.status !== 'Processing' && entry.aiMessage.apiResponse.status !== 'Pending Verification') {
        setSelectedHistoryDetail(entry);
        setShowHistoryList(false); // Close list when showing detail
      } else {
         // Item is still pending or lacks the final result structure
         console.log("Clicked pending/incomplete history item:", entry.requestContext);
         addSystemMessage(`Result for request "${entry.questionText.substring(0,20)}..." (ID: ${entry.requestContext.substring(4,10)}) is still pending.`);
         setShowHistoryList(false);
      }
  }, [addSystemMessage]); // Added dependency

  const closeHistoryDetail = useCallback(() => { setSelectedHistoryDetail(null); }, []);

  // Helper to format history list items
  const getHistoryDisplayQuestion = useCallback((entry: HistoryEntry): string => {
      const kbCidPart = entry.knowledgeBaseCid ? ` (KB: ${entry.knowledgeBaseCid.substring(0, 6)}...)` : '';
      const isPending = (!entry.aiMessage || entry.aiMessage.apiResponse?.status === 'Processing' || entry.aiMessage.apiResponse?.status === 'Pending Verification');
      const statusIndicator = isPending ? ' (Pending)' : ` (${entry.aiMessage?.apiResponse?.status || 'Unknown'})`; // Show final status
      const questionPart = entry.questionText.length > 35 ? entry.questionText.substring(0, 32) + '...' : entry.questionText; // Truncate slightly more
      return `${questionPart}${kbCidPart}${statusIndicator}`;
  }, []);

   // Helper for history item titles
   const getHistoryTitle = useCallback((entry: HistoryEntry): string => {
       const isPending = (!entry.aiMessage || entry.aiMessage.apiResponse?.status === 'Processing' || entry.aiMessage.apiResponse?.status === 'Pending Verification');
       const statusHint = isPending ? '(Pending - Polling for result)' : `(Status: ${entry.aiMessage?.apiResponse?.status})`;
       return `View details for: ${entry.questionText} ${statusHint}`;
   }, []);


  // --- Render ---
  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto p-4 md:p-6 bg-gradient-to-br from-gray-50 to-blue-50 dark:from-gray-900 dark:to-gray-800 relative font-sans">
        {/* Header */}
        <header className="mb-4 text-center shrink-0 pt-4 md:pt-6">
             <img src="/kintask-logo.png" alt="Kintask Logo" className="h-16 md:h-20 w-auto mx-auto mb-2 rounded-lg shadow-md" onError={(e) => (e.currentTarget.style.display = 'none')} />
             <h1 className="text-3xl md:text-4xl font-bold text-blue-600 dark:text-blue-400 tracking-tight">Kintask</h1>
             <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Verifiable AI Q&A with Decentralized Trust</p>
             {walletAddress && ( <p className="text-xs text-green-600 dark:text-green-400 mt-1 font-mono" title={walletAddress}> Wallet: {walletAddress.substring(0, 6)}...{walletAddress.substring(walletAddress.length - 4)} </p> )}
        </header>

        {/* Wallet & History Buttons */}
        <div className="absolute top-4 right-4 flex space-x-2 z-20">
          {!walletAddress ? (
            <button onClick={connectWallet} className="px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm transition-colors shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
              Connect Wallet
            </button>
          ) : (
            <>
              <button onClick={() => { setShowHistoryList(prev => !prev); setSelectedHistoryDetail(null); }} disabled={userHistory.length === 0} className={`px-3 py-1.5 rounded-md text-sm transition-colors shadow ${ userHistory.length > 0 ? 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-1' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed opacity-70' }`} title={showHistoryList ? "Hide History" : (userHistory.length > 0 ? "Show History" : "No History Yet")}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> ({userHistory.length})
              </button>
              <button onClick={disconnectWallet} title="Disconnect Wallet" className="px-3 py-1.5 bg-red-500 text-white rounded-md hover:bg-red-600 text-sm transition-colors shadow focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
              </button>
            </>
          )}
        </div>

        {/* Main Chat Area */}
        <div style={{overflow:"auto"}}className="flex-grow min-h-0 rounded-lg shadow-inner overflow-hidden bg-white dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700">
            <ChatInterface
                messages={messages}
                onSendMessage={handleSubmitForVerification} // Pass backend handler
                // Pass the implemented system message callback
                addSystemMessage={addSystemMessage}
                // Pass the message adder callback (used by ChatInterface to add user message)
                addAiMessage={addOrUpdateMessage}
            />
        </div>

        {/* Footer Section */}
        <footer className="mt-4 text-center text-xs text-gray-400 dark:text-gray-500 shrink-0">
             Encode Club AI Blueprints | Kintask Demo
        </footer>

        {/* History Panel (List) */}
        {walletAddress && showHistoryList && (
            <div className="absolute top-16 right-4 w-72 max-h-[60vh] overflow-y-auto bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-xl p-3 z-30">
                 <div className="flex justify-between items-center mb-2 border-b pb-1.5 dark:border-gray-600 sticky top-0 bg-white dark:bg-gray-800 px-1 -mx-1">
                     <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Query History</h3>
                     <button onClick={() => setShowHistoryList(false)} className="p-1 rounded-full text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700" title="Close History"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                 </div>
                {userHistory.length > 0 ? (
                    <ul className="space-y-1">
                        {userHistory.map((entry, index) => { // Display history, newest first
                            const displayQuestion = getHistoryDisplayQuestion(entry);
                            const titleText = getHistoryTitle(entry);
                            const key = `${entry.requestContext}-${index}`;
                            return (
                                <li key={key}>
                                    <button onClick={() => handleHistoryItemClick(entry)} className={`w-full text-left text-xs px-2 py-1.5 rounded truncate transition-colors ${!entry.aiMessage || entry.aiMessage.apiResponse?.status === 'Processing' ? 'text-gray-500 dark:text-gray-400 italic hover:bg-gray-100 dark:hover:bg-gray-700' : 'text-gray-700 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-blue-900/30'}`} title={titleText}>
                                        {displayQuestion}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                ) : ( <p className="text-xs text-center text-gray-500 dark:text-gray-400 italic py-2">No saved history for this wallet.</p> )}
            </div>
        )}

        {/* History Detail View (Modal) */}
         {walletAddress && selectedHistoryDetail && selectedHistoryDetail.aiMessage?.apiResponse && (
             <div className="fixed inset-0 bg-black bg-opacity-60 dark:bg-opacity-75 flex justify-center items-center p-4 z-40 backdrop-blur-sm animate-fade-in" onClick={closeHistoryDetail} >
                 <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-4 md:p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-400 dark:scrollbar-thumb-gray-600" onClick={(e) => e.stopPropagation()} >
                     {/* Modal Header */}
                     <div className="flex justify-between items-center mb-3 border-b pb-2 dark:border-gray-600"> <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Query History Detail</h3> <button onClick={closeHistoryDetail} className="p-1 rounded-full text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600" title="Close Details"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button> </div>
                     {/* Modal Content */}
                     <div className="space-y-4">
                         {/* Question Section */}
                         <div> <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">Question:</p> <p className="p-2 bg-gray-100 dark:bg-gray-700 rounded text-gray-800 dark:text-gray-200 whitespace-pre-wrap text-sm">{selectedHistoryDetail.questionText}</p> </div>
                         {/* KB CID Section */}
                         {selectedHistoryDetail.knowledgeBaseCid && ( <div> <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">Knowledge Base CID:</p> <p className="p-2 bg-gray-100 dark:bg-gray-700 rounded text-gray-800 dark:text-gray-200 text-xs break-all font-mono">{selectedHistoryDetail.knowledgeBaseCid}</p> </div> )}
                         {/* Request Context ID */}
                         {selectedHistoryDetail.requestContext && ( <div> <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">Request ID:</p> <p className="p-2 bg-gray-100 dark:bg-gray-700 rounded text-gray-800 dark:text-gray-200 text-xs font-mono">{selectedHistoryDetail.requestContext}</p> </div> )}
                         {/* Answer Section */}
                         <div> <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">Answer & Verification:</p> <MessageBubble message={{ ...selectedHistoryDetail.aiMessage, isLoading: false }} /> </div>
                     </div>
                 </div>
             </div>
         )}

    </div>
  );
}

export default App;