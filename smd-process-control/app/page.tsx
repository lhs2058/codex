"use client";

import { useEffect, useState } from "react";
import { BrowserRouter } from "react-router-dom";
import { App } from "../src/app/App";
import { AppProviders } from "../src/app/providers";
import "../src/styles/globals.css";
import "../src/styles/dashboard.css";

export default function Page() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <main aria-busy="true" aria-label="SMD 공정 관리 불러오는 중" />;
  }

  return (
    <BrowserRouter>
      <AppProviders>
        <App />
      </AppProviders>
    </BrowserRouter>
  );
}
