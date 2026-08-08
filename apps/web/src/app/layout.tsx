import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "まとめて寄れる店検索",
  description: "指定したチェーンがすべて入居する施設や、徒歩圏内にそろう場所を検索できます。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
