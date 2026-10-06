import type { Metadata, Viewport } from 'next';
import { Toaster } from '@repo/ui';
import './globals.css';

export const metadata: Metadata = {
  title: 'Club de fidelizacion',
  description: 'Suma visitas y gana premios en tus locales favoritos',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Club' },
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
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
