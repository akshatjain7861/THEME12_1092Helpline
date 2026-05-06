import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "1092 Helpline Copilot",
  description: "AI-assisted call understanding MVP for multilingual helpline operations."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
