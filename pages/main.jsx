import React from "react";
import { createRoot } from "react-dom/client";

import AttendanceDashboard from "../app/page.jsx";
import "../app/globals.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AttendanceDashboard />
  </React.StrictMode>,
);
