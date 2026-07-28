import { Link, Route, Routes } from "react-router-dom";
import { RequireRole } from "../auth/RequireRole";
import { LoginPage } from "../auth/LoginPage";
import { useAuthState } from "../auth/AuthProvider";
import { AdminPage } from "../features/admin/AdminPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { ProductionEntryPage } from "../features/entry/ProductionEntryPage";
import { UploadPage } from "../features/upload/UploadPage";

export function App() {
  const auth = useAuthState();
  const home = <main>
    <h1>SMD CONTROL</h1>
    <p>Production workspace</p>
    <nav aria-label="Main navigation">
      <Link to="/">Dashboard</Link>
      {auth.profile?.role !== "viewer" && <><Link to="/entry">Production entry</Link> <Link to="/upload">Workbook upload</Link></>}
      {auth.profile?.role === "admin" && <> <Link to="/admin">Administration</Link></>}
    </nav>
  </main>;
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/" element={<RequireRole allow={["operator", "admin", "viewer"]} state={auth}><DashboardPage /></RequireRole>} />
    <Route path="/admin" element={<RequireRole allow={["admin"]} state={auth}><AdminPage /></RequireRole>} />
    <Route path="/entry" element={<RequireRole allow={["operator", "admin"]} state={auth}><ProductionEntryPage /></RequireRole>} />
    <Route path="/upload" element={<RequireRole allow={["operator", "admin"]} state={auth}><UploadPage /></RequireRole>} />
    <Route path="*" element={<RequireRole allow={["operator", "admin", "viewer"]} state={auth}>{home}</RequireRole>} />
  </Routes>;
}
