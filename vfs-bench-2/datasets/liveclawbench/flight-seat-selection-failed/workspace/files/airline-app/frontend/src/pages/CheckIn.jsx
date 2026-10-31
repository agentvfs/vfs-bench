import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { checkinAPI, bookingsAPI } from '../services/api';
import { format } from 'date-fns';

const CheckIn = () => {
  const [searchParams] = useSearchParams();
  const bookingRef = searchParams.get('booking');

  const [bookingReference, setBookingReference] = useState(bookingRef || '');
  const [booking, setBooking] = useState(null);
  const [boardingPass, setBoardingPass] = useState(null);
  const [eligibleBookings, setEligibleBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checkedIn, setCheckedIn] = useState(false);

  useEffect(() => {
    fetchEligibleBookings();
  }, []);

  useEffect(() => {
    if (bookingRef) {
      handleLookupBooking();
    }
  }, [bookingRef]);

  const fetchEligibleBookings = async () => {
    try {
      const response = await checkinAPI.getEligible();
      setEligibleBookings(response.data.data.eligible_checkins);
    } catch (err) {
      // Ignore error for eligible bookings
    }
  };

  const handleLookupBooking = async () => {
    if (!bookingReference) {
      setError('Please enter a booking reference');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await bookingsAPI.getByReference(bookingReference);
      setBooking(response.data.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Booking not found');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckIn = async () => {
    setLoading(true);
    setError('');

    try {
      await checkinAPI.checkin(bookingReference);
      setCheckedIn(true);

      // Get boarding pass
      const bpResponse = await checkinAPI.getBoardingPass(bookingReference);
      setBoardingPass(bpResponse.data.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Check-in failed');
    } finally {
      setLoading(false);
    }
  };

  const formatDateTime = (dateString) => {
    return format(new Date(dateString), 'MMM d, yyyy HH:mm');
  };

  return (
    <div>
      <div style={{ marginBottom: '40px' }}>
        <h1 style={{ marginBottom: '10px', fontSize: '36px' }}>✅ Online Check-In</h1>
        <p style={{ color: '#666', fontSize: '16px' }}>Check-in online 24 hours before your flight departure</p>
      </div>

      {error && <div className="error-message">{error}</div>}

      {!booking && !checkedIn && (
        <div className="card">
          <h3>Enter Booking Reference</h3>
          <div className="form-group">
            <label>Booking Reference</label>
            <input
              type="text"
              value={bookingReference}
              onChange={(e) => setBookingReference(e.target.value.toUpperCase())}
              placeholder="e.g., ABC123"
              maxLength="10"
            />
          </div>
          <button className="btn-primary" onClick={handleLookupBooking} disabled={loading}>
            {loading ? 'Looking up...' : 'Find Booking'}
          </button>
        </div>
      )}

      {eligibleBookings.length > 0 && !booking && (
        <div className="card" style={{ marginTop: '20px' }}>
          <h3>Eligible for Check-In ({eligibleBookings.length})</h3>
          {eligibleBookings.map((eligible, index) => (
            <div
              key={index}
              style={{
                padding: '15px',
                border: '1px solid #ddd',
                borderRadius: '5px',
                marginBottom: '10px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <div>
                <p><strong>{eligible.flight_number}</strong></p>
                <p>{eligible.route}</p>
                <p>{formatDateTime(eligible.departure_time)}</p>
                <p style={{ fontSize: '14px', color: '#666' }}>
                  Departure in {eligible.hours_until_departure} hours
                </p>
              </div>
              <button
                className="btn-primary"
                onClick={() => {
                  setBookingReference(eligible.booking_reference);
                  window.location.href = `/checkin?booking=${eligible.booking_reference}`;
                }}
              >
                Check In
              </button>
            </div>
          ))}
        </div>
      )}

      {booking && !checkedIn && (
        <div className="card">
          <h3>Booking Details</h3>
          <p><strong>Booking Reference:</strong> {booking.booking_reference}</p>
          <p><strong>Flight:</strong> {booking.flight?.flight_number}</p>
          <p><strong>Route:</strong> {booking.flight?.origin?.code} → {booking.flight?.destination?.code}</p>
          <p><strong>Departure:</strong> {booking.flight?.departure_time && formatDateTime(booking.flight.departure_time)}</p>
          <p><strong>Passengers:</strong></p>
          {booking.passengers?.map((passenger, index) => (
            <div key={index} style={{ marginLeft: '20px', marginBottom: '5px' }}>
              {passenger.first_name} {passenger.last_name}
              {passenger.seat && ` - Seat: ${passenger.seat.seat_number}`}
            </div>
          ))}

          {!booking.checked_in && booking.booking_status === 'confirmed' && (
            <button
              className="btn-success"
              onClick={handleCheckIn}
              disabled={loading}
              style={{ marginTop: '20px' }}
            >
              {loading ? 'Checking in...' : 'Complete Check-In'}
            </button>
          )}

          {booking.checked_in && (
            <p style={{ marginTop: '20px', color: 'green', fontWeight: 'bold' }}>
              Already checked in
            </p>
          )}
        </div>
      )}

      {checkedIn && boardingPass && (
        <div>
          <div className="success-message" style={{ marginBottom: '20px' }}>
            Check-in successful! Your boarding passes are ready.
          </div>

          <h2>Boarding Passes</h2>
          {boardingPass.boarding_passes.map((bp, index) => (
            <div key={index} className="card" style={{
              border: '2px solid #4a90e2',
              marginBottom: '20px'
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: '20px'
              }}>
                <div>
                  <h2 style={{ color: '#4a90e2' }}>{bp.flight_number}</h2>
                  <p style={{ fontSize: '24px', fontWeight: 'bold' }}>
                    {bp.origin} → {bp.destination}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: '12px', color: '#666' }}>Booking Reference</p>
                  <p style={{ fontSize: '24px', fontWeight: 'bold' }}>{bp.booking_reference}</p>
                </div>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: '15px',
                marginBottom: '20px'
              }}>
                <div>
                  <p style={{ fontSize: '12px', color: '#666' }}>Passenger</p>
                  <p style={{ fontWeight: 'bold' }}>{bp.passenger_name}</p>
                </div>
                <div>
                  <p style={{ fontSize: '12px', color: '#666' }}>Seat</p>
                  <p style={{ fontWeight: 'bold', fontSize: '20px' }}>{bp.seat}</p>
                </div>
                <div>
                  <p style={{ fontSize: '12px', color: '#666' }}>Class</p>
                  <p style={{ fontWeight: 'bold' }}>{bp.cabin_class}</p>
                </div>
                <div>
                  <p style={{ fontSize: '12px', color: '#666' }}>Gate</p>
                  <p style={{ fontWeight: 'bold', fontSize: '20px' }}>{bp.gate}</p>
                </div>
                <div>
                  <p style={{ fontSize: '12px', color: '#666' }}>Terminal</p>
                  <p style={{ fontWeight: 'bold' }}>{bp.terminal}</p>
                </div>
                <div>
                  <p style={{ fontSize: '12px', color: '#666' }}>Boarding Time</p>
                  <p style={{ fontWeight: 'bold' }}>{formatDateTime(bp.boarding_time)}</p>
                </div>
              </div>

              <div style={{
                padding: '15px',
                background: '#f5f5f5',
                borderRadius: '5px',
                textAlign: 'center',
                fontFamily: 'monospace'
              }}>
                <p style={{ fontSize: '12px', marginBottom: '5px' }}>Barcode</p>
                <p style={{ fontSize: '18px', letterSpacing: '3px' }}>{bp.barcode}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CheckIn;
