import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import './app.css';
import { getAppQueryClient } from '@/lib/api/query-client';
import { setUrlStateRouter } from '@/lib/navigation/url-state';

import { appRoutes } from './router';

const queryClient = getAppQueryClient();
const router = createBrowserRouter(appRoutes);
// URL-owned filter state writes through the router rather than around it, so
// `useLocation`/`useSearchParams` cannot go stale behind a filter change.
setUrlStateRouter(router);
const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Vite application root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
