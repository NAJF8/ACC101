import { createRoot } from 'react-dom/client';
import { App } from './src/App.jsx';
createRoot(document.getElementById('root')).render(<App />);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((reg) => {
      reg.update().catch(() => {});
    }).catch((error) => {
      console.warn('PWA_SERVICE_WORKER_REGISTRATION_FAILED', error);
    });
  });
}
