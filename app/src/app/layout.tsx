import type { Metadata } from "next";
import { FeedProvider } from "@/components/FeedProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sahasra — the final path to the Oneness",
  description: "Real-time crypto news terminal",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-900 text-slate-200 antialiased font-mono">
        <FeedProvider>{children}</FeedProvider>
      </body>
    </html>
  );
}