import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "SMD 공정 관리",
  description: "전장 카메라 SMD 공정 실적·수율·가동률 통합 관리",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
