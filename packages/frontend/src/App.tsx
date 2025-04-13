// kintask/packages/frontend/src/App.tsx

import React, { useState, useCallback, useEffect } from 'react';
import { ethers } from 'ethers'; // For wallet connection

// Core Components & Services
import ChatInterface from '@/components/ChatInterface'; // Assuming path alias works
import MessageBubble from '@/components/MessageBubble'; // For History Detail View & Chat
// --- FIX: Import getUserQuestions ---
import { askQuestion, getVerificationResult, getUserQuestions } from '@/services/apiService';

// Type Definitions (ensure these align with your actual types file)
import {
    ChatMessage,
    ApiVerifyResponse, // Represents the *final* result structure from backend /status
    ApiErrorResponse,  // Represents errors from apiService
    HistoryEntry,      // Structure for storing past queries/results
    VerificationStatus, // Enum/Type for status strings
    QuestionData // Type for data returned by getUserQuestions
} from '@/types'; // Adjust path if necessary

// Type for the acknowledgement response from backend POST /verify
interface VerifySubmissionResponse { message: string; requestContext: string; }


// const LOCAL_STORAGE_HISTORY_PREFIX = 'kintask_history_v1_'; // REMOVED - Using backend for history
const IPFS_GATEWAY_URL = import.meta.env.VITE_IPFS_GATEWAY_URL || 'https://w3s.link/ipfs/'; // For history modal link


// --- Helper Function ---
function createSystemMessage(
    text: string,
    requestContext?: string,
    // Allow 'System Notification' as a distinct status type
    status: VerificationStatus | 'System Notification' | 'Pending Verification' | 'Processing' = 'System Notification'
): ChatMessage {
    const apiResponsePart = (status !== 'System Notification' && status !== 'Processing')
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
  const [isSubmitting, setIsSubmitting] = useState(false); // Tracks if a *new* verification request is being submitted
  const [isHistoryLoading, setIsHistoryLoading] = useState(false); // Tracks if history is being fetched
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [userHistory, setUserHistory] = useState<HistoryEntry[]>([]); // History fetched from backend
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
               const updatedMessages = [...prev]; updatedMessages[existingIndex] = newMessage;
               // console.log(`[App State] Updated message ID: ${newMessage.id}`);
               return updatedMessages;
           } else {
               // console.log(`[App State] Added new ${newMessage.sender} message ID: ${newMessage.id}`);
               return [...prev, newMessage];
           }
      });
  }, []);


  // --- Wallet & History Logic ---

  // *** MODIFIED: Loads history from Backend using getUserQuestions ***
  const loadHistory = useCallback(async (address: string) => {
    if (!address) return;
    console.log(`[History] Fetching history from backend for ${address.substring(0,10)}...`);
    setIsHistoryLoading(true);
    setUserHistory([]); // Clear previous history
    setPendingRequests(new Map()); // Clear previous pending list

    const response = await getUserQuestions(address); // Call API service

    if ('isError' in response && response.isError) {
        console.error("[History] Failed to fetch history:", response.error, response.details);
        addSystemMessage(`⛔ Error fetching history: ${response.error}`);
        setUserHistory([]);
    } else if (Array.isArray(response)) {
        console.log(`[History] Received ${response.length} question entries from backend.`);
        const initialPending = new Map<string, { question: string; kbCid: string }>();
        // Transform fetched QuestionData into HistoryEntry format
        const fetchedHistory: HistoryEntry[] = response
            .map((qData): HistoryEntry | null => {
                // Validate basic structure received from backend
                if (!qData || !qData.requestContext || !qData.question || !qData.cid) {
                    console.warn("[History] Skipping invalid entry from backend:", qData);
                    return null;
                }

                // Determine if this request should be polled based on backend status
                // Add more pending statuses as defined by your backend/Recall states
                const isPendingStatus = ['PendingAnswer', 'PendingVerification', 'PendingEvaluation', 'PendingPayout', 'Processing'].includes(qData.status);
                if (isPendingStatus) {
                    initialPending.set(qData.requestContext, { question: qData.question, kbCid: qData.cid });
                }

                // Create HistoryEntry. aiMessage will be populated/updated by polling.
                // If status indicates completion/error, polling will fetch the final ApiVerifyResponse later.
                return {
                    requestContext: qData.requestContext,
                    questionText: qData.question,
                    knowledgeBaseCid: qData.cid,
                    submissionTimestamp: qData.timestamp, // Use timestamp from backend
                    // Initialize aiMessage as null, polling will fill it if needed
                    aiMessage: null,
                };
            })
            .filter((entry): entry is HistoryEntry => entry !== null) // Filter out invalid entries
            .sort((a, b) => { // Sort by timestamp descending (newest first)
                const timeA = new Date(a.submissionTimestamp || 0).getTime();
                const timeB = new Date(b.submissionTimestamp || 0).getTime();
                return timeB - timeA;
            });

        setUserHistory(fetchedHistory);
        setPendingRequests(initialPending); // Set pending requests derived from fetched history
        console.log(`[History] Processed ${fetchedHistory.length} history entries. Identified ${initialPending.size} pending requests to poll.`);
    } else {
         console.error("[History] Unexpected response format from getUserQuestions:", response);
         addSystemMessage("⛔ Error: Received unexpected history data from backend.");
         setUserHistory([]);
    }
    setIsHistoryLoading(false); // End loading indicator
  }, [addSystemMessage]); // Dependency

  // --- REMOVED: savePendingHistoryEntry (History now fetched from backend) ---

  // --- MODIFIED: updateHistoryEntryWithResult only updates state ---
  const updateHistoryEntryWithResult = useCallback((requestContext: string, finalAiMessage: ChatMessage) => {
     // No walletAddress check needed here
     if (!requestContext || !finalAiMessage?.apiResponse) {
         console.error("[History] Attempted to update history state with invalid data:", { requestContext, finalAiMessage });
         return;
     }
      console.log(`[History State] Updating entry with final result: ${requestContext.substring(4,10)}`);

      setUserHistory(prev => {
           const entryIndex = prev.findIndex(entry => entry.requestContext === requestContext);
           if (entryIndex === -1) {
               console.warn(`[History State] Cannot find entry ${requestContext} to update. Polling might be ahead of history fetch.`);
               // Optionally: Create a new entry if it's somehow missing?
               // const newEntry: HistoryEntry = { ... }; // Need question/CID info
               // return [...prev, newEntry];
               return prev; // For now, just don't update if not found
           }

            // Create updated entry, adding final AI message
            const updatedEntry: HistoryEntry = { ...prev[entryIndex], aiMessage: finalAiMessage };
            const updatedHistory = [...prev];
            updatedHistory[entryIndex] = updatedEntry;

            // --- REMOVED localStorage write ---

            console.log("[History State] Updated entry:", requestContext);
            return updatedHistory; // Return the updated state array
      });

  }, [/* No dependencies needed? Or addSystemMessage if errors logged */]);

  // Connect Wallet Function (Calls loadHistory)
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
            setMessages(prev => [prev[0] || createSystemMessage("Welcome!")]);
            addSystemMessage(`Wallet ${checksumAddress.substring(0, 6)}... connected.`);
            await loadHistory(checksumAddress); // Load history AFTER setting address
        } else { addSystemMessage("⚠️ Could not retrieve wallet address."); setWalletAddress(null); }
      } catch (error: any) { /* ... error handling ... */ }
    } else { addSystemMessage("🦊 Wallet not detected."); }
  }, [loadHistory, addSystemMessage]); // Keep dependencies

  // Disconnect Wallet Function
  const disconnectWallet = useCallback(() => {
      if (!walletAddress) return;
      const address = walletAddress;
      console.log(`[App] Disconnecting wallet ${address.substring(0,6)}...`);
      setWalletAddress(null); setUserHistory([]); setShowHistoryList(false);
      setSelectedHistoryDetail(null); setPendingRequests(new Map());
      setMessages(prev => [prev[0]]);
      addSystemMessage(`Wallet ${address.substring(0, 6)}... disconnected.`);
  }, [walletAddress, addSystemMessage]); // Keep dependencies


  // --- Main Handler for triggering Backend Verification ---
  const handleSubmitForVerification = useCallback(async (question: string, knowledgeBaseCid: string) => {
    // Validation
    if (!question || !knowledgeBaseCid) { /* ... */ addSystemMessage("⛔ Error: Missing Q or CID."); return; }
    if (!(knowledgeBaseCid.startsWith('Qm') || knowledgeBaseCid.startsWith('baf'))) { /* ... */ addSystemMessage(`⛔ Error: Invalid CID.`); return; }
    if (isSubmitting) { /* ... */ return; }
    if (!walletAddress) { addSystemMessage("⚠️ Please connect wallet first."); connectWallet(); return; }

    setIsSubmitting(true);

    // Add User Message
    const userTimestamp = Date.now();
    const userMessageText = `${question}\n(Verifying with KB CID: ${knowledgeBaseCid.substring(0, 10)}...)`;
    addOrUpdateMessage({ id: userTimestamp, sender: 'User', text: userMessageText, apiResponse: null });

    // Add placeholder system message
    const loadingId = userTimestamp + 1;
    addOrUpdateMessage(createSystemMessage("⏳ Submitting request...", undefined, 'Processing'));

    // Call apiService.askQuestion
    const response = await askQuestion(question, knowledgeBaseCid, walletAddress);

    // Remove "Submitting..." message
    setMessages(prev => prev.filter(msg => msg.id !== loadingId));

    // Handle acknowledgement response
     if ('isError' in response && response.isError) {
         console.error("[App] Backend Submission Failed:", response.error, response.details);
         addSystemMessage(`⛔ Backend submission failed: ${response.error || 'Unknown error'}`);
         addOrUpdateMessage({ id: loadingId + 1, sender: 'System', text: `Submission Error: ${response.error || 'Unknown'}`, apiResponse: { status: 'Error: Verification Failed' } as any });
     } else if (response.requestContext) {
         console.log("[App] Backend Submission Acknowledged:", response);
         addSystemMessage(`✅ Request submitted (ID: ${response.requestContext.substring(4,10)}). Polling for results...`, response.requestContext, 'Pending Verification');
         setPendingRequests(prev => new Map(prev).set(response.requestContext, { question, kbCid: knowledgeBaseCid }));
         // *** No need to save pending history here, loadHistory will pick it up ***
         // savePendingHistoryEntry(response.requestContext, question, knowledgeBaseCid);
     } else {
          console.error("[App] Backend acknowledgement missing requestContext:", response);
          addSystemMessage(`⛔ Backend error: Submission acknowledged but missing request ID.`);
          addOrUpdateMessage({ id: loadingId + 1, sender: 'System', text: `Error: Missing Request ID`, apiResponse: { status: 'Error: Verification Failed' } as any });
     }
     setIsSubmitting(false);

  }, [isSubmitting, walletAddress, addSystemMessage, /* savePendingHistoryEntry removed */, addOrUpdateMessage, connectWallet]); // Removed savePendingHistoryEntry


  // --- Status Checking Logic ---
  useEffect(() => {
      if (pendingRequests.size === 0 || !walletAddress) return;

      const intervalId = setInterval(async () => {
          console.log(`[Status Check] Checking ${pendingRequests.size} pending request(s)...`);
          const checkPromises = Array.from(pendingRequests.entries()).map(async ([contextId, queryInfo]) => {
             try {
                const result = await getVerificationResult(contextId, queryInfo);

                if (!('isError' in result) && result.status !== 'Processing' && result.status !== 'Pending Verification') {
                    // Final status received
                    console.log(`[Status Check] Final result for ${contextId}: Status ${result.status}`);
                    const finalAiMessage: ChatMessage = {
                        id: Date.now() + Math.random(), sender: 'AI',
                        text: result.answer, apiResponse: result, requestContext: contextId
                    };
                    // Update main chat message list
                    setMessages(prev => [ ...prev.filter(m => m.requestContext !== contextId || m.sender === 'User'), finalAiMessage ]);
                    // Update history state
                    updateHistoryEntryWithResult(contextId, finalAiMessage); // Updates userHistory state
                    // Remove from pending map
                    setPendingRequests(prev => { const next = new Map(prev); next.delete(contextId); return next; });
                } else if ('isError' in result) {
                     console.error(`[Status Check] Error polling ${contextId}:`, result.error);
                     // Keep polling for now, maybe add counter?
                } else {
                     console.log(`[Status Check] Request ${contextId} still processing (${result.status})`);
                     // Update system message in main chat? Optional.
                     setMessages(prev => prev.map(msg => (msg.requestContext === contextId && msg.sender === 'System') ? { ...msg, text: `Verifying... (Status: ${result.status}) ID: ${contextId.substring(4,10)}` } : msg ));
                }
             } catch (e) { console.error(`[Status Check] Unhandled error checking ${contextId}:`, e); }
          });
          await Promise.allSettled(checkPromises);
      }, 15000);

      return () => { console.log("[Status Check] Clearing polling interval."); clearInterval(intervalId); };
  }, [pendingRequests, walletAddress, updateHistoryEntryWithResult, addOrUpdateMessage, setMessages]);


  // --- History Detail View Handlers ---
  const handleHistoryItemClick = useCallback((entry: HistoryEntry) => { /* ... */ }, [addSystemMessage]);
  const closeHistoryDetail = useCallback(() => { /* ... */ }, []);
  const getHistoryDisplayQuestion = useCallback(/* ... */);
  const getHistoryTitle = useCallback(/* ... */);


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
              <button onClick={() => { setShowHistoryList(prev => !prev); setSelectedHistoryDetail(null); }} disabled={isHistoryLoading || userHistory.length === 0} className={`px-3 py-1.5 rounded-md text-sm transition-colors shadow ${ userHistory.length > 0 ? 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-1' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed opacity-70' } ${isHistoryLoading ? 'opacity-50 cursor-wait' : ''}`} title={showHistoryList ? "Hide History" : (userHistory.length > 0 ? "Show History" : "No History Yet")}>
                 {isHistoryLoading ? <div className="h-4 w-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin inline-block mr-1"></div> : <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                 ({isHistoryLoading ? '...' : userHistory.length})
              </button>
              <button onClick={disconnectWallet} title="Disconnect Wallet" className="px-3 py-1.5 bg-red-500 text-white rounded-md hover:bg-red-600 text-sm transition-colors shadow focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
              </button>
            </>
          )}
        </div>

        {/* Main Chat Area */}
        <div className="flex-grow min-h-0 rounded-lg shadow-inner overflow-hidden bg-white dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 relative z-10">
            <ChatInterface
                messages={messages}
                onSendMessage={handleSubmitForVerification}
                addSystemMessage={addSystemMessage}
                addAiMessage={addOrUpdateMessage}
            />
        </div>

        {/* Footer Section */}
        <footer className="mt-4 text-center text-xs text-gray-400 dark:text-gray-500 shrink-0 relative z-10">
             Encode Club AI Blueprints | Kintask Demo
        </footer>

        {/* History Panel (List) */}
        {walletAddress && showHistoryList && (
            <div className="absolute top-16 right-4 w-72 max-h-[60vh] overflow-y-auto bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-xl p-3 z-30 animate-fade-in">
                 <div className="flex justify-between items-center mb-2 border-b pb-1.5 dark:border-gray-600 sticky top-0 bg-white dark:bg-gray-800 px-1 -mx-1"> <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Query History</h3> <button onClick={() => setShowHistoryList(false)} className="p-1 rounded-full text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700" title="Close History"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button> </div>
                 {isHistoryLoading ? ( <p className="text-xs text-center text-gray-500 dark:text-gray-400 italic py-4">Loading history...</p> )
                  : userHistory.length > 0 ? ( <ul className="space-y-1"> {userHistory.map((entry, index) => { const displayQuestion = getHistoryDisplayQuestion(entry); const titleText = getHistoryTitle(entry); const key = `${entry.requestContext}-${index}`; return ( <li key={key}> <button onClick={() => handleHistoryItemClick(entry)} className={`w-full text-left text-xs px-2 py-1.5 rounded truncate transition-colors ${!entry.aiMessage || entry.aiMessage.apiResponse?.status === 'Processing' || entry.aiMessage.apiResponse?.status === 'Pending Verification' ? 'text-gray-500 dark:text-gray-400 italic hover:bg-gray-100 dark:hover:bg-gray-700' : 'text-gray-700 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-blue-900/30'}`} title={titleText}> {displayQuestion} </button> </li> ); })} </ul> )
                  : ( <p className="text-xs text-center text-gray-500 dark:text-gray-400 italic py-2">No saved history for this wallet.</p> )}
            </div>
        )}

        {/* History Detail Modal */}
         {selectedHistoryDetail && (
             <div className="fixed inset-0 bg-black bg-opacity-50 dark:bg-opacity-70 flex justify-center items-center p-4 z-50 backdrop-blur-sm animate-fade-in" onClick={closeHistoryDetail} >
                 <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 md:p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-400 dark:scrollbar-thumb-gray-600" onClick={(e) => e.stopPropagation()} >
                     {/* Modal Header */}
                     <div className="flex justify-between items-center mb-4 border-b border-gray-200 dark:border-gray-600 pb-3"> <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Query Detail</h3> <button onClick={closeHistoryDetail} className="p-1 rounded-full text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400" title="Close Details"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button> </div>
                     {/* Modal Body */}
                     <div className="space-y-4">
                         {/* Request Info */}
                         <div className="text-xs font-mono text-gray-500 dark:text-gray-400 break-all"> ID: {selectedHistoryDetail.requestContext} </div>
                         {/* Question */}
                         <div> <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-1">Question:</p> <p className="p-3 bg-gray-100 dark:bg-gray-700/50 rounded text-gray-800 dark:text-gray-200 whitespace-pre-wrap text-sm border dark:border-gray-600">{selectedHistoryDetail.questionText}</p> </div>
                         {/* KB CID */}
                         {selectedHistoryDetail.knowledgeBaseCid && ( <div> <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-1">Knowledge Base CID:</p> <p className="p-3 bg-gray-100 dark:bg-gray-700/50 rounded text-gray-800 dark:text-gray-200 text-xs break-all font-mono border dark:border-gray-600"><a href={`${IPFS_GATEWAY_URL}${selectedHistoryDetail.knowledgeBaseCid}`} target="_blank" rel="noopener noreferrer" className="hover:underline text-blue-600 dark:text-blue-400">{selectedHistoryDetail.knowledgeBaseCid}</a></p> </div> )}
                         {/* Submission Time */}
                         {selectedHistoryDetail.submissionTimestamp && ( <div> <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">Submitted:</p> <p className="text-gray-700 dark:text-gray-300 text-xs">{new Date(selectedHistoryDetail.submissionTimestamp).toLocaleString()}</p> </div> )}
                         {/* Answer/Status */}
                         <div>
                             <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-1"> {selectedHistoryDetail.aiMessage ? 'Final Answer & Verification:' : 'Status:'} </p>
                             {selectedHistoryDetail.aiMessage ? ( <MessageBubble message={{ ...selectedHistoryDetail.aiMessage, isLoading: false }} /> ) : ( <div className="p-3 bg-yellow-50 dark:bg-yellow-900/30 rounded border border-yellow-300 dark:border-yellow-700 text-yellow-700 dark:text-yellow-300 text-sm italic"> Verification in progress (polling backend)... </div> )}
                         </div>
                     </div>
                 </div>
             </div>
         )}

    </div>
  );
}

export default App;