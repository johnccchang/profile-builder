import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
    title: 'Travel Profile Builder',
    description: 'Chat about your travel style and watch your profile build itself.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
