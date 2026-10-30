import React, { useState, useEffect } from 'react';
import { baggageAPI } from '../services/api';

const BaggageTracking = () => {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    flight_number: '',
    flight_time: '',
    seat_number: '',
    passenger_name: '',
    passenger_phone: '',
    passenger_email: '',
    baggage_description: '',
    loss_details: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetchReports();
  }, []);

  const fetchReports = async () => {
    try {
      const response = await baggageAPI.getList();
      setReports(response.data.data.baggage_reports || []);
    } catch (error) {
      console.error('Failed to fetch reports:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage('');

    try {
      // Convert datetime-local format (YYYY-MM-DDTHH:MM) to backend format (YYYY-MM-DD HH:MM:SS)
      const submitData = {
        ...formData,
        flight_time: formData.flight_time ? formData.flight_time.replace('T', ' ') + ':00' : ''
      };

      await baggageAPI.submit(submitData);
      setMessage('Baggage report submitted successfully!');
      setShowForm(false);
      setFormData({
        flight_number: '',
        flight_time: '',
        seat_number: '',
        passenger_name: '',
        passenger_phone: '',
        passenger_email: '',
        baggage_description: '',
        loss_details: ''
      });
      fetchReports();
    } catch (error) {
      setMessage('Failed to submit report: ' + (error.response?.data?.message || error.message));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <h2 style={{ color: '#333', margin: 0 }}>🧳 Baggage Tracking</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          style={{
            background: '#4a90e2',
            color: 'white',
            padding: '10px 20px',
            border: 'none',
            borderRadius: '5px',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer'
          }}
        >
          {showForm ? 'Cancel' : '+ Report Lost Baggage'}
        </button>
      </div>

      {message && (
        <div style={{
          padding: '12px',
          marginBottom: '20px',
          background: message.includes('successfully') ? '#d4edda' : '#f8d7da',
          color: message.includes('successfully') ? '#155724' : '#721c24',
          borderRadius: '5px'
        }}>
          {message}
        </div>
      )}

      {showForm && (
        <div style={{
          background: 'white',
          padding: '30px',
          borderRadius: '10px',
          boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
          marginBottom: '30px'
        }}>
          <h3 style={{ marginTop: 0 }}>Submit Lost Baggage Report</h3>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>Flight Number *</label>
                <input type="text" name="flight_number" value={formData.flight_number} onChange={handleChange} required style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '5px' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>Flight Time *</label>
                <input type="datetime-local" name="flight_time" value={formData.flight_time} onChange={handleChange} required style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '5px' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>Seat Number</label>
                <input type="text" name="seat_number" value={formData.seat_number} onChange={handleChange} style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '5px' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>Passenger Name *</label>
                <input type="text" name="passenger_name" value={formData.passenger_name} onChange={handleChange} required style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '5px' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>Passenger Phone *</label>
                <input type="tel" name="passenger_phone" value={formData.passenger_phone} onChange={handleChange} required style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '5px' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>Passenger Email *</label>
                <input type="email" name="passenger_email" value={formData.passenger_email} onChange={handleChange} required style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '5px' }} />
              </div>
            </div>
            <div style={{ marginTop: '20px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>Baggage Description *</label>
              <textarea name="baggage_description" value={formData.baggage_description} onChange={handleChange} required rows="3" style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '5px' }} />
            </div>
            <div style={{ marginTop: '20px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>Loss Details</label>
              <textarea name="loss_details" value={formData.loss_details} onChange={handleChange} rows="3" style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '5px' }} />
            </div>
            <button type="submit" disabled={submitting} style={{ marginTop: '20px', background: submitting ? '#ccc' : '#4a90e2', color: 'white', padding: '12px 30px', border: 'none', borderRadius: '5px', fontSize: '16px', fontWeight: '600', cursor: submitting ? 'not-allowed' : 'pointer' }}>
              {submitting ? 'Submitting...' : 'Submit Report'}
            </button>
          </form>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px' }}>Loading...</div>
      ) : reports.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', background: 'white', borderRadius: '10px' }}>
          <p style={{ color: '#666' }}>No baggage reports found.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '20px' }}>
          {reports.map(report => (
            <div key={report.id} style={{ background: 'white', padding: '20px', borderRadius: '10px', boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '15px' }}>
                <div>
                  <h3 style={{ margin: '0 0 5px 0' }}>Flight {report.flight_number}</h3>
                  <p style={{ margin: 0, color: '#666', fontSize: '14px' }}>{report.passenger_name}</p>
                </div>
                <span style={{
                  background: report.status === 'resolved' ? '#d4edda' : '#fff3cd',
                  color: report.status === 'resolved' ? '#155724' : '#856404',
                  padding: '5px 12px',
                  borderRadius: '15px',
                  fontSize: '12px',
                  fontWeight: '600'
                }}>
                  {report.status.toUpperCase()}
                </span>
              </div>
              <div style={{ color: '#666', fontSize: '14px' }}>
                <p style={{ margin: '5px 0' }}><strong>Seat:</strong> {report.seat_number || 'N/A'}</p>
                <p style={{ margin: '5px 0' }}><strong>Description:</strong> {report.baggage_description}</p>
                {report.location && <p style={{ margin: '5px 0' }}><strong>Location:</strong> {report.location}</p>}
                <p style={{ margin: '5px 0', fontSize: '12px' }}><strong>Submitted:</strong> {new Date(report.created_at).toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default BaggageTracking;
