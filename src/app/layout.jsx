import './globals.css';

export const metadata = {
  title: 'SkipIt — AI Interview Platform',
  description: 'Automated AI interview platform',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
