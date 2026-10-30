import React, { useState, useEffect } from 'react';
import { mockAPI } from '../services/api';
import { format } from 'date-fns';

const MockInbox = () => {
  const [emails, setEmails] = useState([]);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchEmails();
  }, []);

  const fetchEmails = async () => {
    try {
      const response = await mockAPI.getEmails();
      setEmails(response.data.data.emails);
    } catch (err) {
      setError('Failed to fetch emails');
    } finally {
      setLoading(false);
    }
  };

  const handleViewEmail = async (emailId) => {
    try {
      const response = await mockAPI.getEmailById(emailId);
      setSelectedEmail(response.data.data);
    } catch (err) {
      setError('Failed to fetch email');
    }
  };

  const formatDate = (dateString) => {
    return format(new Date(dateString), 'MMM d, yyyy HH:mm');
  };

  if (loading) {
    return <div className="loading">Loading emails...</div>;
  }

  return (
    <div>
      <div style={{ marginBottom: '40px' }}>
        <h1 style={{ marginBottom: '10px', fontSize: '36px' }}>📧 Mock Email Inbox</h1>
        <p style={{ color: '#666', fontSize: '16px' }}>View confirmation emails, notifications, and boarding passes</p>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '350px 1fr', gap: '25px' }}>
        {/* Email List */}
        <div>
          <div style={{ marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Inbox</h3>
            <span style={{ padding: '6px 14px', background: '#4a90e2', color: 'white', borderRadius: '20px', fontSize: '14px', fontWeight: '600' }}>
              {emails.length} email{emails.length !== 1 ? 's' : ''}
            </span>
          </div>
          {emails.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ fontSize: '48px', marginBottom: '15px' }}>📭</div>
              <p style={{ color: '#666', margin: 0 }}>No emails yet</p>
            </div>
          ) : (
            <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
              {emails.map(email => (
                <div
                  key={email.id}
                  className="card"
                  onClick={() => handleViewEmail(email.id)}
                  style={{
                    cursor: 'pointer',
                    background: email.is_read ? 'white' : '#f0f8ff',
                    borderLeft: email.is_read ? '3px solid #e0e0e0' : '4px solid #4a90e2',
                    marginBottom: '12px',
                    transition: 'transform 0.2s, box-shadow 0.2s'
                  }}
                >
                  <h4 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: email.is_read ? '500' : '600' }}>
                    {email.subject}
                  </h4>
                  <p style={{ margin: '0 0 5px 0', fontSize: '13px', color: '#666' }}>
                    {formatDate(email.sent_at)}
                  </p>
                  <p style={{ margin: 0, fontSize: '13px', color: '#999' }}>
                    📎 {email.email_type.replace('_', ' ')}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Email Content */}
        <div>
          {selectedEmail ? (
            <div className="card" style={{ padding: '30px', minHeight: '500px' }}>
              <h2 style={{ marginBottom: '20px', fontSize: '24px' }}>{selectedEmail.subject}</h2>
              <div style={{
                padding: '18px',
                background: '#f8f9fa',
                marginBottom: '25px',
                borderRadius: '8px',
                border: '1px solid #e0e0e0'
              }}>
                <div style={{ marginBottom: '8px' }}>
                  <strong style={{ color: '#555' }}>From:</strong>
                  <span style={{ marginLeft: '8px' }}>noreply@airline.com</span>
                </div>
                <div style={{ marginBottom: '8px' }}>
                  <strong style={{ color: '#555' }}>To:</strong>
                  <span style={{ marginLeft: '8px' }}>{selectedEmail.recipient_email}</span>
                </div>
                <div>
                  <strong style={{ color: '#555' }}>Date:</strong>
                  <span style={{ marginLeft: '8px' }}>{formatDate(selectedEmail.sent_at)}</span>
                </div>
              </div>
              <div style={{
                whiteSpace: 'pre-wrap',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                lineHeight: '1.8',
                padding: '25px',
                background: '#fafafa',
                borderRadius: '8px',
                border: '1px solid #e8e8e8',
                fontSize: '15px',
                color: '#333'
              }}>
                {selectedEmail.body}
              </div>
            </div>
          ) : (
            <div className="card" style={{
              height: '500px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '64px', marginBottom: '20px' }}>📬</div>
                <p style={{ color: '#999', fontSize: '18px', margin: 0 }}>
                  Select an email to view its content
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MockInbox;
