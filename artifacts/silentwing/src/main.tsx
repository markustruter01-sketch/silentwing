import { createRoot } from 'react-dom/client';

import App from './App';
import { mark } from './lib/perfProbe';

import './index.css';

mark('boot');
createRoot(document.getElementById('root')!).render(<App />);
