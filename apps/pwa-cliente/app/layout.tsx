import type { Metadata, Viewport } from 'next';
import { Toaster } from '@repo/ui';
import { COLOR_PRIMARIO_DEFECTO } from '@/lib/constants';
import './globals.css';

export const metadata: Metadata = {
  title: 'Club de fidelizacion',
  description: 'Suma visitas y gana premios en tus locales favoritos',
  manifest: '/manifest.json',
  // black-translucent: en iOS el status bar se superpone al contenido y combina
  // con el degradado de la marca (el theme-color lo actualiza BrandingProvider).
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Club' },
};

export const viewport: Viewport = {
  // Placeholder: BrandingProvider lo pisa con el color del negocio.
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
