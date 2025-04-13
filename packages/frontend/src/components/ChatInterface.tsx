// kintask/packages/frontend/src/components/ChatInterface.tsx

import React, { useState, useRef, useEffect, ChangeEvent } from 'react';
import axios, { AxiosError } from 'axios'; // Keep for potential future use?

// --- W3UP Client Imports ---
import { create as createW3upClient, Client, CID as W3UPCID, Space } from '@web3-storage/w3up-client';

// --- Component Imports & Types ---
import MessageBubble from './MessageBubble';
import { ChatMessage } from '@/types';

// --- Configuration ---
const IPFS_GATEWAY_URL = import.meta.env.VITE_IPFS_GATEWAY_URL || 'https://w3s.link/ipfs/';

interface ChatInterfaceProps {
  messages: ChatMessage[];
  onSendMessage: (message: string, knowledgeBaseCid: string) => void;
  addSystemMessage: (text: string) => void;
  addAiMessage: (message: ChatMessage) => void;
}

// --- Constants ---
const W3UP_SPACE_NAME = `kintask-user-docs`;
const PROCESSING_PLACEHOLDER = "Processing...";
const DEFAULT_PLACEHOLDER = "Ask question (attach file or paste CID)...";
const FILE_ATTACHED_PLACEHOLDER = (fileName: string) => `Ask about ${fileName}...`;
const EMAIL_INPUT_PLACEHOLDER = "Enter email to upload & verify file...";


// --- ChatInterface Component ---
const ChatInterface: React.FC<ChatInterfaceProps> = ({
    messages,
    onSendMessage,
    addSystemMessage,
    addAiMessage,
 }) => {
  // --- State ---
  const [inputValue, setInputValue] = useState(''); // User question
  const [knowledgeBaseFile, setKnowledgeBaseFile] = useState<File | null>(null);
  const [pastedCid, setPastedCid] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  // *** NEW STATE for Email Input ***
  const [userEmail, setUserEmail] = useState('');

  // --- Refs ---
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null); // Ref for email input

  // --- Event Handlers ---
  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => { setInputValue(event.target.value); };
  const handlePastedCidChange = (event: ChangeEvent<HTMLInputElement>) => {
    setPastedCid(event.target.value);
    if (event.target.value && knowledgeBaseFile) { handleRemoveFile(); }
  };
  // *** NEW Handler for Email Input ***
   const handleEmailChange = (event: ChangeEvent<HTMLInputElement>) => {
       setUserEmail(event.target.value);
   };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setPastedCid(''); // Clear CID if file selected
    setUserEmail(''); // Clear email if new file selected
    if (file) {
      setKnowledgeBaseFile(file);
      addSystemMessage(`Selected file: ${file.name}. Enter email below to upload.`);
      // Focus email input after short delay?
       setTimeout(() => emailInputRef.current?.focus(), 100);
    } else {
      setKnowledgeBaseFile(null);
    }
    if (event.target) event.target.value = '';
  };

  const handleAttachClick = () => { if (!isProcessing) fileInputRef.current?.click(); };

  const handleRemoveFile = () => {
     setKnowledgeBaseFile(null);
     setUserEmail(''); // Clear email when file removed
     if(fileInputRef.current) { fileInputRef.current.value = ''; }
     inputRef.current?.focus();
   }

  // --- Main Submission Handler ---
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedQuestion = inputValue.trim();
    const trimmedPastedCid = pastedCid.trim();
    // *** Get email from state ***
    const trimmedUserEmail = userEmail.trim();

    if (!trimmedQuestion || isProcessing) {
        if (!trimmedQuestion) addSystemMessage("⚠️ Please enter a question.");
        return;
    }
    const hasFile = !!knowledgeBaseFile;
    const hasValidPastedCid = !!trimmedPastedCid && /^(Qm|bafy|bafk)[a-zA-Z0-9]{40,}/.test(trimmedPastedCid);

    // Require either File+Email OR a valid CID
    if (hasFile && (!trimmedUserEmail || !/\S+@\S+\.\S+/.test(trimmedUserEmail))) {
         addSystemMessage("⚠️ Please enter a valid email address below to upload the attached file.");
         emailInputRef.current?.focus();
         return;
    }
    if (!hasFile && !hasValidPastedCid) {
         addSystemMessage("⚠️ Please attach a file (and enter email) or paste a valid IPFS CID for verification.");
         return;
    }

    // Add User Message
    const userTimestamp = Date.now();
    let userMessageText = trimmedQuestion;
    if (hasFile && knowledgeBaseFile) userMessageText += `\n(Using file: ${knowledgeBaseFile.name})`;
    else if (hasValidPastedCid) userMessageText += `\n(Using KB CID: ${trimmedPastedCid.substring(0, 10)}...)`;
    addAiMessage({ id: userTimestamp, sender: 'User', text: userMessageText, apiResponse: null });

    setIsProcessing(true);
    let finalCid: string | undefined = undefined;

    try {
        // --- SCENARIO 1: File Attached -> Upload Required ---
        if (hasFile && knowledgeBaseFile && trimmedUserEmail) { // Check email here
            addSystemMessage(`Preparing upload using ${trimmedUserEmail}...`);
            let client: Client | null = null;
            try {
                addSystemMessage(`Attempting login for ${trimmedUserEmail}... (Check email)`);
                client = await createW3upClient();
                const account = await client.login(trimmedUserEmail);
                addSystemMessage(`✅ Login successful! Setting up space...`);
                await account.plan.wait();
                const spaceName = `${W3UP_SPACE_NAME}-${account.did().substring(8, 16)}`;
                let space: Space | undefined = client.currentSpace() || (await client.spaces()).find(s => s.name === spaceName);
                if (!space) { space = await client.createSpace(spaceName); try { await space.provision(account.did()); } catch(e){console.warn("Provisioning failed:", e);} }
                await client.setCurrentSpace(space.did());
                addSystemMessage(`Using space: ${space.did().substring(0, 15)}... Uploading file...`);
                const uploadedFileCid: W3UPCID = await client.uploadFile(knowledgeBaseFile);
                finalCid = uploadedFileCid.toString();
                addSystemMessage(`✅ File upload complete! CID: ${finalCid.substring(0, 15)}. Submitting...`);
                console.log("[ChatInterface] Upload complete, CID:", finalCid);

            } catch (uploadError: any) {
                 console.error("[ChatInterface] W3UP Login/Upload Failed:", uploadError);
                 addSystemMessage(`⛔ Upload/Login failed: ${uploadError.message || String(uploadError)}. Submission cancelled.`);
                 finalCid = undefined;
                 // Don't clear inputs here on failure, let user retry submit?
            }
        }
        // --- SCENARIO 2: Pasted CID Provided ---
        else if (hasValidPastedCid) {
            finalCid = trimmedPastedCid;
            addSystemMessage(`Using provided CID. Submitting for verification...`);
        }

        // --- Call Backend Verification (if CID was obtained) ---
        if (finalCid) {
             console.log(`[ChatInterface] Calling onSendMessage (backend verify) with Q + CID: ${finalCid}`);
             onSendMessage(trimmedQuestion, finalCid);
             // Clear inputs AFTER successfully initiating the backend call
             setInputValue('');
             setPastedCid('');
             setUserEmail(''); // Clear email input too
             handleRemoveFile(); // Clear file state
        } else {
             console.log("[ChatInterface] No final CID obtained, backend submission skipped.");
             // Error messages were already shown during the process
        }

    } catch (error: any) {
        console.error("[ChatInterface] Submission process failed:", error);
        addSystemMessage(`⛔ Error during submission: ${error.message || 'Unknown error'}`);
    } finally {
        setIsProcessing(false); // End loading state
    }
  };

  // --- Effects ---
  useEffect(() => { requestAnimationFrame(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }); }, [messages]);
  useEffect(() => { if (!isProcessing && !knowledgeBaseFile) inputRef.current?.focus(); }, [isProcessing, knowledgeBaseFile]); // Refocus question if file removed

  // --- Render Logic ---
  const showEmailInput = !!knowledgeBaseFile; // Show email input only when file is attached
  // Enable submit if question + (file&email OR valid CID)
  const canSubmit = !!(
        inputValue.trim() &&
        !isProcessing &&
        ( (knowledgeBaseFile && userEmail.trim() && /\S+@\S+\.\S+/.test(userEmail.trim())) || // File needs valid email
          (!knowledgeBaseFile && pastedCid.trim() && /^(Qm|bafy|bafk)[a-zA-Z0-9]{40,}/.test(pastedCid.trim())) // Or valid CID if no file
        )
    );

  const placeholderText = isProcessing ? PROCESSING_PLACEHOLDER : (knowledgeBaseFile ? FILE_ATTACHED_PLACEHOLDER(knowledgeBaseFile.name) : DEFAULT_PLACEHOLDER);
  const submitLabel = isProcessing ? "Processing..." : "Verify Answer";


  return (
    <> {/* Fragment Root */}
      {/* Message List Area */}
      <div className="flex-grow p-4 md:p-6 space-y-4 overflow-y-auto min-h-0 scrollbar-thin scrollbar-thumb-gray-400 dark:scrollbar-thumb-gray-600 scrollbar-track-gray-100 dark:scrollbar-track-gray-700">
        {messages.map((msg) => ( <MessageBubble key={msg.id} message={msg} /> ))}
        <div ref={messagesEndRef} className="h-1" />
      </div>

      {/* Input Area */}
      <div className="shrink-0 border-t border-gray-200 dark:border-gray-700 p-3 md:p-4 bg-gray-50/80 dark:bg-gray-800/80 backdrop-blur-sm sticky bottom-0">
        {/* Display Selected File Info & Remove Button */}
        {knowledgeBaseFile && !isProcessing && (
             <div className="mb-2 text-center text-xs text-gray-600 dark:text-gray-400 flex items-center justify-center">
                 <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 mr-1.5 flex-shrink-0 text-gray-400"><path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h6.89a1.5 1.5 0 0 1 1.06.44l2.11 2.111A1.5 1.5 0 0 1 14 5.61V12.5A1.5 1.5 0 0 1 12.5 14h-9A1.5 1.5 0 0 1 2 12.5v-9Zm7.5 0a.5.5 0 0 0-.5.5V6h1.5a.5.5 0 0 0 .5-.5V3.5h-1.5Z" /></svg>
                 <span className="truncate max-w-[calc(100%-60px)] inline-block" title={knowledgeBaseFile.name}>{knowledgeBaseFile.name}</span>
                 <button type="button" onClick={handleRemoveFile} className="ml-1.5 p-0.5 rounded-full text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 focus:outline-none focus:ring-1 focus:ring-red-300" title="Remove file"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5a.75.75 0 0 1 .786-.711Z" clipRule="evenodd" /></svg></button>
             </div>
        )}
        {/* Main Input Form */}
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto space-y-2">
           {/* Top Row: Attach + Question Input + Submit */}
           <div className="flex items-center space-x-2 sm:space-x-3">
               {/* Attach Button */}
               <button type="button" onClick={handleAttachClick} disabled={isProcessing} title={knowledgeBaseFile ? "Change attached file" : "Attach File for Verified Answer"} className={`flex-shrink-0 p-2 rounded-full transition-colors text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed`} > <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M15.621 4.379a3 3 0 0 0-4.242 0l-7 7a3 3 0 0 0 4.241 4.243h.001l.497-.5a.75.75 0 0 1 1.064 1.057l-.498.501-.002.002a4.5 4.5 0 0 1-6.364-6.364l7-7a4.5 4.5 0 0 1 6.368 6.36l-3.455 3.553A2.625 2.625 0 1 1 9.52 9.52l3.45-3.451a.75.75 0 1 1 1.061 1.06l-3.45 3.451a1.125 1.125 0 0 0 1.587 1.595l3.454-3.553a3 3 0 0 0 0-4.242Z" clipRule="evenodd" /></svg> </button>
               <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".txt,.md,.json,.pdf,.csv,text/*,application/json,application/pdf" disabled={isProcessing} />
               {/* Question Input */}
               <input ref={inputRef} type="text" value={inputValue} onChange={handleInputChange} placeholder={placeholderText} className="flex-grow px-4 py-2.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-full focus:outline-none focus:ring-2 focus:ring-kintask-blue dark:focus:ring-kintask-blue-light text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 shadow-sm transition-colors duration-200 disabled:opacity-60 disabled:cursor-not-allowed" disabled={isProcessing} />
               {/* Submit Button */}
               <button type="submit" className={`flex-shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-full text-white font-semibold focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-100 dark:focus:ring-offset-gray-800 transition-all duration-200 transform hover:scale-105 ${ !canSubmit ? 'bg-gray-300 dark:bg-gray-600 cursor-not-allowed' : 'bg-kintask-blue hover:bg-kintask-blue-dark focus:ring-kintask-blue/50 dark:focus:ring-kintask-blue-light/50' }`} disabled={!canSubmit} aria-busy={isProcessing} aria-label={submitLabel} >
                    {isProcessing ? (<div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>) : (<svg className="w-5 h-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M3.105 3.105a.75.75 0 0 1 .814-.102l14.002 6.999a.75.75 0 0 1 0 1.395l-14.002 7.001a.75.75 0 0 1-1.01-.605V13.8a.75.75 0 0 1 .3-.568L9.4 9.999l-6.195-3.1a.75.75 0 0 1-.3-.568V3.707a.75.75 0 0 1 .205-.502z" /></svg>)}
               </button>
           </div>

            {/* Conditional Input Row: Show Email OR CID input */}
            <div className="pl-10 pr-14"> {/* Indent roughly */}
                {/* Show Email input only if a file is attached */}
                {knowledgeBaseFile && (
                    <input
                        ref={emailInputRef}
                        type="email"
                        value={userEmail}
                        onChange={handleEmailChange}
                        placeholder={EMAIL_INPUT_PLACEHOLDER}
                        className="w-full px-4 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-full focus:outline-none focus:ring-1 focus:ring-kintask-blue/50 dark:focus:ring-kintask-blue-light/50 text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 disabled:opacity-60"
                        disabled={isProcessing}
                        aria-label="Email for file upload"
                        required // Make email required if file is present for submission
                    />
                )}
                {/* Show CID input only if NO file is attached */}
                {!knowledgeBaseFile && (
                      <input
                        type="text"
                        value={pastedCid}
                        onChange={handlePastedCidChange}
                        placeholder="Optional: Paste KB CID instead of attaching file"
                        className="w-full px-4 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-full focus:outline-none focus:ring-1 focus:ring-kintask-blue/50 dark:focus:ring-kintask-blue-light/50 text-gray-600 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500 disabled:opacity-60"
                        disabled={isProcessing}
                        aria-label="Optional Knowledge Base IPFS CID"
                      />
                 )}
             </div>
        </form>
      </div>
    </>
  );
};

export default ChatInterface;