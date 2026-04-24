import { Link, useLocation } from 'react-router-dom';
import { getUser, logout, hasRole, logoutBackend } from '../auth';
import './Header.css';

export default function Header() {
  const location = useLocation();
  const user = getUser();
  const isAdmin = hasRole('admin');

  const handleLogout = async () => {
    await logoutBackend();
    window.location.href = '/frontend_mri/login#/login';
  };

  return (
    <header className="app-header">
      <Link to="/" className="logo">Synapt<span>assistaX</span></Link>

      <div className="nav-right">
        <Link
          to="/patients"
          className={`nav-link ${location.pathname === '/patients' || location.pathname === '/' ? 'active' : ''}`}
        >
          Records
        </Link>
        {isAdmin && (
          <Link
            to="/upload"
            className={`nav-link ${location.pathname === '/upload' ? 'active' : ''}`}
          >
            Upload
          </Link>
        )}
        <button onClick={handleLogout} className="nav-link logout-btn">
          Logout
        </button>
      </div>
    </header>
  );
}
