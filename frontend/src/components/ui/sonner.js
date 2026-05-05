import { Toaster as SonnerToaster } from 'sonner';

export const Toaster = () => (
  <SonnerToaster
    position="bottom-right"
    theme="dark"
    toastOptions={{
      style: {
        background: '#0f1115',
        border: '1px solid rgba(255,255,255,0.1)',
        color: '#e5e7eb',
      },
    }}
  />
);
