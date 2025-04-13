// kintask/packages/frontend/src/App.tsx

import React, { useState, useCallback, useEffect } from 'react';
import { ethers } from 'ethers';

// Core Components & Services
import ChatInterface from '@/components/ChatInterface'; // Assuming path alias works
import MessageBubble from '@/components/MessageBubble'; // For History Detail View
import { askQuestion, getVerificationResult } from '@/services/apiService'; // Use correct function name

// Type Definitions (ensure these align with your actual types file)
import {
    ChatMessage,
    ApiVerifyResponse, // Represents the *final* result structure from backend /status
    ApiErrorResponse,  // Represents errors from apiService
    HistoryEntry,      // Structure for storing past queries/results
    VerificationStatus // Enum/Type for status strings
} from '@/types'; // Adjust path if necessary

// Type for the acknowledgement response from backend POST /verify
interface VerifySubmissionResponse { message: string; requestContext: string; }


const LOCAL_STORAGE_HISTORY_PREFIX = 'kintask_history_v1_'; // Added versioning

// --- Helper Function ---
function createSystemMessage(
    text: string,
    requestContext?: string,
    // Allow 'System Notification' as a distinct status type
    status: VerificationStatus | 'System Notification' | 'Pending Verification' = 'System Notification'
): ChatMessage {
    // Structure apiResponse only if it's not a basic notification
    const apiResponsePart = status !== 'System Notification'
        ? { status: status, answer: "" } as Partial<ApiVerifyResponse> // Use partial type
        : null;
    return {
        id: Date.now() + Math.random(), // Simple unique ID
        sender: 'System',
        text: text,
        apiResponse: apiResponsePart, // Use partial structure or null
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
  // State for the history detail modal content (null when closed)
  const [selectedHistoryDetail, setSelectedHistoryDetail] = useState<HistoryEntry | null>(null);
  // Tracks requests currently being polled for results
  const [pendingRequests, setPendingRequests] = useState<Map<string, { question: string; kbCid: string }>>(new Map());


  // --- Callback Functions ---

  // Adds a system message to the main chat window
  const addSystemMessage = useCallback((text: string, requestContext?: string) => {
      console.log(`[System Message][${requestContext || 'General'}]: ${text}`);
      const systemMessage = createSystemMessage(text, requestContext);
      // Update messages state using functional update for safety
      setMessages(prev => [...prev, systemMessage]);
  }, []); // This callback function itself doesn't change

  // Adds a new message (User or AI) or updates an existing one (e.g., AI loading placeholder)
  // Passed to ChatInterface as addAiMessage prop
  const addOrUpdateMessage = useCallback((newMessage: ChatMessage) => {
      setMessages(prev => {
          const existingIndex = prev.findIndex(msg => msg.id === newMessage.id);
          if (existingIndex !== -1) { // Update existing
               const updatedMessages = [...prev];
               updatedMessages[existingIndex] = newMessage;
               console.log(`[App State] Updated message ID: ${newMessage.id}`);
               return updatedMessages;
           } else { // Add new
               console.log(`[App State] Added new ${newMessage.sender} message ID: ${newMessage.id}`);
               return [...prev, newMessage];
           }
      });
  }, []); // This callback function itself doesn't change


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
            entry => entry && typeof entry.questionText === 'string' && typeof entry.requestContext === 'string' && entry.knowledgeBaseCid
          );
          // Populate pending requests map for polling resume
          validHistory.forEach(entry => {
              if (entry.knowledgeBaseCid && (!entry.aiMessage || entry.aiMessage.apiResponse?.status === 'Processing' || entry.aiMessage.apiResponse?.status === 'Pending Verification')) {
                 initialPending.set(entry.requestContext, { question: entry.questionText, kbCid: entry.knowledgeBaseCid });
              }
          });
          console.log(`[History] Loaded ${validHistory.length} entries. Identified ${initialPending.size} pending requests.`);
        } else { console.warn("[History] Parsed history is not an array."); }
      } catch (error) { console.error("[History] Error parsing history:", error); }
    }
    // Sort history by timestamp derived from requestContext ID (newest first) before setting state
     validHistory.sort((a, b) => {
         const timeA = parseInt(a.requestContext.split('_')[1] || '0');
         const timeB = parseInt(b.requestContext.split('_')[1] || '0');
         return timeB - timeA; // Descending order
     });
    setUserHistory(validHistory);
    setPendingRequests(initialPending);
  }, []); // loadHistory only depends on the prefix constant

  // Saves a new entry when verification is submitted
  const savePendingHistoryEntry = useCallback((requestContext: string, question: string, kbCid: string) => {
       if (!walletAddress || !requestContext || !question || !kbCid) {
            console.error("[History] Attempted to save pending entry with missing data.");
            return;
       }
       console.log(`[History] Saving PENDING entry: ${requestContext.substring(4,10)}`);
       const newEntry: HistoryEntry = { questionText: question, knowledgeBaseCid: kbCid, requestContext, submissionTimestamp: new Date().toISOString() };

       setUserHistory(prev => {
            if (prev.some(h => h.requestContext === newEntry.requestContext)) { console.warn(`[History] Duplicate pending entry ignored: ${requestContext}`); return prev; }
            // Add to start of array for newest first display
            const updated = [newEntry, ...prev];
            try {
                 localStorage.setItem(`${LOCAL_STORAGE_HISTORY_PREFIX}${walletAddress}`, JSON.stringify(updated));
                 console.log("[History] Saved pending entry:", newEntry.requestContext);
            } catch (e: any) {
                console.error("[History] Failed to save pending entry to localStorage:", e.message);
                 addSystemMessage(`⚠️ Failed to save query to history: ${e.message}`);
                 // Revert state update on failure
                 return prev; // Return original state
            }
            return updated;
       });
  }, [walletAddress, addSystemMessage]); // Depends on walletAddress and addSystemMessage

  // Updates history when final verification result is polled
  const updateHistoryEntryWithResult = useCallback((requestContext: string, finalAiMessage: ChatMessage) => {
     if (!walletAddress || !requestContext || !finalAiMessage?.apiResponse) {
         console.error("[History] Attempted to update history with invalid data:", { requestContext, finalAiMessage });
         return;
     }
      console.log(`[History] Updating entry with final result: ${requestContext.substring(4,10)}`);

      setUserHistory(prev => {
           const entryIndex = prev.findIndex(entry => entry.requestContext === requestContext);
           if (entryIndex === -1) { console.error(`[History] Cannot find entry ${requestContext} to update.`); return prev; }

            const updatedEntry: HistoryEntry = { ...prev[entryIndex], aiMessage: finalAiMessage };
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

  }, [walletAddress, addSystemMessage]); // Depends on walletAddress and addSystemMessage

  // Connect Wallet Function
  const connectWallet = useCallback(async () => {
    console.log("[App] Attempting to connect wallet...");
    setShowHistoryList(false); setSelectedHistoryDetail(null);
    if (typeof window.ethereum !== 'undefined') {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum, 'any');
        await provider.send("eth_requestAccounts", []);
        const signer = await provider.getSigner();
        const signerAddress = await signer.getAddress();
        if (signerAddress) {
            const checksumAddress = ethers.getAddress(signerAddress);
            setWalletAddress(checksumAddress);
            addSystemMessage(`Wallet ${checksumAddress.substring(0, 6)}...${checksumAddress.substring(checksumAddress.length - 4)} connected.`);
            loadHistory(checksumAddress);
        } else { addSystemMessage("⚠️ Could not retrieve wallet address after connection."); }
      } catch (error: any) {
          console.error("Failed to connect wallet:", error);
          let errorMsg = "Failed to connect wallet.";
          if (error.code === 4001) errorMsg = "Wallet connection request rejected.";
          else if (error.message) errorMsg += ` ${error.message}`;
          addSystemMessage(`⛔ ${errorMsg}`);
          setWalletAddress(null);
       }
    } else {
        addSystemMessage("🦊 MetaMask (or other Ethereum wallet) not detected. Please install it.");
    }
  }, [loadHistory, addSystemMessage]); // Added dependencies

  // Disconnect Wallet Function
  const disconnectWallet = useCallback(() => {
      if (!walletAddress) return;
      const address = walletAddress;
      console.log(`[App] Disconnecting wallet ${address.substring(0,6)}...`);
      setWalletAddress(null); setUserHistory([]); setShowHistoryList(false);
      setSelectedHistoryDetail(null); setPendingRequests(new Map());
      setMessages(prev => [prev[0]]); // Keep only initial welcome message
      addSystemMessage(`Wallet ${address.substring(0, 6)}... disconnected.`);
  }, [walletAddress, addSystemMessage]);


  // --- Main Handler for triggering Backend Verification ---
  // This function is passed to ChatInterface's `onSendMessage` prop
  const handleSubmitForVerification = useCallback(async (question: string, knowledgeBaseCid: string) => {
    // Validation
    if (!question || !knowledgeBaseCid) { console.error("[App] Submit handler missing data!"); addSystemMessage("⛔ Error: Missing question or KB CID."); return; }
    if (!(knowledgeBaseCid.startsWith('Qm') || knowledgeBaseCid.startsWith('baf'))) { console.error(`[App] Invalid CID format: ${knowledgeBaseCid}`); addSystemMessage(`⛔ Error: Invalid KB CID format.`); return; }
    if (isSubmitting) { console.warn("[App] Ignoring duplicate submission."); return; }
    if (!walletAddress) { addSystemMessage("⚠️ Please connect wallet to submit verifiable queries."); connectWallet(); return; }

    setIsSubmitting(true);

    // Add User Message via callback
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
         console.log("[App] Backend Submission Acknowledged:", response);
         addSystemMessage(`✅ Request submitted (ID: ${response.requestContext.substring(4,10)}). Polling for results...`, response.requestContext, 'Pending Verification');
         setPendingRequests(prev => new Map(prev).set(response.requestContext, { question, kbCid: knowledgeBaseCid }));
         savePendingHistoryEntry(response.requestContext, question, knowledgeBaseCid);
     } else {
          console.error("[App] Backend acknowledgement missing requestContext:", response);
          addSystemMessage(`⛔ Backend error: Submission acknowledged but missing request ID.`);
     }
     setIsSubmitting(false); // End submitting state after acknowledgement

  }, [isSubmitting, walletAddress, addSystemMessage, savePendingHistoryEntry, addOrUpdateMessage, connectWallet]); // Added dependencies


  // --- Status Checking Logic (Polling Example) ---
  useEffect(() => {
      if (pendingRequests.size === 0 || !walletAddress) return;

      const intervalId = setInterval(async () => {
          console.log(`[Status Check] Checking ${pendingRequests.size} pending request(s)...`);
          const checkPromises = Array.from(pendingRequests.entries()).map(async ([contextId, queryInfo]) => {
             try {
                const result = await getVerificationResult(contextId, queryInfo);

                if ('isError' in result && result.isError) {
                     console.error(`[Status Check] Error fetching status for ${contextId}:`, result.error);
                } else if (result.status !== 'Processing' && result.status !== 'Pending Verification') {
                    console.log(`[Status Check] Final result received for ${contextId}: Status ${result.status}`);
                    const finalAiMessage: ChatMessage = {
                        id: Date.now() + Math.random(), sender: 'AI',
                        text: result.answer, apiResponse: result, requestContext: contextId
                    };
                    addOrUpdateMessage(finalAiMessage);
                    updateHistoryEntryWithResult(contextId, finalAiMessage);
                    setPendingRequests(prev => { const next = new Map(prev); next.delete(contextId); console.log(`[Status Check] Removed ${contextId}. Remaining: ${next.size}`); return next; });
                } else {
                    console.log(`[Status Check] Request ${contextId} still processing (Status: ${result.status})`);
                }
             } catch (e) { console.error(`[Status Check] Unhandled error checking ${contextId}:`, e); }
          });
          await Promise.allSettled(checkPromises);
      }, 15000); // Poll every 15 seconds

      return () => { console.log("[Status Check] Clearing polling interval."); clearInterval(intervalId); };
  }, [pendingRequests, walletAddress, updateHistoryEntryWithResult, addOrUpdateMessage]); // Dependencies


  // --- History Detail View Handlers ---
  const handleHistoryItemClick = useCallback((entry: HistoryEntry) => {
      console.log("History item clicked:", entry.requestContext);
      setSelectedHistoryDetail(entry); // Show detail modal
      setShowHistoryList(false); // Close list
  }, []);

  const closeHistoryDetail = useCallback(() => { setSelectedHistoryDetail(null); }, []);

  const getHistoryDisplayQuestion = useCallback((entry: HistoryEntry): string => {
      const kbCidPart = entry.knowledgeBaseCid ? ` (KB: ${entry.knowledgeBaseCid.substring(0, 6)}...)` : '';
      const isPending = (!entry.aiMessage || entry.aiMessage.apiResponse?.status === 'Processing' || entry.aiMessage.apiResponse?.status === 'Pending Verification');
      const status = entry.aiMessage?.apiResponse?.status;
      const statusIndicator = isPending ? ' (Pending)' : ` (${status || 'Unknown'})`;
      const questionPart = entry.questionText.length > 35 ? entry.questionText.substring(0, 32) + '...' : entry.questionText;
      return `${questionPart}${kbCidPart}${statusIndicator}`;
  }, []);

   const getHistoryTitle = useCallback((entry: HistoryEntry): string => {
       const isPending = (!entry.aiMessage || entry.aiMessage.apiResponse?.status === 'Processing' || entry.aiMessage.apiResponse?.status === 'Pending Verification');
       const statusHint = isPending ? '(Pending - Polling)' : `(Status: ${entry.aiMessage?.apiResponse?.status})`;
       return `View details for: ${entry.questionText} ${statusHint}`;
   }, []);


  // --- Render ---
  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto p-4 md:p-6 bg-gradient-to-br from-gray-50 to-blue-50 dark:from-gray-900 dark:to-gray-800 relative font-sans overflow-hidden">
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
            <button onClick={connectWallet} className="px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm transition-colors shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"> Connect Wallet </button>
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
        <div style={{overflow:"auto"}}className="flex-grow min-h-0 rounded-lg shadow-inner overflow-hidden bg-white dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 relative z-10">
            <ChatInterface
                messages={messages}
                onSendMessage={handleSubmitForVerification} // Pass backend submission handler
                addSystemMessage={addSystemMessage}         // Pass system message callback
                addAiMessage={addOrUpdateMessage}          // Pass user/AI message callback
            />
        </div>

        {/* Footer Section */}
        <footer className="mt-4 text-center text-xs text-gray-400 dark:text-gray-500 shrink-0 relative z-10">
             Encode Club AI Blueprints | Kintask Demo
        </footer>

        {/* History Panel (List) */}
        {walletAddress && showHistoryList && (
            <div className="absolute top-16 right-4 w-72 max-h-[60vh] overflow-y-auto bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-xl p-3 z-30 animate-fade-in"> {/* Added fade-in */}
                 <div className="flex justify-between items-center mb-2 border-b pb-1.5 dark:border-gray-600 sticky top-0 bg-white dark:bg-gray-800 px-1 -mx-1">
                     <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Query History</h3>
                     <button onClick={() => setShowHistoryList(false)} className="p-1 rounded-full text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700" title="Close History"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                 </div>
                {userHistory.length > 0 ? (
                    <ul className="space-y-1">
                        {userHistory.map((entry, index) => {
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

        {/* History Detail Modal */}
         {selectedHistoryDetail && (
             <div className="fixed inset-0 bg-black bg-opacity-50 dark:bg-opacity-70 flex justify-center items-center p-4 z-50 backdrop-blur-sm animate-fade-in" onClick={closeHistoryDetail} >
                 <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 md:p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-400 dark:scrollbar-thumb-gray-600" onClick={(e) => e.stopPropagation()} >
                     {/* Modal Header */}
                     <div className="flex justify-between items-center mb-4 border-b border-gray-200 dark:border-gray-600 pb-3">
                         <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Query Detail</h3>
                         <button onClick={closeHistoryDetail} className="p-1 rounded-full text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400" title="Close Details" aria-label="Close details modal"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
                     </div>
                     {/* Modal Body */}
                     <div className="space-y-4">
                         {/* Request Info Section */}
                         <div className="text-xs font-mono text-gray-500 dark:text-gray-400 break-all"> ID: {selectedHistoryDetail.requestContext} </div>
                         {/* Question Section */}
                         <div> <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-1">Question:</p> <p className="p-3 bg-gray-100 dark:bg-gray-700/50 rounded text-gray-800 dark:text-gray-200 whitespace-pre-wrap text-sm border dark:border-gray-600">{selectedHistoryDetail.questionText}</p> </div>
                         {/* KB CID Section */}
                         {selectedHistoryDetail.knowledgeBaseCid && ( <div> <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-1">Knowledge Base CID:</p> <p className="p-3 bg-gray-100 dark:bg-gray-700/50 rounded text-gray-800 dark:text-gray-200 text-xs break-all font-mono border dark:border-gray-600"><a href={`${IPFS_GATEWAY_URL}${selectedHistoryDetail.knowledgeBaseCid}`} target="_blank" rel="noopener noreferrer" className="hover:underline text-blue-600 dark:text-blue-400">{selectedHistoryDetail.knowledgeBaseCid}</a></p> </div> )}
                         {/* Answer Section */}
                         <div>
                             <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-1"> {selectedHistoryDetail.aiMessage ? 'Final Answer & Verification:' : 'Status:'} </p>
                             {selectedHistoryDetail.aiMessage ? ( <MessageBubble message={{ ...selectedHistoryDetail.aiMessage, isLoading: false }} /> ) : ( <div className="p-3 bg-yellow-50 dark:bg-yellow-900/30 rounded border border-yellow-300 dark:border-yellow-700 text-yellow-700 dark:text-yellow-300 text-sm italic"> Verification still in progress... </div> )}
                         </div>
                     </div>
                 </div>
             </div>
         )}

    </div>
  );
}

export default App;