import React from 'react';
import { ChatMessage } from '../types'; // Adjust path as necessary
import VerificationDetails from './VerificationDetails'; // Adjust path as necessary

interface MessageBubbleProps {
    message: ChatMessage;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
    const isUser = message.sender === 'User';
    const isAI = message.sender === 'AI';
    const isSystem = message.sender === 'System';

    const bubbleClasses = `max-w-xs sm:max-w-sm md:max-w-md lg:max-w-lg xl:max-w-2xl px-4 py-3 rounded-2xl shadow-md break-words relative ${
        isUser
            ? 'bg-kintask-blue text-white ml-auto rounded-br-none' // Tail pointing left for user
            : isAI
            ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 mr-auto rounded-bl-none' // Tail pointing right for AI
            : 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 mx-auto text-center text-sm italic my-2 border border-yellow-300 dark:border-yellow-700' // System message styling
    }`;

    const renderContent = () => {
        if (isAI && message.isLoading) {
            return (
                <div className="flex items-center justify-center space-x-1.5 h-5">
                    <div className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
                    <div className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                </div>
            );
        }
        // Render message text using whitespace-pre-wrap to respect newlines and tabs
        // Handle potential long words with break-words (already in bubbleClasses)
        return <p className="whitespace-pre-wrap">{message.text}</p>;
    };

    return (
        <div className={`flex ${isUser ? 'justify-end' : isSystem ? 'justify-center px-4' : 'justify-start'}`}>
            <div className={bubbleClasses}>
                {renderContent()}
                {/* Render Verification Details only for non-loading AI messages with apiResponse */}
                {isAI && !message.isLoading && message.apiResponse && (
                    <VerificationDetails response={message.apiResponse} />
                )}
            </div>
        </div>
    );
};

export default MessageBubble;

// /src/components/MessageBubble.tsx