// Loading Modal Component (add to src/components/LoadingModal.tsx)
import React from 'react';

interface LoadingModalProps {
  message: string;
  subMessage?: string;
  contextId?: string;
  isVisible: boolean;
}

const LoadingModal: React.FC<LoadingModalProps> = ({ message, subMessage, contextId, isVisible }) => {
  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 dark:bg-opacity-75 flex justify-center items-center p-4 z-50 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 md:p-6 max-w-md w-full text-center">
        <div className="flex flex-col items-center justify-center space-y-4">
          {/* Spinner */}
          <div className="w-16 h-16 border-4 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
          
          {/* Main Message */}
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{message}</h3>
          
          {/* Sub Message */}
          {subMessage && (
            <p className="text-sm text-gray-600 dark:text-gray-300">{subMessage}</p>
          )}
          
          {/* Context ID if available */}
          {contextId && (
            <div className="text-xs font-mono text-gray-500 dark:text-gray-400 mt-2">
              Request ID: {contextId.substring(4, 10)}...
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LoadingModal;