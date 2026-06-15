import './globals.css';

export const metadata = {
  title: 'Solana Copy Trading Dashboard',
  description: 'Simulate, backtest, and monitor Solana wallet copy-trading in real-time.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="antialiased">
        {children}
      </body>
    </html>
  );
}
