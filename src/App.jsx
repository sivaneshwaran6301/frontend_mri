import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Header from './components/Header';
import Patients from './pages/Patients';
import Upload from './pages/Upload';
import Viewer from './pages/Viewer';
import Login from './pages/Login';
import { isAuthenticated, hasRole } from './auth';

function ProtectedRoute({ children, allowedRoles }) {
  if (!isAuthenticated()) {
    window.location.href = "http://localhost:5173/frontend_mri/login#/login";
    return null;
  }
  if (allowedRoles && !allowedRoles.some(role => hasRole(role))) {
    return <Navigate to="/patients" replace />;
  }
  return children;
}

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<ProtectedRoute><Navigate to="/patients" replace /></ProtectedRoute>} />
        <Route
          path="/patients"
          element={
            <ProtectedRoute allowedRoles={['doctor', 'admin']}>
              <Header />
              <main><Patients /></main>
            </ProtectedRoute>
          }
        />
        <Route
          path="/upload"
          element={
            <ProtectedRoute allowedRoles={['admin']}>
              <Header />
              <main><Upload /></main>
            </ProtectedRoute>
          }
        />
        <Route
          path="/viewer/:id"
          element={
            <ProtectedRoute allowedRoles={['doctor', 'admin']}>
              <Viewer />
            </ProtectedRoute>
          }
        />
      </Routes>
    </HashRouter>
  );
}

export default App;
