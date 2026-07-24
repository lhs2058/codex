import "./globals.css";

export const metadata = {
  title: "ACM·ACK 일일 출근 현황",
  description: "ACM·ACK 일일 인력 및 출근 현황 대시보드",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
