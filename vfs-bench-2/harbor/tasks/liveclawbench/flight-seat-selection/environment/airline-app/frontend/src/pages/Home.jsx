import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { announcementsAPI, faqAPI } from '../services/api';

const Home = () => {
  const [announcements, setAnnouncements] = useState([]);
  const [faqs, setFaqs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [announcementsRes, faqsRes] = await Promise.all([
        announcementsAPI.getList({ per_page: 3 }),
        faqAPI.getList()
      ]);
      setAnnouncements(announcementsRes.data.data.announcements || []);
      setFaqs((faqsRes.data.data.faqs || []).slice(0, 5)); // Show top 5 FAQs
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getPriorityColor = (priority) => {
    const colors = {
      low: '#6c757d',
      normal: '#4a90e2',
      high: '#f0ad4e',
      urgent: '#d9534f'
    };
    return colors[priority] || colors.normal;
  };

  return (
    <div>
      <div style={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        color: 'white',
        padding: '80px 40px',
        textAlign: 'center',
        borderRadius: '12px',
        marginBottom: '40px',
        boxShadow: '0 4px 20px rgba(102, 126, 234, 0.4)'
      }}>
        <h1 style={{ fontSize: '52px', marginBottom: '25px', fontWeight: '700' }}>
          Welcome to GKD Airlines
        </h1>
        <p style={{ fontSize: '22px', marginBottom: '35px', lineHeight: '1.6' }}>
          Book flights, manage your trips, and travel with ease
        </p>
        <Link to="/search" className="btn-primary" style={{
          display: 'inline-block',
          padding: '16px 48px',
          fontSize: '18px',
          textDecoration: 'none',
          color: 'white',
          fontWeight: '600',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)'
        }}>
          ✈️ Search Flights
        </Link>
      </div>

      {/* Announcements Section */}
      {!loading && announcements.length > 0 && (
        <div style={{ marginBottom: '40px' }}>
          <h2 style={{ marginBottom: '20px', color: '#333' }}>📢 Latest Announcements</h2>
          <div style={{ display: 'grid', gap: '15px' }}>
            {announcements.map(announcement => (
              <Link
                key={announcement.id}
                to={`/announcements/${announcement.id}`}
                style={{
                  background: 'white',
                  padding: '20px',
                  borderRadius: '8px',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
                  textDecoration: 'none',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  transition: 'transform 0.2s, box-shadow 0.2s'
                }}
              >
                <div>
                  <h3 style={{ margin: '0 0 8px 0', color: '#333', fontSize: '18px' }}>{announcement.title}</h3>
                  <p style={{ margin: 0, color: '#666', fontSize: '14px' }}>
                    {announcement.content.substring(0, 100)}...
                  </p>
                </div>
                <span style={{
                  background: getPriorityColor(announcement.priority),
                  color: 'white',
                  padding: '5px 12px',
                  borderRadius: '15px',
                  fontSize: '11px',
                  fontWeight: '600',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap'
                }}>
                  {announcement.priority}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* FAQ Section */}
      {!loading && faqs.length > 0 && (
        <div style={{ marginBottom: '40px' }}>
          <h2 style={{ marginBottom: '20px', color: '#333' }}>❓ Frequently Asked Questions</h2>
          <div style={{ display: 'grid', gap: '12px' }}>
            {faqs.map(faq => (
              <Link
                key={faq.id}
                to={`/faq/${faq.id}`}
                style={{
                  background: 'white',
                  padding: '18px 20px',
                  borderRadius: '8px',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  transition: 'transform 0.2s'
                }}
              >
                <span style={{ fontSize: '24px' }}>❓</span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, color: '#333', fontSize: '15px', fontWeight: '500' }}>
                    {faq.question}
                  </p>
                </div>
                <span style={{ color: '#4a90e2', fontSize: '20px' }}>→</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Home;
