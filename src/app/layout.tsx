import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Dock } from "@/components/dock";
import { CommandPalette } from "@/components/command-palette";
import { Shortcuts } from "@/components/shortcuts";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Second Brain",
  description: "Personal capture, search, tasks, and meetings.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-bg text-fg">
        <main className="min-h-screen pb-28">{children}</main>
        <Dock />
        <CommandPalette />
        <Shortcuts />
      </body>
    </html>
  );
}
