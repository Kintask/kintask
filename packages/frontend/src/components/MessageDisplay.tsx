import React, { useState, useMemo } from 'react';
import { ChatMessage, RecallLogEntryData, VerificationStatus } from '@/types'; // Use defined types

interface MessageDisplayProps {
  message: ChatMessage;
}

// Helper to get Tailwind classes based on verification status
// Uses classes defined in tailwind.config.js
const getStatusStyles = (status?: VerificationStatus): { text: string, border: string, bg: string } => {
    switch (status) {
        case 'Verified': return { text: 'status-verified-text', border: 'status-verified-border', bg: 'status-verified-bg' };
        case 'Flagged: Uncertain': return { text: 'status-uncertain-text', border: 'status-uncertain-border', bg: 'status-uncertain-bg' };
        case 'Flagged: Contradictory': return { text: 'status-contradictory-text', border: 'status-contradictory-border', bg: 'status-contradictory-bg' };
        case 'Unverified': return { text: 'status-unverified-text', border: 'status-unverified-border', bg: 'status-unverified-bg' };
        case 'Error: Verification Failed': // Fallthrough intended
        case 'Error: Timelock Failed':
             return { text: 'status-error-text', border: 'status-error-border', bg: 'status-error-bg' };
        default: // Should not happen if status is always set, but provide fallback
             return { text: 'text-gray-500', border: 'border-gray-300', bg: 'bg-gray-100' };
    }
}

// Formatter for Recall log entries (adjust formatting as needed)
const formatRecallEntry = (entry: RecallLogEntryData): string => {
    const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
    // Attempt to pretty-print details, truncate if too long
    let detailsStr = '';
    try {
         detailsStr = JSON.stringify(entry.details);
         if (detailsStr.length > 120) detailsStr = detailsStr.substring(0, 117) + '...}';
    } catch (e) {
         detailsStr = '{...}'; // Fallback if stringify fails
    }
    return `${time} [${entry.type}] ${detailsStr}`;
}

// Component to render individual messages
const MessageDisplay: React.FC<MessageDisplayProps> = ({ message }) => {
  const isUser = message.sender === 'User';
  const apiData = message.apiResponse; // Full response data attached to AI messages
  // Use useMemo to prevent recalculating styles on every render unless status changes
  const statusStyles = useMemo(() => getStatusStyles(apiData?.status), [apiData?.status]);
  const [showTrace, setShowTrace] = useState(false);

  // Configurable IPFS Gateway
  const filecoinGatewayBase = 'https://w3s.link/ipfs/'; // Or use env variable

  // Determine if details should be shown (only for non-user, non-loading AI messages with relevant data)
  // Exclude details for the initial 'Unverified' welcome message.
  const showDetails = !isUser && !message.isLoading && apiData && apiData.status && apiData.status !== 'Unverified';

  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} mb-3 animate-fade-in`}>
      {/* Message Bubble */}
      <div className={`relative max-w-xl px-4 py-3 rounded-lg shadow-md ${
          isUser
            ? 'bg-kintask-blue text-white rounded-br-none' // User message style
            : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-bl-none border border-gray-200 dark:border-gray-600' // AI message style
        }`}
      >
        {/* Loading Indicator */}
        {message.isLoading && (
             <div className="flex items-center justify-center space-x-1.5 py-1">
                {/* Use Tailwind animation classes */}
                <div className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="w-1.5 h-1.5 bg-current rounded-full animate-bounce"></div>
             </div>
        )}

        {/* Message Text (don't show if it's just an empty loading placeholder) */}
        {!message.isLoading && message.text && (
             <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{message.text}</p>
        )}

        {/* --- Verification Details Section --- */}
        {showDetails && (
          <div className={`mt-3 pt-3 border-t ${statusStyles.border} text-xs`}>

            {/* Status and Confidence */}
            <div className={`flex justify-between items-center mb-2 px-2 py-1 rounded ${statusStyles.bg}`}>
                <span className={`font-semibold text-xs uppercase tracking-wide ${statusStyles.text}`}>{apiData.status}</span>
                {/* Show confidence only if available and status is not an error */}
                {apiData.confidence !== undefined && !apiData.status.startsWith('Error:') && (
                    <span className="ml-2 text-gray-500 dark:text-gray-400 text-[11px] font-medium">
                        Confidence: {(apiData.confidence * 100).toFixed(0)}%
                    </span>
                )}
            </div>

             {/* Evidence & Commitment Links */}
             {(apiData.usedFragmentCids?.length || apiData.timelockTxExplorerUrl) && (
                 <div className="grid grid-cols-2 gap-x-4 gap-y-1 items-center my-2 text-gray-600 dark:text-gray-400">
                     {/* Filecoin Links */}
                     {apiData.usedFragmentCids && apiData.usedFragmentCids.length > 0 && (
                         <div className="flex items-center space-x-1">
                             <span className="font-medium text-[11px] shrink-0">Evidence:</span>
                             <div className="flex flex-wrap gap-1">
                                 {apiData.usedFragmentCids.slice(0, 3).map((cid, index) => ( // Limit displayed links
                                     <a href={`${filecoinGatewayBase}${cid}`} target="_blank" rel="noopener noreferrer"
                                        className="text-blue-600 dark:text-blue-400 hover:underline text-[11px] font-mono"
                                        title={`View Fragment on IPFS (CID: ${cid})`}
                                        key={`${cid}-${index}`}>
                                         [{cid.substring(0, 4)}..{cid.substring(cid.length - 4)}]
                                     </a>
                                 ))}
                                 {apiData.usedFragmentCids.length > 3 && <span className="text-[11px] text-gray-400">...</span>}
                             </div>
                         </div>
                     )}
                      {/* Timelock Link */}
                     {apiData.timelockTxExplorerUrl && (
                         <div className="flex items-center space-x-1">
                             <span className="font-medium text-[11px] shrink-0">Commitment:</span>
                             <a href={apiData.timelockTxExplorerUrl} target="_blank" rel="noopener noreferrer"
                                className="text-purple-600 dark:text-purple-400 hover:underline text-[11px]"
                                title={`View Timelock Tx on L2 Explorer (Request ID: ${apiData.timelockRequestId ?? 'N/A'})`}>
                                 [L2 Tx Link]
                             </a>
                         </div>
                     )}
                 </div>
             )}


             {/* Recall Trace Toggle & Display */}
             {apiData.recallTrace && apiData.recallTrace.length > 0 && (
                 <div className="mt-2">
                     <button
                         onClick={() => setShowTrace(!showTrace)}
                         className="text-indigo-600 dark:text-indigo-400 hover:underline text-[11px] font-medium mb-1 focus:outline-none flex items-center"
                         aria-expanded={showTrace}
                     >
                         {showTrace ? (
                             <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 mr-1"><path fillRule="evenodd" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" /></svg>
                         ) : (
                             <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 mr-1"><path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" /></svg>
                         )}
                         Reasoning Trace ({apiData.recallTrace.length} steps)
                     </button>
                     {showTrace && (
                         <div className="mt-1 p-2 border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 rounded max-h-48 overflow-y-auto scrollbar text-gray-600 dark:text-gray-400 text-[10px] font-mono leading-tight space-y-0.5">
                             {apiData.recallTrace.map((entry: RecallLogEntryData, index) => (
                                 // Use whitespace-normal to allow wrapping, break-words for long details
                                 <div key={index} className="whitespace-normal break-words">{formatRecallEntry(entry)}</div>
                             ))}
                         </div>
                     )}
                 </div>
             )}

             {/* Display API Error Message if present */}
             {apiData.error && (
                 <div className={`mt-2 text-red-600 dark:text-red-400 text-xs border-t pt-2 ${statusStyles.border}`}>
                     <p><span className="font-semibold">Error:</span> {apiData.error}</p>
                     {apiData.details && <p className="text-[11px] mt-0.5 opacity-80">{apiData.details}</p>}
                 </div>
             )}

          </div>
        )}
      </div>
    </div>
  );
};

export default MessageDisplay;
