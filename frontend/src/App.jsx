import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AppVersion from "./AppVersion";
import LoginPage from "./Login";
import ProtectedRoute from "./ProtectedRoute";
import UserPage from "./UserPage";
import TripToolsApp from "./TripToolsApp";

export default function App() {
  return (
    <div className="outer-frame">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LoginPage />} />

          <Route
            path="/app"
            element={
              <ProtectedRoute>
                <TripToolsApp />
              </ProtectedRoute>
            }
          />

          <Route
            path="/user"
            element={
              <ProtectedRoute>
                <UserPage />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <AppVersion />
    </div>
  );
}
