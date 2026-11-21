import '@/lib/zod-jitless';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import './app.css';
import { getAppQueryClient } from '@/lib/api/query-client';
import { installClientErrorListeners } from '@/lib/client-errors';
import { installInteractionTiming } from '@/lib/interaction-timing';
import { setUrlStateRouter } from '@/lib/navigation/url-state';
import { installTrustedTypesPolicy } from '@/lib/trusted-types';

import { appRoutes } from './router';

function mountApp(): void {
  // Before anything renders, so an error during the first paint is reported too.
  installClientErrorListeners();
  installTrustedTypesPolicy();
  installInteractionTiming();
  const queryClient = getAppQueryClient();
  const router = createBrowserRouter(appRoutes);
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
}

if (document.documentElement.dataset.browserSupport !== 'unsupported') mountApp();
