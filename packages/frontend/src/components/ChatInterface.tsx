// kintask/packages/frontend/src/components/ChatInterface.tsx

import React, { useState, useRef, useEffect, ChangeEvent } from 'react';
import axios, { AxiosError } from 'axios';

// --- W3UP Client Imports (Required if file upload is used) ---
import { create as createW3upClient, Client, CID as W3UPCID, Space } from '@web3-storage/w3up-client';

// --- Component Imports & Types ---
import MessageBubble from './MessageBubble';
import { ChatMessage } from '@/types';

// --- Configuration ---
const IPFS_GATEWAY_URL = import.meta.env.VITE_IPFS_GATEWAY_URL || 'https://w3s.link/ipfs/';

// --- Component Props Interface ---
interface ChatInterfaceProps {
  messages: ChatMessage[];
  // Callback to trigger backend verification flow (requires question AND CID)
  onSendMessage: (message: string, knowledgeBaseCid: string) => void;
  // *** FIX: Add addSystemMessage back to props ***
  addSystemMessage: (text: string) => void; // Function to add system messages to parent chat state
  // addAiMessage is removed as App.tsx handles adding user/final AI messages
}

// --- Constants ---
const W3UP_SPACE_NAME = `kintask-user-docs`;
const PROCESSING_PLACEHOLDER = "Processing...";
const DEFAULT_PLACEHOLDER = "Ask question (attach file or paste CID)...";
const FILE_ATTACHED_PLACEHOLDER = (fileName: string) => `Ask question about ${fileName}...`;


// --- ChatInterface Component ---
const ChatInterface: React.FC<ChatInterfaceProps> = ({
    messages,
    onSendMessage,
    // *** FIX: Destructure addSystemMessage from props ***
    addSystemMessage,
 }) => {
  // --- State ---
  const [inputValue, setInputValue] = useState('');
  const [knowledgeBaseFile, setKnowledgeBaseFile] = useState<File | null>(null);
  const [pastedCid, setPastedCid] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  // const [fetchedKbContent, setFetchedKbContent] = useState<string | null>(null); // No longer needed if FE Gen removed

  // --- Refs ---
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Event Handlers ---
  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => { setInputValue(event.target.value); };

  // Handle file selection
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setPastedCid(''); // Clear pasted CID
    if (file) {
      setKnowledgeBaseFile(file);
      // *** Use addSystemMessage prop ***
      addSystemMessage(`Selected file: ${file.name} (${(file.size / 1024).toFixed(1)} KB). Ready for verification.`);
    } else {
      setKnowledgeBaseFile(null);
    }
    if (event.target) event.target.value = '';
  };

  // Handle CID input
  const handlePastedCidChange = (event: ChangeEvent<HTMLInputElement>) => {
    setPastedCid(event.target.value);
    if (event.target.value && knowledgeBaseFile) {
        handleRemoveFile(); // Use handler below
    }
  };

  const handleAttachClick = () => { if (!isProcessing) fileInputRef.current?.click(); };

  const handleRemoveFile = () => {
     setKnowledgeBaseFile(null);
     if(fileInputRef.current) { fileInputRef.current.value = ''; }
     // *** Use addSystemMessage prop ***
     addSystemMessage("File selection removed.");
     inputRef.current?.focus();
   }

   // *** REMOVED handleFrontendGeneration function ***

  // --- Main Submission Handler ---
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedQuestion = inputValue.trim();
    const trimmedPastedCid = pastedCid.trim();

    if (!trimmedQuestion || isProcessing) {
        if (!trimmedQuestion) addSystemMessage("⚠️ Please enter a question.");
        return;
    }
    const hasFile = !!knowledgeBaseFile;
    const hasValidPastedCid = !!trimmedPastedCid && /^(Qm|baf)[a-zA-Z0-9]{40,}/.test(trimmedPastedCid);

    if (!hasFile && !hasValidPastedCid) {
         // *** Use addSystemMessage prop ***
         addSystemMessage("⚠️ Please attach a knowledge base file or paste a valid IPFS CID for verification.");
         return;
    }

    // --- User message addition should happen in App.tsx after calling onSendMessage ---
    // --- Removed addAiMessage call here ---

    setIsProcessing(true);
    let finalCid: string | undefined = undefined;

    try {
        // --- SCENARIO 1: File Attached -> Upload Required ---
        if (hasFile && knowledgeBaseFile) {
            const userEmailForLogin = window.prompt( `Enter email to upload "${knowledgeBaseFile.name}" via Web3.Storage:`, "" );
            if (!userEmailForLogin || !/\S+@\S+\.\S+/.test(userEmailForLogin)) {
                 // *** Use addSystemMessage prop ***
                 addSystemMessage("⚠️ Valid email required for file upload. Submission cancelled.");
                 setIsProcessing(false); return;
            }
            // *** Use addSystemMessage prop ***
            addSystemMessage(`Preparing upload using ${userEmailForLogin}...`);

            let client: Client | null = null;
            try {
                // *** Use addSystemMessage prop ***
                addSystemMessage(`Attempting login for ${userEmailForLogin}... (Check email)`);
                client = await createW3upClient();
                const account = await client.login(userEmailForLogin);
                addSystemMessage(`✅ Login successful! Setting up space...`);
                await account.plan.wait();
                const space = await client.createSpace("my-awesome-space", { account });
                await client.setCurrentSpace(space.did());
                addSystemMessage(`Using space: ${space.did().substring(0, 15)}... Uploading file...`);
                const uploadedFileCid: W3UPCID = await client.uploadFile(knowledgeBaseFile);
                finalCid = uploadedFileCid.toString();
                addSystemMessage(`✅ File upload complete! CID: ${finalCid.substring(0, 15)}. Submitting...`);
                console.log("[ChatInterface] Upload complete, CID:", finalCid);

            } catch (uploadError: any) {
                 console.error("[ChatInterface] W3UP Login/Upload Failed:", uploadError);
                 // *** Use addSystemMessage prop ***
                 addSystemMessage(`⛔ Upload/Login failed: ${uploadError.message || String(uploadError)}. Submission cancelled.`);
                 finalCid = undefined;
            }
        }
        // --- SCENARIO 2: Pasted CID Provided ---
        else if (hasValidPastedCid) {
            finalCid = trimmedPastedCid;
            // *** Use addSystemMessage prop ***
            addSystemMessage(`Using provided CID. Submitting for verification...`);
        }

        // --- Call Backend Verification (if CID was obtained) ---
        if (finalCid) {
             console.log(`[ChatInterface] Calling onSendMessage (backend verify) with Q + CID: ${finalCid}`);
             // *** Call onSendMessage prop ***
             onSendMessage(trimmedQuestion, finalCid); // Trigger backend flow in App.tsx
             setInputValue(''); setPastedCid(''); handleRemoveFile(); // Clear inputs
        } else {
             console.log("[ChatInterface] No final CID obtained, backend submission skipped.");
             // No need to add system message if upload failed (already added in catch)
             // or if CID was invalid (handled by initial validation)
        }

    } catch (error: any) { // Catch any unexpected errors
        console.error("[ChatInterface] Submission process failed:", error);
        // *** Use addSystemMessage prop ***
        addSystemMessage(`⛔ Error during submission: ${error.message || 'Unknown error'}`);
    } finally {
        setIsProcessing(false); // End loading state
    }
  };

  // --- Effects ---
  useEffect(() => { requestAnimationFrame(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }); }, [messages]);
  useEffect(() => { if (!isProcessing) inputRef.current?.focus(); }, [isProcessing]);

  // --- Render Logic ---
  const canSubmit = !!(inputValue.trim() && (knowledgeBaseFile || pastedCid.trim()) && !isProcessing);
  const placeholderText = isProcessing ? PROCESSING_PLACEHOLDER : (knowledgeBaseFile ? FILE_ATTACHED_PLACEHOLDER(knowledgeBaseFile.name) : DEFAULT_PLACEHOLDER);
  const submitLabel = isProcessing ? "Processing..." : "Verify Answer";

  return (
    <> {/* Fragment Root */}
      {/* Message List Area */}
      <div className="flex-grow p-4 md:p-6 space-y-4 overflow-y-auto min-h-0 scrollbar-thin scrollbar-thumb-gray-400 dark:scrollbar-thumb-gray-600 scrollbar-track-gray-100 dark:scrollbar-track-gray-700">
        {/* Display messages passed down via props */}
        {messages.map((msg) => ( <MessageBubble key={msg.id} message={msg} /> ))}
        <div ref={messagesEndRef} className="h-1" />
      </div>

      {/* Input Area */}
      <div className="shrink-0 border-t border-gray-200 dark:border-gray-700 p-3 md:p-4 bg-gray-50/80 dark:bg-gray-800/80 backdrop-blur-sm sticky bottom-0">
        {/* Display Selected File Info & Remove Button */}
        {knowledgeBaseFile && !isProcessing && (
            <div className="mb-2 text-center text-xs text-gray-600 dark:text-gray-400 flex items-center justify-center">
                {/* File Icon */}
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 mr-1.5 flex-shrink-0 text-gray-400"><path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h6.89a1.5 1.5 0 0 1 1.06.44l2.11 2.111A1.5 1.5 0 0 1 14 5.61V12.5A1.5 1.5 0 0 1 12.5 14h-9A1.5 1.5 0 0 1 2 12.5v-9Zm7.5 0a.5.5 0 0 0-.5.5V6h1.5a.5.5 0 0 0 .5-.5V3.5h-1.5Z" /></svg>
                <span className="truncate max-w-[calc(100%-60px)] inline-block" title={knowledgeBaseFile.name}>{knowledgeBaseFile.name}</span>
                {/* Remove Button */}
                <button type="button" onClick={handleRemoveFile} className="ml-1.5 p-0.5 rounded-full text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 focus:outline-none focus:ring-1 focus:ring-red-300" title="Remove file"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5a.75.75 0 0 1 .786-.711Z" clipRule="evenodd" /></svg></button>
            </div>
        )}
        {/* Main Input Form */}
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto space-y-2">
           {/* Top Row */}
           <div className="flex items-center space-x-2 sm:space-x-3">
               {/* Attach Button */}
               <button type="button" onClick={handleAttachClick} disabled={isProcessing} title={knowledgeBaseFile ? "Change attached file" : "Attach Knowledge Base File"} className={`flex-shrink-0 p-2 rounded-full transition-colors text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed`} > <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M15.621 4.379a3 3 0 0 0-4.242 0l-7 7a3 3 0 0 0 4.241 4.243h.001l.497-.5a.75.75 0 0 1 1.064 1.057l-.498.501-.002.002a4.5 4.5 0 0 1-6.364-6.364l7-7a4.5 4.5 0 0 1 6.368 6.36l-3.455 3.553A2.625 2.625 0 1 1 9.52 9.52l3.45-3.451a.75.75 0 1 1 1.061 1.06l-3.45 3.451a1.125 1.125 0 0 0 1.587 1.595l3.454-3.553a3 3 0 0 0 0-4.242Z" clipRule="evenodd" /></svg> </button>
               <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".txt,.md,.json,.pdf,.csv,text/*,application/json,application/pdf" disabled={isProcessing} />
               {/* Question Input */}
               <input ref={inputRef} type="text" value={inputValue} onChange={handleInputChange} placeholder={placeholderText} className="flex-grow px-4 py-2.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-full focus:outline-none focus:ring-2 focus:ring-kintask-blue dark:focus:ring-kintask-blue-light text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 shadow-sm transition-colors duration-200 disabled:opacity-60 disabled:cursor-not-allowed" disabled={isProcessing} />
               {/* Submit Button */}
               <button type="submit" className={`flex-shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-full text-white font-semibold focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-100 dark:focus:ring-offset-gray-800 transition-all duration-200 transform hover:scale-105 ${ !canSubmit ? 'bg-gray-300 dark:bg-gray-600 cursor-not-allowed' : 'bg-kintask-blue hover:bg-kintask-blue-dark focus:ring-kintask-blue/50 dark:focus:ring-kintask-blue-light/50' }`} disabled={!canSubmit} aria-busy={isProcessing} aria-label={submitLabel} >
                   {isProcessing ? (<div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>) : (<svg className="w-5 h-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M3.105 3.105a.75.75 0 0 1 .814-.102l14.002 6.999a.75.75 0 0 1 0 1.395l-14.002 7.001a.75.75 0 0 1-1.01-.605V13.8a.75.75 0 0 1 .3-.568L9.4 9.999l-6.195-3.1a.75.75 0 0 1-.3-.568V3.707a.75.75 0 0 1 .205-.502z" /></svg>)}
               </button>
           </div>
            {/* Optional KB CID Input (Show only if NO file is attached) */}
            {!knowledgeBaseFile && (
                 <div className="pl-10 pr-14">
                      <input type="text" value={pastedCid} onChange={handlePastedCidChange} placeholder="Optional: Paste KB CID instead of attaching file" className="w-full px-4 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-full focus:outline-none focus:ring-1 focus:ring-kintask-blue/50 dark:focus:ring-kintask-blue-light/50 text-gray-600 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500 disabled:opacity-60" disabled={isProcessing} aria-label="Optional Knowledge Base IPFS CID" />
                 </div>
             )}
        </form>
      </div>
    </>
  );
};

export default ChatInterface;