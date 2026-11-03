import './App.css';
import { AppRouter } from './router';

export default function App() {
  // All chrome lives in AppShell, which only signed-in routes render.
  return <AppRouter />;
}
