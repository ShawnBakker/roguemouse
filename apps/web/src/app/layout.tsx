import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Roguemouse",
  description: "AI Operations Officer for algorithmic trading platforms",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
