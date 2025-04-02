/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}", // Ensure TS/TSX files are included
  ],
  darkMode: 'media', // Or 'class' if using manual toggle
  theme: {
    extend: {
        colors: {
            // Brand colors
            'kintask-blue': {
                light: '#60a5fa', // blue-400
                DEFAULT: '#2563eb', // blue-600
                dark: '#1d4ed8', // blue-700
            },
            // Status colors (consider refining based on usage)
            'status-verified': {
               text: 'text-green-700 dark:text-green-300',
               border: 'border-green-500 dark:border-green-600',
               bg: 'bg-green-100 dark:bg-green-900/40'
            },
            'status-uncertain': {
               text: 'text-yellow-700 dark:text-yellow-300',
               border: 'border-yellow-500 dark:border-yellow-600',
               bg: 'bg-yellow-100 dark:bg-yellow-900/40'
            },
            'status-contradictory': {
               text: 'text-orange-700 dark:text-orange-400', // Adjusted dark text
               border: 'border-orange-500 dark:border-orange-600',
               bg: 'bg-orange-100 dark:bg-orange-900/40'
            },
            'status-unverified': {
               text: 'text-gray-600 dark:text-gray-400',
               border: 'border-gray-400 dark:border-gray-500',
               bg: 'bg-gray-100 dark:bg-gray-700/40'
            },
            'status-error': {
               text: 'text-red-700 dark:text-red-400', // Adjusted dark text
               border: 'border-red-500 dark:border-red-600',
               bg: 'bg-red-100 dark:bg-red-900/40'
            },
        },
        animation: {
            'fade-in': 'fadeIn 0.4s ease-out forwards',
            'bounce-slow': 'bounce 1.5s infinite ease-in-out', // Slightly slower bounce
            'pulse-fast': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        },
        keyframes: {
            fadeIn: {
                '0%': { opacity: '0', transform: 'translateY(4px)' },
                '100%': { opacity: '1', transform: 'translateY(0)' },
            },
            // Bounce keyframes are built-in
            // Pulse keyframes are built-in
        },
        fontFamily: {
             sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', '"Noto Sans"', 'sans-serif', '"Apple Color Emoji"', '"Segoe UI Emoji"', '"Segoe UI Symbol"', '"Noto Color Emoji"'],
             mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', '"Liberation Mono"', '"Courier New"', 'monospace'],
        }
    },
  },
   plugins: [
     require('@tailwindcss/forms'), // Optional: better default form styles
     require('tailwind-scrollbar')({ nocompatible: true }), // For custom scrollbars
   ],
}
