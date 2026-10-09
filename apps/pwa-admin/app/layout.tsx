import type { Metadata, Viewport } from 'next';
import { Toaster } from '@repo/ui';
import './globals.css';

const COLOR_PRIMARIO_DEFECTO = 'hsl(0 84.2% 60.2%)';

export const metadata: Metadata = {
  title: 'Admin',
  description: 'Panel del dueno: carta, personal, sucursales y configuracion',
  manifest: '/manifest.json',
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Admin' },
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
        {children}
        <Toaster />
      </body>
    </html>
  );
}
