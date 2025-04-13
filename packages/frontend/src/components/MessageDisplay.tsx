// kintask/packages/frontend/src/components/MessageDisplay.tsx
import React, { useState } from 'react';
import { ChatMessage, FinalVerificationResult, RecallLogEntryData, VerificationStatus } from '../types'; // Import necessary types

interface MessageDisplayProps {
  message: ChatMessage;
}

// Function to get Tailwind CSS classes based on the FINAL evaluation status
const getStatusStyles = (status?: VerificationStatus | string): { text: string, border: string, bg: string, icon?: JSX.Element } => {
    let icon = null;
    // Map backend evaluation/status strings to VerificationStatus type if needed
    // Example mapping (adjust based on actual backend strings)
    let displayStatus: VerificationStatus | string = status || 'Unverified';
    if (typeof status === 'string') {
         if (status.toLowerCase().includes('verified')) displayStatus = 'Verified';
         else if (status.toLowerCase().includes('uncertain')) displayStatus = 'Flagged: Uncertain';
         else if (status.toLowerCase().includes('contradictory')) displayStatus = 'Flagged: Contradictory';
         else if (status.toLowerCase().includes('unverified')) displayStatus = 'Unverified';
         else if (status.toLowerCase().includes('failed') || status.toLowerCase().includes('error')) displayStatus = 'Error: Verification Failed'; // Generalize errors
         else if (status === 'NoValidAnswers') displayStatus = 'Error: No Valid Answers';
         // Keep processing statuses if passed
    }


    switch (displayStatus) {
        case 'Verified':
             icon = <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clipRule="evenodd" /></svg>;
             return { text: 'text-green-700 dark:text-green-300', border: 'border-green-500', bg: 'bg-green-50 dark:bg-green-900/20', icon };
        case 'Flagged: Uncertain':
             icon = <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM8.94 6.553a.75.75 0 0 0-1.06 1.06L10.94 10l-3.06 3.06a.75.75 0 1 0 1.06 1.06L12 11.06l3.06 3.06a.75.75 0 1 0 1.06-1.06L13.06 10l3.06-3.06a.75.75 0 1 0-1.06-1.06L12 8.94l-3.06-3.06Z" clipRule="evenodd" /></svg>; // Using X mark for uncertainty
             return { text: 'text-yellow-700 dark:text-yellow-300', border: 'border-yellow-500', bg: 'bg-yellow-50 dark:bg-yellow-900/20', icon };
        case 'Flagged: Contradictory':
             icon = <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM8.28 7.22a.75.75 0 0 0-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 1 0 1.06 1.06L10 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L11.06 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L10 8.94 8.28 7.22Z" clipRule="evenodd" /></svg>; // Similar icon
             return { text: 'text-orange-700 dark:text-orange-300', border: 'border-orange-500', bg: 'bg-orange-50 dark:bg-orange-900/20', icon };
        case 'Unverified':
             icon = <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM9.25 7.75a.75.75 0 0 0-1.5 0v4.5a.75.75 0 0 0 1.5 0v-4.5ZM10 15a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" /></svg>; // Info icon
             return { text: 'text-gray-600 dark:text-gray-400', border: 'border-gray-400', bg: 'bg-gray-50 dark:bg-gray-700/20', icon };
        case 'Error: Verification Failed':
        case 'Error: Timelock Failed':
        case 'Error: Evaluation Failed':
        case 'Error: No Valid Answers':
        case 'Error: Polling Failed':
             icon = <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM8.28 7.22a.75.75 0 0 0-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 1 0 1.06 1.06L10 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L11.06 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L10 8.94 8.28 7.22Z" clipRule="evenodd" /></svg>; // Error icon
             return { text: 'text-red-700 dark:text-red-300', border: 'border-red-500', bg: 'bg-red-50 dark:bg-red-900/20', icon };
        case 'Processing':
        case 'Pending Verification':
        case 'Pending Answer':
        case 'Pending Evaluation':
        case 'Submitted':
             icon = <div className="h-3 w-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>; // Spinner icon
             return { text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20', icon };
        case 'System Notification':
             icon = <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM9.25 7.75a.75.75 0 0 0-1.5 0v4.5a.75.75 0 0 0 1.5 0v-4.5ZM10 15a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" /></svg>; // Info icon
             return { text: 'text-indigo-700 dark:text-indigo-300', border: 'border-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-900/20', icon };
        case 'Completed': // Generic completion
             icon = <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clipRule="evenodd" /></svg>; // Checkmark
             return { text: 'text-gray-700 dark:text-gray-300', border: 'border-gray-500', bg: 'bg-gray-100 dark:bg-gray-700/30', icon };
        default: return { text: 'text-gray-500 dark:text-gray-400', border: 'border-transparent', bg: 'bg-transparent', icon: null };
    }
}

// Formatter for Recall log entries
const formatRecallEntry = (entry: RecallLogEntryData): JSX.Element => {
    const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
    // Nicer formatting for details - display key-value pairs
    const detailsFormatted = Object.entries(entry.details)
        .map(([key, value]) => {
             let displayValue = JSON.stringify(value);
             if (displayValue.length > 60) displayValue = displayValue.substring(0, 57) + '..."'; // Truncate long values
             return <div key={key} className="ml-2"><span className="font-medium text-gray-500 dark:text-gray-400">{key}:</span> {displayValue}</div>;
        });

    return (
        <div className="mb-1 last:mb-0 border-b border-gray-200 dark:border-gray-700 pb-1 last:border-b-0">
             <span className="font-semibold text-gray-800 dark:text-gray-200">{time} [{entry.type}]</span>
             {detailsFormatted.length > 0 && <div className="ml-2 text-[10px] mt-0.5">{detailsFormatted}</div>}
        </div>
    );
}

// Helper to render links with consistent styling
const renderLink = (url: string | undefined, text: string, title?: string, type: 'filecoin' | 'timelock' | 'recall' = 'filecoin') => {
    if (!url) return null;
    const colors = {
        filecoin: 'text-blue-600 dark:text-blue-400 hover:underline',
        timelock: 'text-purple-600 dark:text-purple-400 hover:underline',
        recall: 'text-indigo-600 dark:text-indigo-400 hover:underline',
    };
    return (
        <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-block px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-600 ${colors[type]} text-[11px] font-medium mr-1 mb-1`}
            title={title}
        >
            {text}
        </a>
    );
};

// Component to render individual messages
const MessageDisplay: React.FC<MessageDisplayProps> = ({ message }) => {
    const isUser = message.sender === 'User';
    const isSystem = message.sender === 'System';
    // Use the apiResponse directly attached to the message
    const finalResult = message.verificationResult as FinalVerificationResult | null | undefined; // Cast for clarity
    const displayStatus = finalResult?.status;
    const statusStyles = getStatusStyles(displayStatus);
    const [showTrace, setShowTrace] = useState(false);
    const [showRawData, setShowRawData] = useState(false); // Toggle for raw JSON

    const filecoinGatewayBase = 'https://w3s.link/ipfs/';

    // --- Icon Components (Keep as before) ---
    const BotIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-kintask-blue"><path fillRule="evenodd" d="M15.988 3.141a.75.75 0 0 0-1.1-.14L6.56 9.091a.75.75 0 0 0-.03 1.06l4.43 4.983a.75.75 0 0 0 1.1-.14l4.938-8.87a.75.75 0 0 0-.14-1.1ZM10.5 6a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm-1.5 4.75a.75.75 0 0 0-.75.75V13h-1.5a.75.75 0 0 0 0 1.5h1.5v1.25a.75.75 0 0 0 1.5 0V14.5h1.5a.75.75 0 0 0 0-1.5h-1.5v-1.25a.75.75 0 0 0-.75-.75Z" clipRule="evenodd" /></svg>;
    const UserIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-white"><path d="M10 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.465 14.493a1.23 1.23 0 0 0 .41 1.412A9.957 9.957 0 0 0 10 18c2.31 0 4.438-.784 6.131-2.095a1.23 1.23 0 0 0 .41-1.412A9.99 9.99 0 0 0 10 12c-2.31 0-4.438.784-6.131 2.095Z" /></svg>;
    const SystemIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-indigo-500"><path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 0 1-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 0 1 .947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 0 1 2.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 0 1 2.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 0 1 .947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 0 1-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 0 1-2.287-.947ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" /></svg>;

    // Check if we have the detailed final result structure
    const hasFinalResultDetails = finalResult && displayStatus && !displayStatus.startsWith('Pending') && !displayStatus.startsWith('Processing');

    return (
        <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} mb-4 animate-fade-in group`}>
            <div className={`relative flex items-start max-w-xl w-fit px-4 py-3 rounded-lg shadow-md ${ // Use w-fit for better wrapping
                isUser
                ? 'bg-kintask-blue text-white rounded-br-none'
                : isSystem
                    ? `${statusStyles.bg} ${statusStyles.text} rounded-bl-none border ${statusStyles.borderColor} opacity-90`
                    : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-bl-none border dark:border-gray-600'
                }`}
            >
                 {/* Icon */}
                 <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mr-2.5 mt-0.5 ${isUser ? 'bg-blue-300' : isSystem ? 'bg-indigo-100 dark:bg-indigo-900/50' : 'bg-gray-100 dark:bg-gray-600'}`}>
                    {isUser ? <UserIcon /> : isSystem ? <SystemIcon /> : <BotIcon />}
                 </div>

                 {/* Content */}
                 <div className="flex-grow min-w-0"> {/* Added min-w-0 for better flex wrapping */}
                    {/* Loading Indicator */}
                    {message.isLoading && (
                        <div className="flex items-center space-x-1.5 py-1">
                            {/* Use statusStyles text color for loader */}
                            <div className={`w-1.5 h-1.5 rounded-full animate-bounce-slow [animation-delay:-0.3s] ${statusStyles.text ? statusStyles.text.split(' ')[0] : 'bg-current'}`}></div>
                            <div className={`w-1.5 h-1.5 rounded-full animate-bounce-slow [animation-delay:-0.15s] ${statusStyles.text ? statusStyles.text.split(' ')[0] : 'bg-current'}`}></div>
                            <div className={`w-1.5 h-1.5 rounded-full animate-bounce-slow ${statusStyles.text ? statusStyles.text.split(' ')[0] : 'bg-current'}`}></div>
                        </div>
                    )}

                    {/* Message Text */}
                    {!message.isLoading && (
                         <p className={`text-sm leading-relaxed whitespace-pre-wrap break-words ${isSystem ? 'italic' : ''}`}>{message.text}</p>
                    )}

                    {/* Verification Details Section (Render if finalResult exists) */}
                    {hasFinalResultDetails && finalResult && (
                        <div className={`mt-3 pt-3 border-t ${statusStyles.border} text-xs space-y-2`}>
                             {/* Status Display */}
                             <div className={`flex justify-between items-center px-2 py-1 rounded-md ${statusStyles.bg}`}>
                                <div className="flex items-center space-x-1.5">
                                    {statusStyles.icon}
                                    <span className={`font-semibold text-xs uppercase tracking-wide ${statusStyles.text}`}>{finalResult.status}</span>
                                </div>
                                {finalResult.confidence !== undefined && (
                                    <span className="ml-2 text-gray-500 dark:text-gray-400 text-xs font-medium">
                                        Confidence: {(finalResult.confidence * 100).toFixed(0)}%
                                    </span>
                                )}
                             </div>

                             {/* Explanation */}
                              {finalResult.explanation && (
                                 <p className={`text-xs italic ${statusStyles.text} ${statusStyles.bg} px-2 py-1.5 rounded border ${statusStyles.border}`}>
                                     {finalResult.explanation}
                                 </p>
                              )}

                             {/* Links Area - Render section only if there are links */}
                             {(finalResult.usedFragmentCids?.length || finalResult.timelockTxExplorerUrl || finalResult.recallExplorerUrl) && (
                                 <div className="text-gray-600 dark:text-gray-400 border-t border-dashed dark:border-gray-600 pt-2 mt-2">
                                    <span className="font-semibold text-[11px] uppercase tracking-wider block mb-1">References:</span>
                                    <div className="flex flex-wrap gap-y-1 items-center">
                                        {/* Filecoin Evidence Links */}
                                        {finalResult.usedFragmentCids?.map((cid, index) =>
                                            renderLink(`${filecoinGatewayBase}${cid}`, `Evidence ${index + 1}`, `View Fragment on Filecoin/IPFS (CID: ${cid})`, 'filecoin')
                                        )}
                                        {/* Timelock Commitment Link */}
                                        {renderLink(finalResult.timelockTxExplorerUrl, 'Timelock Tx', `View Timelock Tx on L2 (Req ID: ${finalResult.timelockRequestId ?? 'N/A'})`, 'timelock')}
                                        {/* Recall Explorer Link */}
                                        {renderLink(finalResult.recallExplorerUrl, 'Recall Trace', `View Full Trace on Recall Explorer`, 'recall')}
                                    </div>
                                 </div>
                             )}

                             {/* Recall Trace Toggle & Display */}
                             {finalResult.recallTrace && finalResult.recallTrace.length > 0 && (
                                 <div className="mt-2 border-t border-dashed dark:border-gray-600 pt-2">
                                     <button
                                         onClick={() => setShowTrace(!showTrace)}
                                         className="text-indigo-600 dark:text-indigo-400 hover:underline text-xs font-medium mb-1 focus:outline-none flex items-center"
                                         aria-expanded={showTrace}
                                     >
                                         {showTrace ? (
                                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 mr-1"><path fillRule="evenodd" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" /></svg>
                                         ) : (
                                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 mr-1"><path fillRule="evenodd" d="M7.28 5.78a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 1 1-1.06 1.06L8 7.06l-2.72 2.72a.75.75 0 0 1-1.06-1.06l3.25-3.25Z" clipRule="evenodd" /></svg>
                                         )}
                                         Reasoning Trace ({finalResult.recallTrace.length} steps)
                                     </button>
                                     {showTrace && (
                                         <div className="mt-1 p-2 border dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 rounded max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-400 dark:scrollbar-thumb-gray-600 text-gray-700 dark:text-gray-300 text-[10px] font-mono leading-snug space-y-1">
                                             {finalResult.recallTrace.map((entry, index) => (
                                                 formatRecallEntry(entry) // Use the formatter component/function
                                             ))}
                                         </div>
                                     )}
                                 </div>
                             )}

                             {/* Raw Data Toggle (Optional Debug) */}
                              <div className="mt-2 border-t border-dashed dark:border-gray-600 pt-2">
                                 <button
                                     onClick={() => setShowRawData(!showRawData)}
                                     className="text-gray-500 dark:text-gray-400 hover:underline text-[10px] font-medium focus:outline-none"
                                     aria-expanded={showRawData}
                                 >
                                     {showRawData ? 'Hide Raw Data' : 'Show Raw Data'}
                                 </button>
                                 {showRawData && (
                                     <pre className="mt-1 p-1 border dark:border-gray-600 bg-gray-100 dark:bg-gray-900/50 rounded max-h-40 overflow-y-auto scrollbar-thin text-[9px] font-mono">
                                         <code>{JSON.stringify(finalResult, null, 2)}</code>
                                     </pre>
                                 )}
                             </div>

                             {/* Display API Error if present on the result */}
                             {finalResult.error && (
                                 <p className={`mt-2 text-red-600 dark:text-red-400 text-xs border-t pt-1 ${statusStyles.border}`}>
                                     <span className="font-semibold">Error Note:</span> {finalResult.error}{finalResult.details ? ` (${finalResult.details})` : ''}
                                 </p>
                             )}
                        </div>
                    )}
                 </div> {/* End Content */}
            </div>
        </div>
      );
    };

    export default MessageDisplay;