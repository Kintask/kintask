import React, { useState, useCallback, useEffect } from 'react';
import { ethers } from 'ethers';

// Core Components & Services
import ChatInterface from '@/components/ChatInterface';
import MessageBubble from '@/components/MessageBubble'; // For History Detail View
import { askQuestion, getVerificationResult } from '@/services/apiService'; // Include getVerificationResult for TODO

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
        id: Date.now() + Math.random(),
        sender: 'System',
        text: text,
        apiResponse: null,
        requestContext: requestContext,
    };
}

// --- App Component ---
function App() {
  // --- State ---
  const [messages, setMessages] = useState<ChatMessage[]>(() => [createSystemMessage("Welcome! Submit a question and Knowledge Base CID.")]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  // userHistory now holds ALL entries, pending or complete
  const [userHistory, setUserHistory] = useState<HistoryEntry[]>([]);
  const [showHistoryList, setShowHistoryList] = useState<boolean>(false);
  const [selectedHistoryDetail, setSelectedHistoryDetail] = useState<HistoryEntry | null>(null);
  // pendingRequests might still be useful for triggering polling
  const [pendingRequests, setPendingRequests] = useState<Map<string, { question: string; kbCid?: string }>>(new Map());


  // --- Wallet & History Logic ---

  const loadHistory = useCallback((address: string) => {
    const storedHistory = localStorage.getItem(`${LOCAL_STORAGE_HISTORY_PREFIX}${address}`);
    if (storedHistory) {
      try {
        const parsedHistory: HistoryEntry[] = JSON.parse(storedHistory);
        if (Array.isArray(parsedHistory)) {
          // Load all entries that have the minimum required fields
          const validHistory = parsedHistory.filter(
            entry => entry && entry.questionText && entry.requestContext
          );
          setUserHistory(validHistory);
          console.log(`[History] Loaded ${validHistory.length} entries (pending & complete).`);

          // Populate pending requests map from loaded history for polling resume (if needed)
          const initialPending = new Map<string, { question: string; kbCid?: string }>();
          validHistory.forEach(entry => {
              if (!entry.aiMessage) { // If aiMessage is missing, it's pending
                 initialPending.set(entry.requestContext, { question: entry.questionText, kbCid: entry.knowledgeBaseCid });
              }
          });
           setPendingRequests(initialPending);
           console.log(`[History] Identified ${initialPending.size} pending requests from loaded history.`);

        } else {
          setUserHistory([]);
           setPendingRequests(new Map());
        }
      } catch (error) {
        console.error("[History] Error parsing history:", error);
        setUserHistory([]);
         setPendingRequests(new Map());
      }
    } else {
      setUserHistory([]);
       setPendingRequests(new Map());
    }
  }, []);

  // Function to save a PENDING history entry (called right after successful /ask)
  const savePendingHistoryEntry = useCallback((requestContext: string, question: string, kbCid?: string) => {
       if (!walletAddress) return;
       console.log("[History] Saving PENDING entry:", requestContext);

        const newEntry: HistoryEntry = {
            questionText: question,
            knowledgeBaseCid: kbCid,
            requestContext: requestContext,
            // aiMessage is intentionally undefined here
        };

       setUserHistory(prev => {
            // Avoid duplicates based on requestContext
            if (prev.some(h => h.requestContext === newEntry.requestContext)) {
                console.warn(`[History] Attempted to save duplicate pending entry for ${requestContext}`);
                return prev; // Don't add if already exists
            }
            const updated = [...prev, newEntry];
            try {
                 localStorage.setItem(`${LOCAL_STORAGE_HISTORY_PREFIX}${walletAddress}`, JSON.stringify(updated));
                 console.log("[History] Saved pending entry:", newEntry.requestContext);
            } catch (e) {
                console.error("[History] Failed to save pending entry to localStorage", e);
                // Optionally revert state update on save failure, though unlikely for small entries
                return prev.filter(entry => entry.requestContext !== newEntry.requestContext);
            }
            return updated;
       });
  }, [walletAddress]);


  // Function to UPDATE a history entry with the final result (called after getVerificationResult succeeds)
  const updateHistoryEntryWithResult = useCallback((requestContext: string, finalAiMessage: ChatMessage) => {
     if (!walletAddress) return;
      console.log("[History] Updating entry with final result:", requestContext);

      setUserHistory(prev => {
           const entryIndex = prev.findIndex(entry => entry.requestContext === requestContext);
           if (entryIndex === -1) {
               console.error(`[History] Cannot find entry with context ${requestContext} to update.`);
               return prev; // Entry not found
           }

            const updatedEntry: HistoryEntry = {
                ...prev[entryIndex],
                aiMessage: finalAiMessage // Add the final message data
            };

            const updatedHistory = [...prev];
            updatedHistory[entryIndex] = updatedEntry; // Replace the old entry

            try {
                 localStorage.setItem(`${LOCAL_STORAGE_HISTORY_PREFIX}${walletAddress}`, JSON.stringify(updatedHistory));
                 console.log("[History] Updated entry with result:", requestContext);
            } catch (e) {
                console.error("[History] Failed to save updated entry to localStorage", e);
                 // Revert state if saving fails? Depends on desired robustness.
                 // return prev;
            }
            return updatedHistory; // Return the updated state array
      });

  }, [walletAddress]);


  const connectWallet = useCallback(async () => {
    // ... (connect wallet logic remains the same) ...
    setShowHistoryList(false); setSelectedHistoryDetail(null);
    if (typeof window.ethereum !== 'undefined') {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const accounts = await provider.send("eth_requestAccounts", []);
        const signerAddress = accounts[0];
        if (signerAddress) {
            setWalletAddress(signerAddress);
            loadHistory(signerAddress); // Load potentially pending history
            setMessages([
                createSystemMessage("Welcome back! Submit a question and Knowledge Base CID."),
                createSystemMessage(`Wallet ${signerAddress.substring(0, 6)}...${signerAddress.substring(signerAddress.length - 4)} connected.`)
            ]);
        }
      } catch (error) { console.error("Failed to connect wallet:", error); setMessages(prev => [...prev, createSystemMessage("Failed to connect wallet.")]); }
    } else { setMessages(prev => [...prev, createSystemMessage("MetaMask not detected.")]); }
  }, [loadHistory]);

  const disconnectWallet = useCallback(() => {
    // ... (disconnect wallet logic remains the same) ...
      const address = walletAddress;
      setWalletAddress(null); setUserHistory([]); setShowHistoryList(false); setSelectedHistoryDetail(null); setPendingRequests(new Map());
      setMessages(prev => [...prev, createSystemMessage(`Wallet ${address ? `${address.substring(0, 6)}...` : ''} disconnected.`)]);
  }, [walletAddress]);


  // --- Main Submission Logic ---

  const handleAskSubmit = useCallback(async (question: string, knowledgeBaseCidInput?: string) => {
    const trimmedQuestion = question.trim();
    const trimmedKnowledgeBaseCid = knowledgeBaseCidInput?.trim();

    // --- Input Validation ---
    if (!trimmedQuestion) { /* ... */ return; }
    if (!trimmedKnowledgeBaseCid || !(trimmedKnowledgeBaseCid.startsWith('Qm') || trimmedKnowledgeBaseCid.startsWith('bafy') || trimmedKnowledgeBaseCid.startsWith('bafk'))) { /* ... */ return; }
    if (isSubmitting) { /* ... */ return; }

    // --- UI Updates ---
    setSelectedHistoryDetail(null); setIsSubmitting(true);

    // Add User message
    const userTimestamp = Date.now();
    const userMessageText = `${trimmedQuestion}\n(Using KB CID: ${trimmedKnowledgeBaseCid.substring(0, 10)}...)`;
    setMessages(prev => [...prev, { id: userTimestamp, sender: 'User', text: userMessageText, apiResponse: null }]);

    // Add "Submitting..." message
    const submittingMessage = createSystemMessage("Submitting request...");
    setMessages(prev => [...prev, submittingMessage]);

    // --- API Call ---
    const response = await askQuestion(trimmedQuestion, trimmedKnowledgeBaseCid);

    // --- Handle API Response ---
    setMessages(prev => prev.filter(msg => msg.id !== submittingMessage.id)); // Remove "Submitting..."

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
        `--- Submission Successful! ---\nMessage: ${response.message}\nRequest ID: ${response.requestContext}\nRecall Key: ${response.recallKey}\n\n(Fetching result...)`, // Updated message
        response.requestContext,
        'Pending Verification'
      )]);

      // --- SAVE PENDING HISTORY & Track for Polling ---
      if (walletAddress) {
          savePendingHistoryEntry(response.requestContext, trimmedQuestion, trimmedKnowledgeBaseCid);
      }
      // Add to pending map for polling logic
       setPendingRequests(prev => new Map(prev).set(response.requestContext, { question: trimmedQuestion, kbCid: trimmedKnowledgeBaseCid }));
      // TODO: Make sure polling logic uses this map

    }

    setIsSubmitting(false);

  }, [isSubmitting, walletAddress, savePendingHistoryEntry]); // Added savePendingHistoryEntry dependency


  // --- Status Checking Logic (Polling Example) ---

  useEffect(() => {
      if (pendingRequests.size === 0 || !walletAddress) return; // Only poll if connected and pending items exist

      const intervalId = setInterval(async () => {
          console.log("[Status Check] Checking pending requests:", Array.from(pendingRequests.keys()));
          const checkPromises = Array.from(pendingRequests.keys()).map(async (contextId) => {
             try {
                const result = await getVerificationResult(contextId); // Call the status check function

                if ('isError' in result && result.isError) {
                     console.error(`[Status Check] Error fetching status for ${contextId}:`, result.error, result.details);
                     // Decide how to handle check errors - maybe remove from pending after N failures?
                     // For now, just log and it will retry next interval.
                      setMessages(prev => prev.map(msg =>
                         (msg.requestContext === contextId && msg.sender === 'System' && msg.text.includes('Fetching result...'))
                         ? { ...msg, text: `${msg.text.split('\n\n')[0]}\n\n(Error checking status: ${result.error})` }
                         : msg
                     ));
                } else if (result.status !== 'Processing' && result.status !== 'Pending Verification') {
                    // Final status received!
                    console.log(`[Status Check] Final result for ${contextId}:`, result);

                    // Create the final AI ChatMessage
                    const finalAiMessage: ChatMessage = {
                        id: Date.now() + Math.random(),
                        sender: 'AI',
                        text: result.answer, // Use the answer from the result
                        apiResponse: result, // Store the full final response
                        requestContext: contextId,
                    };
                    // Add the AI message to the chat
                    // Remove the "Fetching result..." system message before adding the AI one
                     setMessages(prev => [...prev.filter(m => !(m.sender === 'System' && m.requestContext === contextId)), finalAiMessage]);


                    // Update the history entry with the final message
                    updateHistoryEntryWithResult(contextId, finalAiMessage);


                    // Remove from pending requests map
                    setPendingRequests(prev => {
                        const next = new Map(prev);
                        next.delete(contextId);
                        return next;
                    });
                } else {
                    // Still processing
                    console.log(`[Status Check] Request ${contextId} still processing (Status: ${result.status})`);
                     // Update the system message text to show current status
                     setMessages(prev => prev.map(msg =>
                        (msg.requestContext === contextId && msg.sender === 'System')
                        ? { ...msg, text: msg.text.replace(/\(.*\)/, `(Status: ${result.status})`) } // Update status in brackets
                        : msg
                    ));
                }
             } catch (e) { // Catch errors within the async map function
                 console.error(`[Status Check] Unhandled error checking ${contextId}:`, e);
             }
          });
          await Promise.allSettled(checkPromises); // Wait for all checks in this interval to finish
      }, 15000); // Poll every 15 seconds

      return () => clearInterval(intervalId); // Cleanup interval on unmount or dependency change

  }, [pendingRequests, walletAddress, updateHistoryEntryWithResult]); // Dependencies for the polling effect


  // --- History Detail View Handlers ---
  const handleHistoryItemClick = (entry: HistoryEntry) => {
      if (entry.aiMessage?.apiResponse) {
        // Only show detail view if the final result exists
        setSelectedHistoryDetail(entry);
        setShowHistoryList(false);
      } else {
         // Item is pending
         console.log("Clicked pending history item:", entry.requestContext);
          setMessages(prev => [...prev, createSystemMessage(`Result for request "${entry.questionText.substring(0,20)}..." (ID: ${entry.requestContext}) is still pending.`)]);
          setShowHistoryList(false); // Close list after clicking pending
      }
  }
  const closeHistoryDetail = () => { setSelectedHistoryDetail(null); }

  const getHistoryDisplayQuestion = (entry: HistoryEntry): string => {
      const kbCidPart = entry.knowledgeBaseCid ? ` (KB: ${entry.knowledgeBaseCid.substring(0, 6)}...)` : '';
      const statusIndicator = entry.aiMessage ? '' : ' (Pending)'; // Indicate pending items
      return `${entry.questionText}${kbCidPart}${statusIndicator}`;
  }
   const getHistoryTitle = (entry: HistoryEntry): string => {
       const kbCidPart = entry.knowledgeBaseCid ? ` with KB CID ${entry.knowledgeBaseCid}` : '';
       const statusHint = entry.aiMessage?.apiResponse ? `(Status: ${entry.aiMessage.apiResponse.status})` : '(Pending - Click for status)';
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
                // Disable button if history state itself is empty
                disabled={userHistory.length === 0}
                className={`px-3 py-1 rounded text-sm transition-colors shadow ${ userHistory.length > 0 ? 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed' }`}
                title={showHistoryList ? "Hide History List" : "Show History List"}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {/* Show total count including pending */}
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

        {/* History Panel (List) - Shows Pending and Completed */}
        {walletAddress && showHistoryList && (
            <div className="absolute top-14 right-4 w-64 max-h-[60vh] overflow-y-auto bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-xl p-3 z-20">
                <h3 className="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-200 border-b pb-1 dark:border-gray-600 sticky top-0 bg-white dark:bg-gray-800">Query History</h3>
                {userHistory.length > 0 ? (
                    <ul className="space-y-1 pt-1">
                        {userHistory.slice().reverse().map((entry, index) => {
                            const displayQuestion = getHistoryDisplayQuestion(entry); // Now indicates pending
                            const titleText = getHistoryTitle(entry);
                            const key = `${entry.requestContext}-${index}`;
                            return (
                                <li key={key}>
                                    <button
                                        onClick={() => handleHistoryItemClick(entry)}
                                        className={`w-full text-left text-xs p-1 rounded truncate ${entry.aiMessage ? 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700' : 'text-gray-400 dark:text-gray-500 italic cursor-default'}`} // Style pending differently
                                        title={titleText}
                                        // Disable button slightly differently for pending items if desired, but onClick handles it
                                    >
                                        {displayQuestion}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                ) : ( <p className="text-xs text-gray-500 dark:text-gray-400 italic pt-1">No queries submitted yet.</p> )}
            </div>
        )}

        {/* History Detail View (Modal) - Only shows if aiMessage exists */}
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