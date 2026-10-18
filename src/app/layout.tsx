import type { Metadata } from 'next';
import '../styles/tokens.css';

export const metadata: Metadata = {
  title: 'Match Microscope',
  description: 'Google Maps for football. Scrub through a synthetic match. See pressure, passing lanes, space, and danger.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="font.css" />
        <link rel="preload" href="fonts/anton-latin-400.woff2" as="font" type="font/woff2" crossOrigin="" />
      </head>
      <body>{children}</body>
    </html>
  );
}
