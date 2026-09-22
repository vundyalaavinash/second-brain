import type { Metadata } from "next";
import { Manrope, Newsreader, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/shell/app-shell";
import { CommandPalette } from "@/components/command-palette";
import { Shortcuts } from "@/components/shortcuts";

const ui = Manrope({ variable: "--font-ui-src", subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });
const doc = Newsreader({ variable: "--font-doc-src", subsets: ["latin"], weight: ["400", "500"], style: ["normal", "italic"], display: "swap" });
const mono = Geist_Mono({ variable: "--font-mono-src", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Second Brain",
  description: "Personal capture, search, tasks, and meetings.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${ui.variable} ${doc.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-carbon text-fg font-ui">
        <AppShell>{children}</AppShell>
        <CommandPalette />
        <Shortcuts />
      </body>
    </html>
  );
}
