import React, { useState } from 'react';
import { ApiVerifyResponse, VerificationStatus } from '../types'; // Adjust path as necessary

interface VerificationDetailsProps {
    response: ApiVerifyResponse;
}

const VerificationDetails: React.FC<VerificationDetailsProps> = ({ response }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    // Determine status color based on VerificationStatus type
    const getStatusColor = (status: VerificationStatus = 'Unverified'): string => {
        status = status.toLowerCase() as VerificationStatus; // Ensure lowercase for matching
        if (status.includes('verified')) return 'text-green-600 dark:text-green-400';
        if (status.includes('failed') || status.includes('error')) return 'text-red-600 dark:text-red-400';
        if (status.includes('pending')) return 'text-yellow-600 dark:text-yellow-400';
        if (status === 'unverified') return 'text-gray-500 dark:text-gray-400';
        // Add more specific status mappings if needed
        return 'text-gray-500 dark:text-gray-400'; // Default/fallback
    };

    const statusColor = getStatusColor(response.status);

    // Check if there are any details worth showing (beyond just the answer and basic status)
    const hasExtraDetails = !!(
        response.cid ||
        (response.sources && response.sources.length > 0) ||
        response.details ||
        response.error ||
        response.confidence !== undefined || // Check for presence, even if 0
        (response.usedFragmentCids && response.usedFragmentCids.length > 0) ||
        (response.recallTrace && response.recallTrace.length > 0)
    );

    // Conditions to *not* render the details section at all
    const isSystemNotification = response.status === 'System Notification';
    const isWelcomePlaceholder = response.answer?.startsWith("Welcome to Kintask!") && response.status === 'Unverified';
    // Only render if it's not a system message, not the welcome placeholder,
    // AND either the status is informative OR there are extra details to show.
    const shouldRender = !isSystemNotification && !isWelcomePlaceholder && (response.status !== 'Unverified' || hasExtraDetails);


    if (!shouldRender) {
        return null;
    }


    return (
        <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-600 text-xs text-gray-600 dark:text-gray-400">
            <div className="flex justify-between items-center">
                <span className={`font-semibold ${statusColor}`}>
                    {response.status || 'Status N/A'}
                </span>
                {/* Show toggle only if there are extra details */}
                {hasExtraDetails && (
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="text-kintask-blue dark:text-kintask-blue-light hover:underline focus:outline-none text-xs font-medium"
                        aria-expanded={isExpanded}
                    >
                        {isExpanded ? 'Hide Details' : 'Show Details'}
                    </button>
                )}
            </div>
            {isExpanded && hasExtraDetails && (
                <div className="mt-2 space-y-1.5 animation-expand">
                    {/* Confidence Score */}
                    {response.confidence !== undefined && response.confidence !== null && (
                         <p>
                            <strong>Confidence:</strong>{' '}
                             <span className={`font-medium ${getStatusColor('verified')}`}>{ (response.confidence * 100).toFixed(1) }%</span>
                        </p>
                    )}

                    {/* Verification CID */}
                    {response.cid && (
                        <p>
                            <strong>Proof CID:</strong>{' '}
                            <a
                                // Use a reliable public gateway or configure one
                                href={`https://ipfs.io/ipfs/${response.cid}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 dark:text-blue-400 hover:underline break-all"
                                title={`View verification data for ${response.cid} on IPFS`}
                            >
                                {response.cid.substring(0, 10)}...{response.cid.substring(response.cid.length - 6)}
                            </a>
                        </p>
                    )}

                    {/* Used Recall Fragment CIDs */}
                    {response.usedFragmentCids && response.usedFragmentCids.length > 0 && (
                         <div>
                            <strong>Used Recall Fragments:</strong>
                             <ul className="list-none pl-2 space-y-0.5">
                                {response.usedFragmentCids.map((cid, index) => (
                                    <li key={index} className="truncate font-mono text-xs" title={cid}>
                                        <span>{cid.substring(0,10)}...{cid.substring(cid.length - 6)}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                     {/* Sources */}
                     {response.sources && response.sources.length > 0 && (
                          <div>
                             <strong>Sources:</strong>
                              <ul className="list-disc list-inside pl-2 space-y-0.5">
                                 {response.sources.map((source, index) => (
                                     <li key={index} className="truncate" title={source}>
                                          {/* Basic URL detection for linking */}
                                          { (source.startsWith('http://') || source.startsWith('https://')) ? (
                                             <a href={source} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline break-all">{source}</a>
                                          ) : (
                                             <span className="break-all">{source}</span>
                                          )}
                                     </li>
                                 ))}
                             </ul>
                         </div>
                     )}

                    {/* General Details */}
                     {response.details && (
                        <p><strong>Details:</strong> <span className="whitespace-pre-wrap">{response.details}</span></p>
                    )}

                    {/* Error Message */}
                    {response.error && (
                        <p className={getStatusColor('Error: Verification Failed')}> {/* Use error color */}
                            <strong>Error:</strong> <span className="whitespace-pre-wrap">{response.error}</span>
                        </p>
                    )}

                     {/* Recall Trace (Basic JSON Display) */}
                     {response.recallTrace && response.recallTrace.length > 0 && (
                          <div>
                            <strong>Recall Trace:</strong>
                             <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-x-auto max-h-40 scrollbar-thin">
                                {JSON.stringify(response.recallTrace, null, 2)}
                             </pre>
                        </div>
                    )}

                </div>
            )}
             {/* Add basic CSS for expansion animation if desired */}
             <style>{`
                .animation-expand {
                    overflow: hidden;
                    max-height: 500px; /* Adjust as needed */
                    transition: max-height 0.3s ease-in-out;
                }
                [aria-expanded="false"] + .animation-expand {
                    max-height: 0;
                }
             `}</style>
        </div>
    );
};

export default VerificationDetails;

// /src/components/VerificationDetails.tsx