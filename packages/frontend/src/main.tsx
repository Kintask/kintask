import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App.tsx'; // Your main app component
import HomePage from './pages/HomePage.tsx'; // The homepage component from the previous response
import './index.css'; // Import Tailwind CSS

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Failed to find the root element with ID "root"');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/app" element={<App />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);