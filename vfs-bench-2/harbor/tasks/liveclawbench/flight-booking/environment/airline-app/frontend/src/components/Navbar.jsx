import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Navbar = () => {
  const { user } = useAuth();

  return (
    <nav style={{
      background: 'linear-gradient(135deg, #4a90e2 0%, #357abd 100%)',
      padding: '18px 0',
      marginBottom: '0',
      color: 'white',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
    }}>
      <div className="container" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '15px'
      }}>
        <Link to="/" style={{
          color: 'white',
          fontSize: '26px',
          fontWeight: 'bold',
          textDecoration: 'none',
          letterSpacing: '-0.5px'
        }}>
          ✈️ GKD Airlines
        </Link>

        <div style={{ display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}>
          <Link to="/search" style={{
            color: 'white',
            textDecoration: 'none',
            fontWeight: '500',
            fontSize: '14px',
            transition: 'opacity 0.2s'
          }}>
            🔍 Flight Search
          </Link>
          <Link to="/my-bookings" style={{
            color: 'white',
            textDecoration: 'none',
            fontWeight: '500',
            fontSize: '14px'
          }}>
            📋 My Bookings
          </Link>
          <Link to="/baggage" style={{
            color: 'white',
            textDecoration: 'none',
            fontWeight: '500',
            fontSize: '14px'
          }}>
            🧳 Baggage Tracking
          </Link>
          <Link to="/restaurant" style={{
            color: 'white',
            textDecoration: 'none',
            fontWeight: '500',
            fontSize: '14px'
          }}>
            🍽️ Restaurant Info
          </Link>
          <Link to="/airport" style={{
            color: 'white',
            textDecoration: 'none',
            fontWeight: '500',
            fontSize: '14px'
          }}>
            🏢 Airport Info
          </Link>

          <div style={{
            marginLeft: '15px',
            display: 'flex',
            alignItems: 'center',
            gap: '15px'
          }}>
            <Link to="/profile" style={{
              background: 'rgba(255, 255, 255, 0.2)',
              border: '1px solid white',
              color: 'white',
              padding: '8px 18px',
              fontSize: '14px',
              fontWeight: '500',
              textDecoration: 'none',
              borderRadius: '6px'
            }}>
              👤 {user?.first_name || 'Profile'}
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
