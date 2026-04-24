import React, { useState, useEffect, useCallback } from 'react';
import api from './services/api';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';
import OrdersPage from './pages/OrdersPage';
import ShipStationPage from './pages/ShipStationPage';
import SettingsPage from './pages/SettingsPage';
import PrintSheetsPage from './pages/PrintSheetsPage';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: '◉' },
  { id: 'orders', label: 'Orders', icon: '⬡' },
  { id: 'shipstation', label: 'ShipStation', icon: '⬢' },
  { id: 'print', label: 'Print Sheets', icon: '◧' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

export default function App() {
  const [activePage, setActivePage] = useState('dashboard');
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Check for existing session on mount
  const checkSession = useCallback(async () => {
    const existingSession = api.getSession();
    if (existingSession) {
      try {
        const validUser = await api.validateSession();
        if (validUser) {
          setUser(validUser);
        }
      } catch (e) {
        // Session invalid — clear it
        api.setSession(null);
      }
    }
    setAuthChecked(true);
  }, []);

  useEffect(() => {
    checkSession();

    // Register auth error handler — kicks to login on 401
    api.onAuthError = () => {
      setUser(null);
    };

    return () => { api.onAuthError = null; };
  }, [checkSession]);

  const handleLogin = (loggedInUser) => {
    setUser(loggedInUser);
    setActivePage('dashboard');
  };

  const handleLogout = async () => {
    await api.logout();
    setUser(null);
  };

  // Show nothing while checking session
  if (!authChecked) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)' }}>
        <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading...</div>
      </div>
    );
  }

  // Show login if no user
  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard': return <Dashboard onNavigate={setActivePage} />;
      case 'orders': return <OrdersPage />;
      case 'shipstation': return <ShipStationPage />;
      case 'print': return <PrintSheetsPage />;
      case 'settings': return <SettingsPage user={user} />;
      default: return <Dashboard onNavigate={setActivePage} />;
    }
  };

  // Role badge color
  const roleBadge = {
    admin: { bg: 'rgba(220,53,69,0.15)', color: '#DC3545' },
    operator: { bg: 'rgba(33,150,243,0.15)', color: '#2196F3' },
    viewer: { bg: 'rgba(76,175,80,0.15)', color: '#4CAF50' },
  };

  const badge = roleBadge[user.role] || roleBadge.operator;

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-icon">SL</div>
          <div className="brand-text">
            <span className="brand-name">Sportsline</span>
            <span className="brand-sub">Production</span>
          </div>
        </div>

        <div className="nav-items">
          {NAV_ITEMS.map((item) => {
            // Hide settings from viewers
            if (item.id === 'settings' && user.role === 'viewer') return null;

            return (
              <button
                key={item.id}
                className={`nav-item ${activePage === item.id ? 'active' : ''}`}
                onClick={() => setActivePage(item.id)}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="sidebar-footer">
          {/* User info */}
          <div style={{
            padding: '10px 14px', marginBottom: 8,
            background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-sm)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                {user.displayName || user.username}
              </span>
              <span style={{
                fontSize: 10, padding: '1px 6px', borderRadius: 'var(--radius-sm)',
                background: badge.bg, color: badge.color, fontWeight: 600, textTransform: 'uppercase',
              }}>
                {user.role}
              </span>
            </div>
            <button
              onClick={handleLogout}
              style={{
                background: 'none', border: 'none', color: 'var(--text-muted)',
                fontSize: 11, cursor: 'pointer', padding: 0,
              }}
              onMouseEnter={e => e.target.style.color = 'var(--accent)'}
              onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}
            >
              Sign Out
            </button>
          </div>

          <div className="status-indicator">
            <span className="status-dot"></span>
            <span className="status-text">System Ready</span>
          </div>
        </div>
      </nav>

      <main className="main-content">
        {renderPage()}
      </main>
    </div>
  );
}
