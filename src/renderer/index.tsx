import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/global.css';
import { installErrorHandlers } from './errors/reportError';

installErrorHandlers();

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
