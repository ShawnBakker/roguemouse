import type { ReactNode } from "react";

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
