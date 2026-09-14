import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { installErrorReporter } from './net/errorReporter';
import { isNative } from './native';

installErrorReporter();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// The offline shell is a browser-only concern. Inside the native shell the app
// is already installed on the device, and a service worker there would cache
// the bundle against the webview's own origin -- which means a bad cache ships
// stale JS to a user with no "clear site data" button to escape it. Register it
// on web only, and actively tear down any worker a previous build left behind.
if ('serviceWorker' in navigator) {
  if (isNative()) {
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => regs.forEach((reg) => reg.unregister()))
      .catch(() => {});
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // offline shell is a nice-to-have; a failed registration should not block the app
      });
    });
  }
}
