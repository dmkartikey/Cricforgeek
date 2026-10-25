import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App';
import { SettingsProvider } from './lib/settings';
import { PREVIEW } from './lib/data';
import './styles.css';

// Refuse to run inside someone else's frame (clickjacking). Headers can't be set on GitHub Pages, so this is the fallback.
if (!PREVIEW && window.top !== window.self) {
  try { window.top!.location.replace(window.self.location.href); } catch { document.documentElement.style.display = 'none'; }
}

// Old links used #/path. Move them to the real path so shared and bookmarked links keep working.
if (!PREVIEW && location.hash.startsWith('#/')) {
  history.replaceState(null, '', location.hash.slice(1) || '/');
}

const Router = PREVIEW ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router>
      <SettingsProvider>
        <App />
      </SettingsProvider>
    </Router>
  </React.StrictMode>,
);
