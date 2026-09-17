import { createRoot } from 'react-dom/client';

import App from './App';
import PhotorealisticTilesExperiment from './experiment/PhotorealisticTilesExperiment';

import './index.css';

const isPhotorealisticTilesExperiment =
  window.location.pathname.endsWith('/experiment');

createRoot(document.getElementById('root')!).render(
  isPhotorealisticTilesExperiment ? (
    <PhotorealisticTilesExperiment />
  ) : (
    <App />
  ),
);
