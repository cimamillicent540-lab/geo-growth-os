import './globals.css';
import { AppNav } from '@/app/components/AuthGate';

export const metadata = { title: 'GEO Growth OS', description: 'AI Search Visibility Growth System' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main className="shell">
          <AppNav />
          {children}
        </main>
      </body>
    </html>
  );
}
