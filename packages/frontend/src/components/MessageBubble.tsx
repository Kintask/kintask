// Example modification in kintask/packages/frontend/src/components/MessageBubble.tsx

import React from 'react';
import { ChatMessage } from '@/types';
// ... other imports if needed

interface MessageBubbleProps {
  message: ChatMessage;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isUser = message.sender === 'User';
  const isSystem = message.sender === 'System';
  const apiData = message.apiResponse; // Contains status, details etc.

  // --- FIX: Conditionally render loading spinner ---
  if (message.isLoading) {
    return (
      <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3 animate-fade-in`}>
        <div className={`max-w-xs lg:max-w-md px-4 py-3 rounded-lg shadow ${
            isUser ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
          }`}
        >
           <div className="flex items-center justify-center space-x-1.5">
              <div className={`w-1.5 h-1.5 rounded-full animate-bounce-slow [animation-delay:-0.3s] ${isUser ? 'bg-white/70' : 'bg-gray-500/70'}`}></div>
              <div className={`w-1.5 h-1.5 rounded-full animate-bounce-slow [animation-delay:-0.15s] ${isUser ? 'bg-white/70' : 'bg-gray-500/70'}`}></div>
              <div className={`w-1.5 h-1.5 rounded-full animate-bounce-slow ${isUser ? 'bg-white/70' : 'bg-gray-500/70'}`}></div>
           </div>
        </div>
      </div>
    );
  }
  // --- End Loading Spinner ---

  // --- Render normal message if not loading ---
  // ... (Existing rendering logic for User, System, and final AI messages) ...
  // ... (Make sure to use apiData for status, confidence, links etc.) ...
  return (
      <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} mb-3 animate-fade-in`}>
         {/* ... (Optional sender display) ... */}
         <div className={`relative max-w-xl px-4 py-3 rounded-lg shadow-md ${
              isUser ? 'bg-blue-600 text-white rounded-br-none' :
              (isSystem ? 'bg-gray-100 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 text-xs italic border dark:border-gray-600' :
              'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-bl-none border dark:border-gray-600')
            }`}
          >
            {/* Message Text */}
            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{message.text}</p>

            {/* Verification Details for final AI messages */}
            {!isUser && !isSystem && apiData && apiData.status !== 'Processing' && apiData.status !== 'Pending Verification' && (
                <div className={`mt-3 pt-2 border-t text-xs ${getStatusStyles(apiData.status).borderColor}`}>
                     {/* ... Status, Confidence, Links, Trace Button ... */}
                 </div>
            )}
             {/* Display pending status text if needed */}
             {!isUser && apiData?.status === 'Pending Verification' && (
                 <p className="text-xs italic text-gray-500 dark:text-gray-400 mt-1">(Polling for final verification...)</p>
             )}

          </div>
      </div>
  );
};

// Add getStatusStyles helper function if not already present
const getStatusStyles = (status?: string): {textColor: string, borderColor: string, bgColor: string } => { /* ... as defined before ... */ };


export default MessageBubble;