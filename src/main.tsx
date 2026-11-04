import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installHostBridge } from './core/host';
import './styles/global.css';

// 必須在 App 掛載前完成：接上原生 HTTP 出口，讓 adapter 不受 CORS 限制。
// 在瀏覽器開發時會回傳 false，transport 維持 fetch。
installHostBridge();

// Desktop utility chrome must stay at a fixed scale. Drawing zoom is handled
// independently inside DrawingCanvas, so browser/WebView zoom is always blocked.
const blockApplicationZoom = (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && ['+', '-', '=', '0'].includes(event.key)) event.preventDefault();
};
const blockApplicationWheelZoom = (event: WheelEvent) => {
  if (event.ctrlKey || event.metaKey) event.preventDefault();
};
window.addEventListener('keydown', blockApplicationZoom, { passive: false });
window.addEventListener('wheel', blockApplicationWheelZoom, { passive: false });

const host = document.getElementById('root');
if (!host) throw new Error('#root 節點不存在，index.html 可能已損壞');

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
