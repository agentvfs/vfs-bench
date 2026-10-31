import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { checkinAPI, bookingsAPI } from '../services/api';
import { format } from 'date-fns';

const SeatSelection = () => {
  const { bookingReference } = useParams();
  const navigate = useNavigate();
  const [booking, setBooking] = useState(null);
  const [seatChart, setSeatChart] = useState({});
  const [selectedSeats, setSelectedSeats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchBookingAndSeats();
  }, [bookingReference]);

  const fetchBookingAndSeats = async () => {
    try {
      // Fetch booking details
      const bookingRes = await bookingsAPI.getByReference(bookingReference);
      const bookingData = bookingRes.data.data;
      setBooking(bookingData);

      // Fetch seat chart
      const seatRes = await checkinAPI.getSeatChart(bookingReference);
      setSeatChart(seatRes.data.data.seat_chart || {});

      // Pre-select already assigned seats
      if (bookingData.passengers) {
        const assignedSeats = bookingData.passengers
          .filter(p => p.seat)
          .map(p => p.seat.id);
        setSelectedSeats(assignedSeats);
      }
    } catch (err) {
      setError('Failed to fetch booking or seat information');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSeatClick = (seatId, isAvailable) => {
    if (!isAvailable) return;

    const passengerCount = booking?.passengers?.length || 1;

    if (selectedSeats.includes(seatId)) {
      // Deselect seat
      setSelectedSeats(selectedSeats.filter(id => id !== seatId));
    } else if (selectedSeats.length < passengerCount) {
      // Select seat
      setSelectedSeats([...selectedSeats, seatId]);
    }
  };

  const handleConfirmSeats = async () => {
    if (!booking || selectedSeats.length !== booking.passengers.length) {
      setError(`Please select ${booking?.passengers?.length || 1} seat(s)`);
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      await bookingsAPI.assignSeats(bookingReference, {
        seat_assignments: booking.passengers.map((passenger, index) => ({
          passenger_id: passenger.id,
          seat_id: selectedSeats[index]
        }))
      });

      navigate('/my-bookings');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to assign seats');
    } finally {
      setSubmitting(false);
    }
  };

  const getSeatStyle = (seat) => {
    const isSelected = selectedSeats.includes(seat.id);

    if (!seat.is_available) {
      return {
        background: '#ddd',
        color: '#999',
        cursor: 'not-allowed',
        opacity: 0.5
      };
    }

    if (isSelected) {
      return {
        background: '#4a90e2',
        color: 'white',
        cursor: 'pointer',
        border: '2px solid #357abd'
      };
    }

    // Available seat - different colors for window/aisle
    if (seat.is_window) {
      return {
        background: '#28a745',
        color: 'white',
        cursor: 'pointer'
      };
    }

    if (seat.is_aisle) {
      return {
        background: '#17a2b8',
        color: 'white',
        cursor: 'pointer'
      };
    }

    // Middle seat
    return {
      background: '#ffc107',
      color: '#333',
      cursor: 'pointer'
    };
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '40px' }}>Loading...</div>;
  }

  if (!booking) {
    return (
      <div style={{ textAlign: 'center', padding: '40px' }}>
        <p>Booking not found.</p>
        <Link to="/my-bookings">← Back to My Bookings</Link>
      </div>
    );
  }

  const passengerCount = booking.passengers?.length || 1;
  const rows = Object.keys(seatChart).sort((a, b) => parseInt(a) - parseInt(b));

  return (
    <div>
      <Link to="/my-bookings" style={{ color: '#4a90e2', textDecoration: 'none', marginBottom: '20px', display: 'inline-block' }}>
        ← Back to My Bookings
      </Link>

      <h2 style={{ marginBottom: '10px' }}>💺 Seat Selection</h2>
      <p style={{ color: '#666', marginBottom: '30px' }}>
        Flight {booking.flight?.flight_number} | {booking.flight?.origin?.code} → {booking.flight?.destination?.code}
      </p>

      {error && (
        <div style={{
          padding: '12px',
          marginBottom: '20px',
          background: '#f8d7da',
          color: '#721c24',
          borderRadius: '5px'
        }}>
          {error}
        </div>
      )}

      {/* Legend */}
      <div style={{
        background: 'white',
        padding: '20px',
        borderRadius: '10px',
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
        marginBottom: '30px'
      }}>
        <h3 style={{ marginTop: 0, marginBottom: '15px' }}>Seat Legend</h3>
        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '40px', height: '40px', background: '#28a745', borderRadius: '5px' }}></div>
            <span>Window Seat</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '40px', height: '40px', background: '#17a2b8', borderRadius: '5px' }}></div>
            <span>Aisle Seat</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '40px', height: '40px', background: '#ffc107', borderRadius: '5px' }}></div>
            <span>Middle Seat</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '40px', height: '40px', background: '#4a90e2', borderRadius: '5px', border: '2px solid #357abd' }}></div>
            <span>Selected</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '40px', height: '40px', background: '#ddd', borderRadius: '5px', opacity: 0.5 }}></div>
            <span>Unavailable</span>
          </div>
        </div>
        <p style={{ marginTop: '15px', marginBottom: 0, color: '#666', fontSize: '14px' }}>
          Selected: {selectedSeats.length} / {passengerCount} seats
        </p>
      </div>

      {/* Airplane Layout */}
      <div style={{
        background: 'white',
        padding: '40px',
        borderRadius: '10px',
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
        marginBottom: '30px'
      }}>
        {/* Airplane nose */}
        <div style={{
          textAlign: 'center',
          marginBottom: '20px',
          color: '#999',
          fontSize: '12px'
        }}>
          ✈️ FRONT OF AIRCRAFT
        </div>

        {/* Cockpit area */}
        <div style={{
          width: '200px',
          height: '60px',
          background: 'linear-gradient(to bottom, #e9ecef 0%, #f8f9fa 100%)',
          borderRadius: '100px 100px 0 0',
          margin: '0 auto',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#666',
          fontSize: '12px'
        }}>
          ✈️
        </div>

        {/* Seats Grid */}
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
          {rows.map(rowNumber => {
            const seats = seatChart[rowNumber];
            if (!seats || seats.length === 0) return null;

            // Sort seats by letter
            const sortedSeats = [...seats].sort((a, b) => a.seat_letter.localeCompare(b.seat_letter));
            const seatsPerRow = sortedSeats.length;
            const middleGap = Math.floor(seatsPerRow / 2);

            return (
              <div key={rowNumber} style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
                marginBottom: '10px'
              }}>
                {/* Left seats */}
                <div style={{ display: 'flex', gap: '5px' }}>
                  {sortedSeats.slice(0, middleGap).map(seat => (
                    <button
                      key={seat.id}
                      onClick={() => handleSeatClick(seat.id, seat.is_available)}
                      disabled={!seat.is_available}
                      style={{
                        width: '50px',
                        height: '50px',
                        border: 'none',
                        borderRadius: '8px',
                        fontWeight: '600',
                        fontSize: '12px',
                        transition: 'all 0.2s',
                        ...getSeatStyle(seat)
                      }}
                      title={`${seat.seat_number} - ${seat.is_window ? 'Window' : seat.is_aisle ? 'Aisle' : 'Middle'}${!seat.is_available ? ' (Taken)' : ''}`}
                    >
                      {seat.seat_number}
                    </button>
                  ))}
                </div>

                {/* Aisle */}
                <div style={{ width: '30px', textAlign: 'center', color: '#999', fontSize: '10px' }}>
                  |
                </div>

                {/* Right seats */}
                <div style={{ display: 'flex', gap: '5px' }}>
                  {sortedSeats.slice(middleGap).map(seat => (
                    <button
                      key={seat.id}
                      onClick={() => handleSeatClick(seat.id, seat.is_available)}
                      disabled={!seat.is_available}
                      style={{
                        width: '50px',
                        height: '50px',
                        border: 'none',
                        borderRadius: '8px',
                        fontWeight: '600',
                        fontSize: '12px',
                        transition: 'all 0.2s',
                        ...getSeatStyle(seat)
                      }}
                      title={`${seat.seat_number} - ${seat.is_window ? 'Window' : seat.is_aisle ? 'Aisle' : 'Middle'}${!seat.is_available ? ' (Taken)' : ''}`}
                    >
                      {seat.seat_number}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Airplane tail */}
        <div style={{
          width: '150px',
          height: '80px',
          background: 'linear-gradient(to top, #e9ecef 0%, #f8f9fa 100%)',
          borderRadius: '0 0 50px 50px',
          margin: '20px auto 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#666',
          fontSize: '12px'
        }}>
          TAIL
        </div>

        <div style={{
          textAlign: 'center',
          marginTop: '20px',
          color: '#999',
          fontSize: '12px'
        }}>
          REAR OF AIRCRAFT
        </div>
      </div>

      {/* Confirm Button */}
      <div style={{ textAlign: 'center' }}>
        <button
          onClick={handleConfirmSeats}
          disabled={submitting || selectedSeats.length !== passengerCount}
          style={{
            background: submitting || selectedSeats.length !== passengerCount ? '#ccc' : '#4a90e2',
            color: 'white',
            padding: '14px 40px',
            border: 'none',
            borderRadius: '5px',
            fontSize: '16px',
            fontWeight: '600',
            cursor: submitting || selectedSeats.length !== passengerCount ? 'not-allowed' : 'pointer'
          }}
        >
          {submitting ? 'Saving...' : 'Confirm Seat Selection'}
        </button>
      </div>
    </div>
  );
};

export default SeatSelection;
