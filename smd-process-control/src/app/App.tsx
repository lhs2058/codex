import { Route, Routes } from "react-router-dom";
import { RequireRole } from "../auth/RequireRole";
import { LoginPage } from "../auth/LoginPage";
import { useAuthState } from "../auth/AuthProvider";
import { AdminPage } from "../features/admin/AdminPage";
import { ProductionEntryPage } from "../features/entry/ProductionEntryPage";

export function App() {
  const auth = useAuthState();
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/" element={<RequireRole allow={["operator", "admin", "viewer"]} state={auth}><main><h1>SMD CONTROL</h1><p>Production workspace</p></main></RequireRole>} />
    <Route path="/admin" element={<RequireRole allow={["admin"]} state={auth}><AdminPage /></RequireRole>} />
    <Route path="/entry" element={<RequireRole allow={["operator", "admin"]} state={auth}><ProductionEntryPage /></RequireRole>} />
    <Route path="*" element={<RequireRole allow={["operator", "admin", "viewer"]} state={auth}><main><h1>SMD CONTROL</h1><p>Production workspace</p></main></RequireRole>} />
  </Routes>;
}
