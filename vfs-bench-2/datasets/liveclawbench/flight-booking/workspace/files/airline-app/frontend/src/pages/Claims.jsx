import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { claimsAPI, bookingsAPI } from '../services/api';

const Claims = () => {
  const [searchParams] = useSearchParams();
  const bookingRef = searchParams.get('booking');

  const [claims, setClaims] = useState([]);
  const [bookingReference, setBookingReference] = useState(bookingRef || '');
  const [claimType, setClaimType] = useState('delay');
  const [claimAmount, setClaimAmount] = useState('');
  const [claimReason, setClaimReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    fetchClaims();
  }, []);

  useEffect(() => {
    if (bookingRef) {
      calculateRefund();
    }
  }, [bookingRef, claimType]);

  const fetchClaims = async () => {
    try {
      const response = await claimsAPI.getAll();
      setClaims(response.data.data.claims);
    } catch (err) {
      // Ignore
    }
  };

  const calculateRefund = async () => {
    try {
      const response = await claimsAPI.calculateRefund(bookingReference, { claim_type: claimType });
      setClaimAmount(response.data.data.refund_amount.toString());
    } catch (err) {
      // Ignore calculation errors
    }
  };

  const handleSubmitClaim = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await claimsAPI.create({
        booking_reference: bookingReference,
        claim_type: claimType,
        claim_amount: parseFloat(claimAmount),
        claim_reason: claimReason
      });

      setSuccess('Claim submitted successfully!');
      setBookingReference('');
      setClaimAmount('');
      setClaimReason('');
      fetchClaims();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit claim');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return 'orange';
      case 'resolved': return 'green';
      case 'rejected': return 'red';
      default: return 'black';
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '40px' }}>
        <h1 style={{ marginBottom: '10px', fontSize: '36px' }}>💰 Claims & Refunds</h1>
        <p style={{ color: '#666', fontSize: '16px' }}>Submit and track claims for delays, cancellations, and refunds</p>
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      <div className="card" style={{ padding: '30px' }}>
        <h2 style={{ marginBottom: '25px' }}>Submit a New Claim</h2>
        <form onSubmit={handleSubmitClaim}>
          <div className="form-row">
            <div className="form-group">
              <label>Booking Reference</label>
              <input
                type="text"
                value={bookingReference}
                onChange={(e) => setBookingReference(e.target.value.toUpperCase())}
                placeholder="e.g., ABC123"
                required
              />
            </div>

            <div className="form-group">
              <label>Claim Type</label>
              <select
                value={claimType}
                onChange={(e) => setClaimType(e.target.value)}
              >
                <option value="delay">⏱️ Flight Delay</option>
                <option value="cancellation">❌ Flight Cancellation</option>
                <option value="refund">💵 Refund Request</option>
                <option value="other">📝 Other</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>Claim Amount ($)</label>
            <input
              type="number"
              value={claimAmount}
              onChange={(e) => setClaimAmount(e.target.value)}
              placeholder="e.g., 50.00"
              step="0.01"
              min="0"
              required
            />
          </div>

          <div className="form-group">
            <label>Reason for Claim</label>
            <textarea
              value={claimReason}
              onChange={(e) => setClaimReason(e.target.value)}
              placeholder="Please describe the reason for your claim in detail..."
              rows="5"
              required
            />
          </div>

          <button type="submit" className="btn-primary" disabled={loading} style={{
            width: '100%',
            padding: '14px',
            fontSize: '16px',
            marginTop: '10px'
          }}>
            {loading ? '⏳ Submitting...' : '✓ Submit Claim'}
          </button>
        </form>
      </div>

      <div style={{ marginTop: '50px' }}>
        <h2 style={{ marginBottom: '25px' }}>Your Claims History</h2>

        {claims.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '50px 30px' }}>
            <div style={{ fontSize: '64px', marginBottom: '20px' }}>📋</div>
            <h3 style={{ marginBottom: '10px' }}>No Claims Submitted</h3>
            <p style={{ color: '#666', fontSize: '16px' }}>
              You haven't submitted any claims yet.
            </p>
          </div>
        ) : (
          claims.map(claim => (
            <div key={claim.id} className="card" style={{ padding: '25px' }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'start',
                marginBottom: '20px',
                paddingBottom: '15px',
                borderBottom: '1px solid #e0e0e0'
              }}>
                <div>
                  <h3 style={{ marginBottom: '8px', fontSize: '22px' }}>Claim #{claim.id}</h3>
                  <p style={{ color: '#666', fontSize: '15px', margin: 0 }}>
                    Booking: <strong>{claim.booking_reference}</strong>
                  </p>
                </div>
                <span style={{
                  padding: '8px 18px',
                  background: getStatusColor(claim.claim_status),
                  color: 'white',
                  borderRadius: '25px',
                  fontSize: '14px',
                  fontWeight: '600',
                  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
                }}>
                  {claim.claim_status.toUpperCase()}
                </span>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '20px',
                marginBottom: '15px'
              }}>
                <div>
                  <p style={{ fontSize: '13px', color: '#999', marginBottom: '5px' }}>Type</p>
                  <p style={{ fontSize: '16px', fontWeight: '600', margin: 0 }}>
                    {claim.claim_type.charAt(0).toUpperCase() + claim.claim_type.slice(1)}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: '13px', color: '#999', marginBottom: '5px' }}>Claimed Amount</p>
                  <p style={{ fontSize: '20px', fontWeight: 'bold', color: '#4a90e2', margin: 0 }}>
                    ${claim.claim_amount.toFixed(2)}
                  </p>
                </div>
              </div>

              <div style={{ padding: '15px', background: '#f8f9fa', borderRadius: '8px', marginBottom: '15px' }}>
                <p style={{ fontSize: '13px', color: '#999', marginBottom: '5px' }}>Reason</p>
                <p style={{ fontSize: '15px', margin: 0, lineHeight: '1.6' }}>
                  {claim.claim_reason}
                </p>
              </div>

              {claim.resolution_notes && (
                <div style={{ padding: '15px', background: '#e8f4f8', borderRadius: '8px', marginBottom: '15px' }}>
                  <p style={{ fontSize: '13px', color: '#999', marginBottom: '5px' }}>Resolution Notes</p>
                  <p style={{ fontSize: '15px', margin: 0, lineHeight: '1.6' }}>
                    {claim.resolution_notes}
                  </p>
                </div>
              )}

              {claim.resolved_amount && (
                <div style={{ padding: '12px 18px', background: '#d4edda', borderRadius: '8px', border: '1px solid #c3e6cb' }}>
                  <p style={{ margin: 0, color: '#155724', fontWeight: '600', fontSize: '16px' }}>
                    ✓ Resolved Amount: ${claim.resolved_amount.toFixed(2)}
                  </p>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default Claims;
