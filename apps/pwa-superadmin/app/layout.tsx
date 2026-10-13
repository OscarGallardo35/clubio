import type { Metadata, Viewport } from 'next';
import { Toaster } from '@repo/ui';
import './globals.css';

const COLOR_PRIMARIO_DEFECTO = 'hsl(0 84.2% 60.2%)';

export const metadata: Metadata = {
  title: 'Operador',
  description: 'Panel del operador de la plataforma: locales y demos',
  manifest: '/manifest.json',
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Operador' },
};

export const viewport: Viewport = {
  themeColor: COLOR_PRIMARIO_DEFECTO,
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

/**
 * Root layout del panel de plataforma.
 *
 * Sin `RegistroServiceWorker` a proposito: esta fase no usa push (no hay nada que
 * notificar al operador). Tampoco hay `BannerInstalacion`: el panel se usa en
 * computadora, sobre todo para armar los locales demo.
 */
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
