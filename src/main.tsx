import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { reloadOnce } from './chunkReload';
import { SettingsProvider } from './store/settings';
import './index.css';

// Yeni sürüm yayınlandıktan sonra eski sekmede bir mod parçası bulunamazsa sayfayı (bir kez) yenile.
window.addEventListener('vite:preloadError', (e) => {
  if (reloadOnce()) e.preventDefault();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </StrictMode>,
);
