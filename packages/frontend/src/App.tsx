import React, { useState, useCallback, useEffect } from 'react';
import { ethers } from 'ethers';

// Core Components & Services
import ChatInterface from '@/components/ChatInterface';
import MessageBubble from '@/components/MessageBubble'; // For History Detail View
import { submitAskRequest /*, getVerificationResult - TODO */ } from '@/services/apiService';

// Type Definitions
import {
    ChatMessage,
    ApiVerifyResponse, // Represents the *final* result structure
    AskApiResponse,    // Represents the *initial* submission response
    ApiErrorResponse,  // Represents errors from the apiService
    HistoryEntry,
    VerificationStatus
} from '@/types';

const LOCAL_STORAGE_HISTORY_PREFIX = 'kintask_history_';

// --- Helper Function ---
function createSystemMessage(text: string, requestContext?: string, status: VerificationStatus = 'System Notification'): ChatMessage {
    return {
        id: Date.now() + Math.random(), // Add random to avoid collision on rapid messages
        sender: 'System',
        text: text,
        apiResponse: null, // System messages don't have a full ApiVerifyResponse initially
        requestContext: requestContext,
        // Could potentially set apiResponse.status here if needed
    };
}


// --- App Component ---

function App() {
  // --- State ---
  const [messages, setMessages] = useState<ChatMessage[]>(() => [createSystemMessage("Welcome to Kintask! Submit a question and Knowledge Base CID to start verification.")]);
  const [isSubmitting, setIsSubmitting] = useState(false); // Tracks if /ask request is in flight
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [userHistory, setUserHistory] = useState<HistoryEntry[]>([]); // Holds *completed* entries
  const [showHistoryList, setShowHistoryList] = useState<boolean>(false);
  const [selectedHistoryDetail, setSelectedHistoryDetail] = useState<HistoryEntry | null>(null);
  const [pendingRequests, setPendingRequests] = useState<Set<string>>(new Set()); // Track requests awaiting results


  // --- Wallet & History Logic ---

  const loadHistory = useCallback((address: string) => {
    const storedHistory = localStorage.getItem(`${LOCAL_STORAGE_HISTORY_PREFIX}${address}`);
    if (storedHistory) {
      try {
        const parsedHistory: HistoryEntry[] = JSON.parse(storedHistory);
        if (Array.isArray(parsedHistory)) {
          // Filter for valid entries that have the final aiMessage populated
          const validHistory = parsedHistory.filter(
            entry => entry && entry.questionText && entry.requestContext && entry.aiMessage?.apiResponse
          );
          setUserHistory(validHistory);
           console.log(`[History] Loaded ${validHistory.length} completed entries.`);
        } else {
          setUserHistory([]);
        }
      } catch (error) {
        console.error("[History] Error parsing history from localStorage:", error);
        setUserHistory([]);
      }
    } else {
      setUserHistory([]);
    }
  }, []);

  // TODO: Implement function to save a completed entry to history and localStorage
  // This should be called *after* getVerificationResult succeeds.
  const saveCompletedHistoryEntry = useCallback((entry: HistoryEntry) => {
       if (!walletAddress) return;
       console.log("[History] Attempting to save completed entry:", entry.requestContext);
       setUserHistory(prev => {
            // Avoid duplicates based on requestContext
            if (prev.some(h => h.requestContext === entry.requestContext)) {
                return prev;
            }
            const updated = [...prev, entry];
            try {
                 localStorage.setItem(`${LOCAL_STORAGE_HISTORY_PREFIX}${walletAddress}`, JSON.stringify(updated));
                 console.log("[History] Saved entry:", entry.requestContext);
            } catch (e) { console.error("[History] Failed to save to localStorage", e); }

            return updated;
       });
  }, [walletAddress]);


  const connectWallet = useCallback(async () => {
    setShowHistoryList(false); setSelectedHistoryDetail(null);
    if (typeof window.ethereum !== 'undefined') {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const accounts = await provider.send("eth_requestAccounts", []);
        const signerAddress = accounts[0];
        if (signerAddress) {
            setWalletAddress(signerAddress);
            loadHistory(signerAddress); // Load history for the connected wallet
            setMessages([
                createSystemMessage("Welcome back! Submit a question and Knowledge Base CID."),
                createSystemMessage(`Wallet ${signerAddress.substring(0, 6)}...${signerAddress.substring(signerAddress.length - 4)} connected.`)
            ]);
        }
      } catch (error) {
        console.error("Failed to connect wallet:", error);
        setMessages(prev => [...prev, createSystemMessage("Failed to connect wallet. Please try again.")]);
      }
    } else {
       setMessages(prev => [...prev, createSystemMessage("MetaMask (or other Ethereum wallet) not detected. Install it to save history.")]);
    }
  }, [loadHistory]); // Include loadHistory in dependencies

  const disconnectWallet = useCallback(() => {
      const address = walletAddress;
      setWalletAddress(null);
      setUserHistory([]); // Clear history state
      setShowHistoryList(false);
      setSelectedHistoryDetail(null);
      setPendingRequests(new Set()); // Clear pending requests on disconnect
      setMessages(prev => [...prev, createSystemMessage(`Wallet ${address ? `${address.substring(0, 6)}...` : ''} disconnected. History saving disabled.`)]);
  }, [walletAddress]);

  // --- Main Submission Logic ---

  const handleAskSubmit = useCallback(async (question: string, knowledgeBaseCidInput?: string) => {
    const trimmedQuestion = question.trim();
    // The script requires the CID, so we enforce it here too for consistency
    const trimmedKnowledgeBaseCid = knowledgeBaseCidInput?.trim();

    // --- Input Validation ---
    if (!trimmedQuestion) {
      setMessages(prev => [...prev, createSystemMessage("Error: Question cannot be empty.")]);
      return;
    }
    if (!trimmedKnowledgeBaseCid || !(trimmedKnowledgeBaseCid.startsWith('Qm') || trimmedKnowledgeBaseCid.startsWith('bafy') || trimmedKnowledgeBaseCid.startsWith('bafk'))) {
      setMessages(prev => [...prev, createSystemMessage("Error: Please provide a valid Knowledge Base CID (starting with Qm, bafy, or bafk).")]);
      return;
    }
    if (isSubmitting) {
        console.warn("[Submit] Submission already in progress.");
        return;
    }

    // --- UI Updates ---
    setSelectedHistoryDetail(null); // Close history detail if open
    setIsSubmitting(true);

    // Add User message bubble
    const userTimestamp = Date.now();
    const userMessageText = `${trimmedQuestion}\n(Using KB CID: ${trimmedKnowledgeBaseCid.substring(0, 10)}...)`;
    setMessages(prev => [...prev, {
      id: userTimestamp,
      sender: 'User',
      text: userMessageText,
      apiResponse: null, // User message doesn't have an API response object
    }]);

    // Add "Submitting..." system message
    const submittingMessage = createSystemMessage("Submitting request...");
    setMessages(prev => [...prev, submittingMessage]);

    // --- API Call ---
    const response = await submitAskRequest(trimmedQuestion, trimmedKnowledgeBaseCid);

    // --- Handle API Response ---
    // Remove "Submitting..." message before adding result message
     setMessages(prev => prev.filter(msg => msg.id !== submittingMessage.id));

    if ('isError' in response && response.isError) {
      // Submission Failed
      console.error("[App] Submission Failed:", response.error, response.details);
      setMessages(prev => [...prev, createSystemMessage(
        `--- Submission Failed! ---\nError: ${response.error}${response.details ? `\nDetails: ${response.details}` : ''}`
      )]);
    } else {
      // Submission Successful
      console.log("[App] Submission Successful:", response);
      setMessages(prev => [...prev, createSystemMessage(
        `--- Submission Successful! ---\nMessage: ${response.message}\nRequest ID: ${response.requestContext}\nRecall Key: ${response.recallKey}\n\n(Checking status periodically - TBD)`,
        response.requestContext, // Associate context ID with this message
        'Pending Verification' // Set initial status hint
      )]);
      // Track the pending request
      setPendingRequests(prev => new Set(prev).add(response.requestContext));

      // TODO: Initiate polling/WebSocket listener for this requestContext
      // initiateStatusCheck(response.requestContext);
    }

    setIsSubmitting(false); // Submission attempt finished

  }, [isSubmitting]); // Dependency: isSubmitting to prevent double clicks


  // --- TODO: Status Checking Logic ---
  /*
  useEffect(() => {
      if (pendingRequests.size === 0) return;

      const intervalId = setInterval(async () => {
          console.log("[Status Check] Checking pending requests:", pendingRequests);
          const promises = Array.from(pendingRequests).map(async (contextId) => {
              const result = await getVerificationResult(contextId); // Call the (TODO) status check function
              if ('isError' in result && result.isError) {
                   console.error(`[Status Check] Error fetching status for ${contextId}:`, result.error);
                   // Option: Add a system error message? Remove from pending? Retry later?
                   // setMessages(prev => [...prev, createSystemMessage(`Error checking status for ${contextId}: ${result.error}`)]);
                   // setPendingRequests(prev => { const next = new Set(prev); next.delete(contextId); return next; });
              } else if (result.status !== 'Processing' && result.status !== 'Pending Verification') {
                  // Final status received!
                  console.log(`[Status Check] Final result for ${contextId}:`, result);

                  // 1. Create the final AI ChatMessage
                  const finalAiMessage: ChatMessage = {
                      id: Date.now() + Math.random(),
                      sender: 'AI',
                      text: result.answer, // Use the answer from the result
                      apiResponse: result, // Store the full final response
                      requestContext: contextId,
                  };
                  // 2. Add the AI message to the chat
                   setMessages(prev => [...prev, finalAiMessage]);

                   // 3. Find original question info (if needed for history) - could be stored with pending request ID
                   // This part is tricky - need to associate the original question/kbCid with contextId
                   const originalQueryInfo = // ... logic to find original question/kbCid ...

                   // 4. If wallet connected, save to history
                   if (walletAddress && originalQueryInfo) {
                       saveCompletedHistoryEntry({
                           questionText: originalQueryInfo.question,
                           knowledgeBaseCid: originalQueryInfo.kbCid,
                           requestContext: contextId,
                           aiMessage: finalAiMessage // Save the final message object
                       });
                   }

                  // 5. Remove from pending requests
                  setPendingRequests(prev => { const next = new Set(prev); next.delete(contextId); return next; });
              } else {
                   console.log(`[Status Check] Request ${contextId} still processing (Status: ${result.status})`);
                   // Update system message status? (Optional)
                    setMessages(prev => prev.map(msg =>
                       (msg.requestContext === contextId && msg.sender === 'System')
                       ? { ...msg, text: msg.text.replace(/\(Status: .*\)/, `(Status: ${result.status})`) } // Basic status update in text
                       : msg
                   ));
              }
          });
          await Promise.allSettled(promises);
      }, 10000); // Poll every 10 seconds (adjust interval)

      return () => clearInterval(intervalId); // Cleanup on component unmount or when pendingRequests changes

  }, [pendingRequests, walletAddress, saveCompletedHistoryEntry]); // Dependencies for the polling effect
  */


  // --- History Detail View Handlers ---
  const handleHistoryItemClick = (entry: HistoryEntry) => {
      // History entries only contain completed items now due to loadHistory filter
      setSelectedHistoryDetail(entry);
      setShowHistoryList(false);
  }
  const closeHistoryDetail = () => { setSelectedHistoryDetail(null); }

  const getHistoryDisplayQuestion = (entry: HistoryEntry): string => {
      const kbCidPart = entry.knowledgeBaseCid ? ` (KB: ${entry.knowledgeBaseCid.substring(0, 6)}...)` : '';
      // Include request context in display? Maybe too verbose.
      return `${entry.questionText}${kbCidPart}`;
  }
   const getHistoryTitle = (entry: HistoryEntry): string => {
       const kbCidPart = entry.knowledgeBaseCid ? ` with KB CID ${entry.knowledgeBaseCid}` : '';
       // Safely access status from the stored aiMessage.apiResponse
       const statusHint = entry.aiMessage?.apiResponse ? `(Status: ${entry.aiMessage.apiResponse.status})` : '(Status Unavailable)';
       return `View details for: ${entry.questionText}${kbCidPart} ${statusHint}`;
   }


  // --- Render ---
  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto p-4 md:p-6 bg-gray-100 dark:bg-gray-900 relative font-sans">
        {/* Header Section */}
        <header className="mb-4 text-center shrink-0 pt-16">
              <img src="https://cdn.discordapp.com/attachments/1356707592478392634/1357070814238867628/ComfyUI_01572_.png?ex=67eede2f&is=67ed8caf&hm=3c955398d4b755edb02ea082206156f147c2cd6a1481d9d8b9fa5042db54c5eb&format=webp&quality=lossless&width=556&height=715" alt="Kintask Logo" className="h-16 md:h-20 w-auto mx-auto mb-2 rounded-lg shadow-md" />
              <h1 className="text-3xl md:text-4xl font-bold text-kintask-blue dark:text-kintask-blue-light tracking-tight"> {import.meta.env.VITE_APP_TITLE || 'Kintask'} </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1"> Verifiable AI Q&A with Decentralized Trust </p>
              {walletAddress && ( <p className="text-xs text-green-600 dark:text-green-400 mt-1" title={walletAddress}> Wallet: {walletAddress.substring(0, 6)}...{walletAddress.substring(walletAddress.length - 4)} connected </p> )}
        </header>

        {/* Wallet Connect / History Toggle Buttons */}
        <div className="absolute top-4 right-4 flex space-x-2 z-20">
          {!walletAddress ? (
            <button onClick={connectWallet} className="px-3 py-1 bg-kintask-blue text-white rounded hover:bg-kintask-blue-dark text-sm transition-colors shadow">
              Connect Wallet
            </button>
          ) : (
            <>
              <button
                onClick={() => { setShowHistoryList(!showHistoryList); setSelectedHistoryDetail(null); }}
                disabled={userHistory.length === 0}
                className={`px-3 py-1 rounded text-sm transition-colors shadow ${ userHistory.length > 0 ? 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed' }`}
                title={showHistoryList ? "Hide History List" : "Show History List"}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                ({userHistory.length})
              </button>
              <button
                onClick={disconnectWallet}
                title="Disconnect Wallet"
                className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm transition-colors shadow"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </>
          )}
        </div>


        {/* Chat Area */}
        <div className="flex-grow min-h-0 bg-white dark:bg-gray-800 rounded-lg shadow-inner overflow-hidden">
             <ChatInterface
                messages={messages}
                onSendMessage={handleAskSubmit} // Pass the correct handler
                isLoading={isSubmitting}        // Pass the submission state
            />
        </div>

        {/* Footer Section */}
        <footer className="mt-4 text-center text-xs text-gray-400 dark:text-gray-500 shrink-0">
            Encode Club AI Blueprints Hackathon | Filecoin, Recall, Blocklock Demo
        </footer>

        {/* History Panel (List) */}
        {walletAddress && showHistoryList && (
            <div className="absolute top-14 right-4 w-64 max-h-[60vh] overflow-y-auto bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-xl p-3 z-20">
                <h3 className="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-200 border-b pb-1 dark:border-gray-600 sticky top-0 bg-white dark:bg-gray-800">Completed Queries</h3>
                {userHistory.length > 0 ? (
                    <ul className="space-y-1 pt-1">
                        {userHistory.slice().reverse().map((entry, index) => {
                            const displayQuestion = getHistoryDisplayQuestion(entry);
                            const titleText = getHistoryTitle(entry);
                            const key = `${entry.requestContext}-${index}`; // Use context ID for key
                            return ( <li key={key}> <button onClick={() => handleHistoryItemClick(entry)} className="w-full text-left text-xs p-1 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 truncate" title={titleText} > {displayQuestion} </button> </li> );
                        })}
                    </ul>
                ) : ( <p className="text-xs text-gray-500 dark:text-gray-400 italic pt-1">No completed queries found in history.</p> )}
            </div>
        )}

        {/* History Detail View (Modal) */}
         {walletAddress && selectedHistoryDetail && selectedHistoryDetail.aiMessage?.apiResponse && (
             <div className="fixed inset-0 bg-black bg-opacity-60 dark:bg-opacity-75 flex justify-center items-center p-4 z-30 backdrop-blur-sm" onClick={closeHistoryDetail} >
                 <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-4 md:p-6 max-w-xl w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} >
                     <div className="flex justify-between items-center mb-3 border-b pb-2 dark:border-gray-600">
                         <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Query History Detail</h3>
                         <button onClick={closeHistoryDetail} className="p-1 rounded-full text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600" title="Close Details">
                             <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                         </button>
                     </div>
                     <div className="space-y-3">
                         <div>
                             <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">Question:</p>
                             <p className="p-2 bg-gray-100 dark:bg-gray-700 rounded text-gray-800 dark:text-gray-200 whitespace-pre-wrap text-sm">{selectedHistoryDetail.questionText}</p>
                         </div>
                         {selectedHistoryDetail.knowledgeBaseCid && (
                             <div>
                                 <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">Knowledge Base CID:</p>
                                 <p className="p-2 bg-gray-100 dark:bg-gray-700 rounded text-gray-800 dark:text-gray-200 text-xs break-all">{selectedHistoryDetail.knowledgeBaseCid}</p>
                             </div>
                         )}
                         <div>
                              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">Answer:</p>
                              {/* Render the final answer using MessageBubble */}
                              <MessageBubble message={{ ...selectedHistoryDetail.aiMessage, isLoading: false }} />
                         </div>
                     </div>
                 </div>
             </div>
         )}

    </div>
  );
}

export default App;

// /src/App.tsx