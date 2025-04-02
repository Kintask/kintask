import React, { useState, useRef, useEffect } from 'react';
import MessageDisplay from './MessageDisplay';
import { ChatMessage } from '@/types'; // Use path alias

interface ChatInterfaceProps {
  messages: ChatMessage[];
  onSendMessage: (message: string) => void;
  isLoading: boolean; // True if AI is processing the LAST message
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ messages, onSendMessage, isLoading }) => {
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null); // Ref to scroll target
  const messageListRef = useRef<HTMLDivElement>(null); // Ref to message container
  const inputRef = useRef<HTMLInputElement>(null); // Ref for input field

  // --- Event Handlers ---
  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(event.target.value);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedInput = inputValue.trim();
    if (!trimmedInput || isLoading) return;
    onSendMessage(trimmedInput);
    setInputValue(''); // Clear input after sending
  };

  // --- Effects ---
  // Scroll to bottom when new messages arrive or loading state changes
  useEffect(() => {
     // Use requestAnimationFrame for smoother scroll after render
     requestAnimationFrame(() => {
         messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
     });
  }, [messages, isLoading]); // Trigger on messages or loading change

   // Focus input when loading stops (or initially)
   useEffect(() => {
       if (!isLoading) {
           inputRef.current?.focus();
       }
   }, [isLoading]);


  return (
    // Use h-full and flex column to make it occupy container height
    <div className="flex flex-col h-full bg-white dark:bg-gray-800 shadow-xl rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">

      {/* Message List Area */}
      {/* Apply flex-grow to take up available space, min-h-0 to prevent overflow issues, overflow-y-auto for scroll */}
      <div
         ref={messageListRef}
         className="flex-grow p-4 space-y-3 overflow-y-auto min-h-0 scrollbar" // Added scrollbar class
      >
        {messages.map((msg) => (
          <MessageDisplay key={msg.id} message={msg} />
        ))}
        {/* Dummy div at the end to ensure scrolling brings last message fully into view */}
        <div ref={messagesEndRef} className="h-0" />
      </div>

      {/* Input Area */}
      {/* Use shrink-0 to prevent input area from shrinking */}
      <div className="shrink-0 border-t border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-800/50">
        <form onSubmit={handleSubmit} className="flex items-center space-x-2">
          <input
            ref={inputRef} // Assign ref
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            placeholder={isLoading ? "Kintask is verifying..." : "Ask Kintask anything..."}
            className="flex-grow px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-full focus:outline-none focus:ring-2 focus:ring-kintask-blue dark:focus:ring-kintask-blue-dark dark:bg-gray-700 dark:text-gray-100 disabled:opacity-60 placeholder-gray-400 dark:placeholder-gray-500 transition-colors duration-200"
            disabled={isLoading}
            aria-label="Ask Kintask a question"
          />
          <button
            type="submit"
            className={`flex-shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-full text-white font-semibold focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-100 dark:focus:ring-offset-gray-800 transition-colors duration-200 ${
              isLoading || !inputValue.trim()
                ? 'bg-gray-400 cursor-not-allowed dark:bg-gray-600'
                : 'bg-kintask-blue hover:bg-kintask-blue-dark focus:ring-blue-500'
            }`}
            disabled={isLoading || !inputValue.trim()}
            aria-busy={isLoading}
            aria-label={isLoading ? "Sending..." : "Send message"}
          >
            {/* Send Icon (SVG Example) */}
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path d="M3.105 3.105a.75.75 0 0 1 .814-.102l14.002 6.999a.75.75 0 0 1 0 1.395l-14.002 7.001a.75.75 0 0 1-1.01-.605v-4.341a.75.75 0 0 1 .3-.568l6.34-3.171a.75.75 0 0 0 0-1.316l-6.34-3.172a.75.75 0 0 1-.3-.567V3.707a.75.75 0 0 1 .205-.502Z" />
            </svg>
            <span className="sr-only">{isLoading ? "Sending..." : "Send message"}</span>
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChatInterface;
