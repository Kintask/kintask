// kintask/packages/frontend/src/components/MessageBubble.tsx

import React, { useState } from 'react';
// --- Types ---
import { ChatMessage, RecallLogEntryData } from '@/types'; // Import necessary types
// --- Config ---
const IPFS_GATEWAY_URL = import.meta.env.VITE_IPFS_GATEWAY_URL || 'https://w3s.link/ipfs/';

interface MessageBubbleProps {
  message: ChatMessage;
}

// --- Style Helper ---
// *** FIX: Added cases for Processing/Pending and ensure default returns all keys ***
const getStatusStyles = (status?: string | null): {textColor: string, borderColor: string, bgColor: string } => {
    const defaultStyles = { textColor: 'text-gray-500 dark:text-gray-400', borderColor: 'border-transparent', bgColor: 'bg-transparent' };
    switch (status) {
        case 'Verified': return { textColor: 'text-green-700 dark:text-green-300', borderColor: 'border-green-500 dark:border-green-700', bgColor: 'bg-green-50 dark:bg-green-900/30' };
        case 'Flagged: Uncertain': return { textColor: 'text-yellow-700 dark:text-yellow-300', borderColor: 'border-yellow-500 dark:border-yellow-600', bgColor: 'bg-yellow-50 dark:bg-yellow-900/30' };
        case 'Flagged: Contradictory': return { textColor: 'text-orange-700 dark:text-orange-300', borderColor: 'border-orange-500 dark:border-orange-600', bgColor: 'bg-orange-50 dark:bg-orange-900/30' };
        case 'Unverified': return { textColor: 'text-gray-600 dark:text-gray-400', borderColor: 'border-gray-400 dark:border-gray-500', bgColor: 'bg-gray-50 dark:bg-gray-700/30' };
        case 'Error: Verification Failed': return { textColor: 'text-red-700 dark:text-red-300', borderColor: 'border-red-500 dark:border-red-600', bgColor: 'bg-red-50 dark:bg-red-900/30' };
        case 'Error: Timelock Failed': return { textColor: 'text-red-800 dark:text-red-400', borderColor: 'border-red-600 dark:border-red-700', bgColor: 'bg-red-100 dark:bg-red-900/40' };
        case 'Processing': // Style for processing state
        case 'Pending Verification': // Style for pending state
             return { textColor: 'text-blue-600 dark:text-blue-400', borderColor: 'border-blue-400 dark:border-blue-600', bgColor: 'bg-blue-50 dark:bg-blue-900/30' };
        case 'System Notification': // Style for system messages (if needed, otherwise default)
             return { textColor: 'text-gray-500 dark:text-gray-400', borderColor: 'border-gray-300 dark:border-gray-600', bgColor: 'bg-gray-100 dark:bg-gray-700/50' };
        default: // Handles null, undefined, or any other status
             return defaultStyles;
    }
}

// --- Formatting Helper ---
const formatRecallEntry = (entry: RecallLogEntryData): string => {
    const time = new Date(entry.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    let detailsStr = JSON.stringify(entry.details);
    if (detailsStr.length > 100) detailsStr = detailsStr.substring(0, 97) + '...}';
    // Return simple string - avoid complex HTML injection for safety
    return `${time} [${entry.type}] ${detailsStr}`;
}

// --- Message Bubble Component ---
const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isUser = message.sender === 'User';
  const isSystem = message.sender === 'System';
  const apiData = message.apiResponse; // Can be null or Partial<ApiVerifyResponse>
  // *** FIX: Call getStatusStyles safely, it now handles undefined/null status ***
  const statusStyles = getStatusStyles(apiData?.status); // Get styles based on status in apiResponse
  const [showTrace, setShowTrace] = useState(false);

  // Determine if the message represents a final state (for UI logic)
  const isFinalState = !message.isLoading && apiData && apiData.status !== 'Processing' && apiData.status !== 'Pending Verification';
  const isErrorState = apiData?.status?.startsWith('Error:');


  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} mb-3 animate-fade-in group`}>
      {/* Optional: Timestamp display on hover? */}
      {/* <span className="text-xs text-gray-400 dark:text-gray-500 mb-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">{new Date(message.id/1).toLocaleTimeString()}</span> */}

      <div className={`relative max-w-xl px-4 py-3 rounded-lg shadow-md ${
          isUser ? 'bg-blue-600 text-white rounded-br-none' :
          isSystem ? `${statusStyles.bgColor} ${statusStyles.textColor} text-xs italic border ${statusStyles.borderColor} rounded-bl-none rounded-br-none` : // Style system messages
          'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-bl-none border dark:border-gray-600' // Default AI bubble
        }`}
      >
        {/* Loading Indicator */}
        {message.isLoading && (
             <div className="flex items-center justify-center space-x-1.5 py-1">
                <div className={`w-1.5 h-1.5 rounded-full animate-bounce-slow [animation-delay:-0.3s] ${isUser ? 'bg-white/70' : 'bg-gray-500/70 dark:bg-gray-400/70'}`}></div>
                <div className={`w-1.5 h-1.5 rounded-full animate-bounce-slow [animation-delay:-0.15s] ${isUser ? 'bg-white/70' : 'bg-gray-500/70 dark:bg-gray-400/70'}`}></div>
                <div className={`w-1.5 h-1.5 rounded-full animate-bounce-slow ${isUser ? 'bg-white/70' : 'bg-gray-500/70 dark:bg-gray-400/70'}`}></div>
             </div>
        )}

        {/* Message Text (show unless it's just a loader placeholder) */}
        {!message.isLoading && message.text && (
             <p className={`text-sm leading-relaxed whitespace-pre-wrap break-words ${isSystem ? 'text-center' : ''}`}>
                {message.text}
            </p>
        )}
         {/* Edge case: Loading finished but no text? Show placeholder */}
         {!message.isLoading && !message.text && !isUser && (
             <p className="text-sm italic text-gray-400 dark:text-gray-500">[AI response processing complete - no text received]</p>
         )}


        {/* Verification Details Section (only for NON-USER, NON-SYSTEM, FINALIZED AI messages) */}
        {!isUser && !isSystem && isFinalState && apiData && (
          <div className={`mt-3 pt-2 border-t ${statusStyles.borderColor} text-xs`}>
            {/* Status and Confidence */}
            <div className={`flex justify-between items-center mb-1 px-2 py-1 rounded ${statusStyles.bgColor}`}>
                <span className={`font-semibold text-xs uppercase tracking-wide ${statusStyles.textColor}`}>
                    {apiData.status ?? 'Status Unknown'}
                </span>
                {apiData.confidence !== undefined && (
                    <span className="ml-2 text-gray-500 dark:text-gray-400 text-xs">
                        Confidence: {(apiData.confidence * 100).toFixed(0)}%
                    </span>
                )}
            </div>

             {/* Links Area */}
             {(apiData.usedFragmentCids?.length || apiData.timelockTxExplorerUrl) && (
                 <div className="flex flex-wrap gap-x-4 gap-y-1 items-center my-1 text-gray-600 dark:text-gray-400">
                     {/* Filecoin Links */}
                     {apiData.usedFragmentCids && apiData.usedFragmentCids.length > 0 && (
                         <div className="flex items-center space-x-1">
                             <span className="font-medium text-[11px]">Evidence:</span>
                             {apiData.usedFragmentCids.slice(0, 3).map((cid, index) => (
                                 <a href={`${IPFS_GATEWAY_URL}${cid}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline text-[11px]" title={`View Fragment ${index + 1} (CID: ${cid})`} key={`${cid}-${index}`}> [F{index + 1}] </a>
                             ))}
                             {apiData.usedFragmentCids.length > 3 && <span className="text-[11px]">...</span>}
                         </div>
                     )}
                      {/* Timelock Link */}
                     {apiData.timelockTxExplorerUrl && (
                         <div className="flex items-center space-x-1">
                             <span className="font-medium text-[11px]">Commitment:</span>
                             <a href={apiData.timelockTxExplorerUrl} target="_blank" rel="noopener noreferrer" className="text-purple-600 dark:text-purple-400 hover:underline text-[11px]" title={`View Timelock Tx (Request ID: ${apiData.timelockRequestId ?? 'N/A'})`}> [L2 Tx] </a>
                         </div>
                     )}
                 </div>
             )}

             {/* Recall Trace Toggle & Display */}
             {apiData.recallTrace && apiData.recallTrace.length > 0 && (
                 <div className="mt-2">
                     <button onClick={() => setShowTrace(!showTrace)} className="text-indigo-600 dark:text-indigo-400 hover:underline text-xs font-medium mb-1 focus:outline-none">
                         {showTrace ? '▼ Hide' : '▶ Show'} Reasoning Trace ({apiData.recallTrace.length} steps)
                     </button>
                     {showTrace && (
                         <div className="mt-1 p-2 border dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 rounded max-h-48 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-400 dark:scrollbar-thumb-gray-600 text-gray-600 dark:text-gray-400 text-[10px] font-mono leading-tight space-y-1">
                             {apiData.recallTrace.map((entry, index) => (
                                 // Simple rendering of formatted string
                                 <div key={index} className="whitespace-pre-wrap break-words">{formatRecallEntry(entry)}</div>
                                 // NOTE: If formatRecallEntry returns HTML, use dangerouslySetInnerHTML with caution:
                                 // <div key={index} dangerouslySetInnerHTML={{ __html: formatRecallEntry(entry) }} />
                             ))}
                         </div>
                     )}
                 </div>
             )}

             {/* Display API Error Message if present */}
             {apiData.error && (
                 <p className={`mt-2 text-red-600 dark:text-red-400 text-xs border-t pt-1 ${statusStyles.borderColor}`}>
                     <span className="font-semibold">Error Detail:</span> {apiData.error} {apiData.details ? `(${apiData.details.substring(0,100)}...)` : ''}
                 </p>
             )}

          </div>
        )}
      </div>
    </div>
  );
};

export default MessageBubble;