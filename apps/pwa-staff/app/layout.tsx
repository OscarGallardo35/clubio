import type { Metadata, Viewport } from 'next';
import { Toaster } from '@repo/ui';
import { RegistroServiceWorker } from '@/components/RegistroServiceWorker';
import './globals.css';

const COLOR_PRIMARIO_DEFECTO = 'hsl(0 84.2% 60.2%)';

export const metadata: Metadata = {
  title: 'Staff',
  description: 'Turnos, visitas y pedidos del local',
  manifest: '/manifest.json',
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Staff' },
};

export const viewport: Viewport = {
  themeColor: COLOR_PRIMARIO_DEFECTO,
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR">
      <body className="min-h-dvh bg-background text-foreground antialiased">
        {/* Registra /sw.js: sin SW no existe pushManager.subscribe(). */}
        <RegistroServiceWorker />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
