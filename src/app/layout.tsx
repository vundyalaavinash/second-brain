import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
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
      <body className="min-h-screen flex bg-bg text-fg">
        <Sidebar />
        <main className="flex-1 min-w-0 flex flex-col">{children}</main>
        <CommandPalette />
        <Shortcuts />
      </body>
    </html>
  );
}
