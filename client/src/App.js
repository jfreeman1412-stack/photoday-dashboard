import React, { useState } from 'react';
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

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard': return <Dashboard onNavigate={setActivePage} />;
      case 'orders': return <OrdersPage />;
      case 'shipstation': return <ShipStationPage />;
      case 'print': return <PrintSheetsPage />;
      case 'settings': return <SettingsPage />;
      default: return <Dashboard onNavigate={setActivePage} />;
    }
  };

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
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${activePage === item.id ? 'active' : ''}`}
              onClick={() => setActivePage(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </div>

        <div className="sidebar-footer">
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
