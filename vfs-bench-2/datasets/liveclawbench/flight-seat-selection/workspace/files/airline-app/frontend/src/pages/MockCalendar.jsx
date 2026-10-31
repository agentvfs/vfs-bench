import React, { useState, useEffect } from 'react';
import { mockAPI } from '../services/api';
import { format } from 'date-fns';

const MockCalendar = () => {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    try {
      const response = await mockAPI.getCalendarEvents();
      setEvents(response.data.data.events);
    } catch (err) {
      setError('Failed to fetch calendar events');
    } finally {
      setLoading(false);
    }
  };

  const formatDateTime = (dateString) => {
    return format(new Date(dateString), 'MMM d, yyyy HH:mm');
  };

  const getEventColor = (event) => {
    const title = event.title.toLowerCase();
    if (title.includes('flight')) return '#4a90e2';
    if (title.includes('check-in')) return '#28a745';
    return '#6c757d';
  };

  if (loading) {
    return <div className="loading">Loading calendar...</div>;
  }

  return (
    <div>
      <div style={{ marginBottom: '40px' }}>
        <h1 style={{ marginBottom: '10px', fontSize: '36px' }}>📅 Mock Calendar</h1>
        <p style={{ color: '#666', fontSize: '16px' }}>Your flight events synced to mock Google Calendar</p>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="card" style={{ marginBottom: '25px', background: 'linear-gradient(135deg, #e8f4f8 0%, #f0f8ff 100%)', padding: '20px' }}>
        <p style={{ color: '#555', fontSize: '15px', margin: 0 }}>
          📆 This is a mock Google Calendar integration. Your flight bookings are automatically synced as calendar events.
        </p>
      </div>

      {events.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px 30px' }}>
          <div style={{ fontSize: '64px', marginBottom: '20px' }}>📅</div>
          <h3 style={{ marginBottom: '15px' }}>No Calendar Events</h3>
          <p style={{ color: '#666', fontSize: '16px', marginBottom: '25px' }}>
            Book a flight to see it in your calendar!
          </p>
          <a href="/search" className="btn-primary" style={{
            display: 'inline-block',
            padding: '14px 32px',
            textDecoration: 'none',
            fontSize: '16px'
          }}>
            ✈️ Search Flights
          </a>
        </div>
      ) : (
        events.map(event => (
          <div key={event.id} className="card" style={{
            borderLeft: `5px solid ${getEventColor(event)}`,
            padding: '25px',
            marginBottom: '20px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <div style={{
                fontSize: '32px',
                padding: '12px',
                background: `${getEventColor(event)}15`,
                borderRadius: '10px'
              }}>
                ✈️
              </div>
              <h3 style={{ color: getEventColor(event), margin: 0, fontSize: '24px' }}>
                {event.title}
              </h3>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '20px',
              marginBottom: '20px'
            }}>
              <div style={{ padding: '15px', background: '#f8f9fa', borderRadius: '8px' }}>
                <p style={{ fontSize: '13px', color: '#999', marginBottom: '5px' }}>🕐 Start</p>
                <p style={{ fontWeight: '600', fontSize: '15px', margin: 0 }}>{formatDateTime(event.start_time)}</p>
              </div>
              <div style={{ padding: '15px', background: '#f8f9fa', borderRadius: '8px' }}>
                <p style={{ fontSize: '13px', color: '#999', marginBottom: '5px' }}>🏁 End</p>
                <p style={{ fontWeight: '600', fontSize: '15px', margin: 0 }}>{formatDateTime(event.end_time)}</p>
              </div>
              <div style={{ padding: '15px', background: '#f8f9fa', borderRadius: '8px' }}>
                <p style={{ fontSize: '13px', color: '#999', marginBottom: '5px' }}>📍 Location</p>
                <p style={{ fontWeight: '600', fontSize: '15px', margin: 0 }}>{event.location}</p>
              </div>
              <div style={{ padding: '15px', background: '#f8f9fa', borderRadius: '8px' }}>
                <p style={{ fontSize: '13px', color: '#999', marginBottom: '5px' }}>⏰ Reminder</p>
                <p style={{ fontWeight: '600', fontSize: '15px', margin: 0 }}>{event.reminder_minutes} minutes before</p>
              </div>
            </div>

            {event.description && (
              <div style={{
                padding: '18px',
                background: '#fafafa',
                borderRadius: '8px',
                border: '1px solid #e8e8e8',
                whiteSpace: 'pre-wrap',
                fontSize: '14px',
                lineHeight: '1.6',
                color: '#555'
              }}>
                {event.description}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
};

export default MockCalendar;
