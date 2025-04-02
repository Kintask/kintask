import React, { useState, useCallback, useEffect } from 'react';
import ChatInterface from '@/components/ChatInterface'; // Use path alias
import { sendMessage } from '@/services/apiService'; // Use path alias
import { ChatMessage, ApiVerifyResponse } from '@/types'; // Use path alias

function App() {
  const welcomeMessageText = "Welcome to Kintask! Ask me anything, and I'll attempt to provide a verifiable answer based on decentralized knowledge sources.";
  const initialMessage: ChatMessage = {
    id: Date.now(),
    sender: 'AI',
    text: welcomeMessageText,
    // Provide a default structure for apiResponse even for welcome message
    apiResponse: {
        answer: welcomeMessageText,
        status: 'Unverified', // Initial status
    },
  };

  const [messages, setMessages] = useState<ChatMessage[]>([initialMessage]);
  const [isProcessing, setIsProcessing] = useState(false); // More descriptive name

  // Function to add a new message and update state
  const addMessage = (message: ChatMessage) => {
      setMessages(prev => [...prev, message]);
  }

  // Function to update a message (specifically the loading AI message)
  const updateAiMessage = (id: number, responseData: ApiVerifyResponse) => {
       setMessages(prev => prev.map(msg =>
           msg.id === id
             ? { // Create a new object for the AI response
                 ...msg, // Keep id, sender
                 text: responseData.answer, // Use answer from response
                 isLoading: false,
                 apiResponse: responseData, // Store the entire API response
             }
             : msg
       ));
  }

  // Handle sending a message
  const handleSendMessage = useCallback(async (question: string) => {
    if (!question.trim() || isProcessing) return;

    const userTimestamp = Date.now();
    const newUserMessage: ChatMessage = {
      id: userTimestamp,
      sender: 'User',
      text: question,
    };
    addMessage(newUserMessage); // Add user message immediately

    const aiLoadingTimestamp = userTimestamp + 1;
    const loadingAiMessage: ChatMessage = {
        id: aiLoadingTimestamp,
        sender: 'AI',
        text: '', // Empty text while loading
        isLoading: true,
        // Initial apiResponse while loading (optional)
        apiResponse: { answer: '', status: 'Unverified' }
    }
    addMessage(loadingAiMessage); // Add loading placeholder

    setIsProcessing(true); // Set loading state

    try {
      // Call the API service
      const responseData = await sendMessage(question);
      // Update the placeholder AI message with the actual response/error
      updateAiMessage(loadingAiMessage.id, responseData);

    } catch (err: any) {
      // This catch block might be redundant if apiService always returns a structured error
      // But keep it for truly unexpected frontend errors during the process
      console.error("[App] Critical Error during sendMessage flow:", err);
      const errorResponse: ApiVerifyResponse = {
          answer: `A critical frontend error occurred processing the request.`,
          status: 'Error: Verification Failed',
          error: 'Frontend Exception',
          details: err.message || String(err),
      };
       updateAiMessage(loadingAiMessage.id, errorResponse);
    } finally {
      setIsProcessing(false); // Clear loading state regardless of success/error
    }
  }, [isProcessing]); // Dependency: isProcessing prevents concurrent requests

  // Optional: Add a simple dark mode toggle example
  // const [darkMode, setDarkMode] = useState(window.matchMedia('(prefers-color-scheme: dark)').matches);
  // useEffect(() => {
  //     if (darkMode) {
  //         document.documentElement.classList.add('dark');
  //     } else {
  //         document.documentElement.classList.remove('dark');
  //     }
  // }, [darkMode]);

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto p-4 md:p-6 bg-gray-100 dark:bg-gray-900">
        <header className="mb-4 text-center shrink-0">
             {/* Optional: Add Logo component */}
            {/* <img src="/kintask-logo.svg" alt="Kintask Logo" className="h-10 w-auto mx-auto mb-1" /> */}
            <h1 className="text-3xl md:text-4xl font-bold text-kintask-blue dark:text-kintask-blue-light tracking-tight">
                {import.meta.env.VITE_APP_TITLE || 'Kintask'}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Verifiable AI Q&A with Decentralized Trust
            </p>
             {/* Dark Mode Toggle Example */}
             {/* <button onClick={() => setDarkMode(!darkMode)} className="absolute top-4 right-4 p-2 rounded bg-gray-200 dark:bg-gray-700">
                 {darkMode ? 'Light' : 'Dark'}
             </button> */}
        </header>

        {/* Chat Interface takes remaining height */}
        <div className="flex-grow min-h-0">
             <ChatInterface
                messages={messages}
                onSendMessage={handleSendMessage}
                isLoading={isProcessing} // Pass processing state
            />
        </div>

        <footer className="mt-4 text-center text-xs text-gray-400 dark:text-gray-500 shrink-0">
            Encode Club AI Blueprints Hackathon | Filecoin, Recall, Blocklock Demo
        </footer>
    </div>
  );
}

export default App;
