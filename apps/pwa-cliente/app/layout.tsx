import type { Metadata, Viewport } from 'next';
import { Anton, DM_Sans } from 'next/font/google';
import { Toaster } from '@repo/ui';
import { COLOR_PRIMARIO_DEFECTO } from '@/lib/constants';
import './globals.css';

/**
 * Fuentes expuestas como CSS vars (--font-display / --font-body).
 *
 * El diseno personalizado de la tarjeta (theme del negocio) usa `--font-display`
 * para el nombre del local y `--font-body` para el texto. Al vivir en variables,
 * el theme NO depende de clases de Tailwind y cualquier app puede reusarlas.
 * `display: 'swap'` evita el texto invisible mientras baja la fuente.
 */
const anton = Anton({ subsets: ['latin'], weight: '400', variable: '--font-display', display: 'swap' });
const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-body', display: 'swap' });

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
    <html lang="es-AR" className={`${anton.variable} ${dmSans.variable}`}>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
