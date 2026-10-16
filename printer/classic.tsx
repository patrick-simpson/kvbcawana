import React from 'react';
import ReactDOM from 'react-dom/client';
import ClassicApp from './components/classic/ClassicApp';
import './styles/classic.css';

// The old home page, unlisted at /classic (owner, 2026-10-16).
const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Could not find root element to mount to');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ClassicApp />
  </React.StrictMode>
);
