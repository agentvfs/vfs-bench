import React, { useState, useEffect } from 'react';
import { infoAPI } from '../services/api';

const AirportInfo = () => {
  const [airportInfo, setAirportInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAirportInfo();
  }, []);

  const fetchAirportInfo = async () => {
    try {
      const response = await infoAPI.getAirport();
      setAirportInfo(response.data.data);
    } catch (error) {
      console.error('Failed to fetch airport info:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '40px' }}>Loading...</div>;
  }

  if (!airportInfo) {
    return <div style={{ textAlign: 'center', padding: '40px' }}>Failed to load airport information.</div>;
  }

  return (
    <div>
      <h2 style={{ marginBottom: '30px', color: '#333' }}>🏢 {airportInfo.name}</h2>

      {/* Terminals Section */}
      <div style={{ marginBottom: '40px' }}>
        <h3 style={{ color: '#4a90e2', marginBottom: '20px' }}>Terminals</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: '20px' }}>
          {airportInfo.terminals.map(terminal => (
            <div key={terminal.id} style={{
              background: 'white',
              padding: '25px',
              borderRadius: '10px',
              boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)'
            }}>
              <h4 style={{ marginTop: 0, marginBottom: '10px', fontSize: '18px' }}>{terminal.name}</h4>
              <p style={{ color: '#666', marginBottom: '15px', fontSize: '14px' }}>{terminal.description}</p>
              <div style={{ marginBottom: '10px', fontSize: '14px' }}>
                <strong>🚪 Gates:</strong> {terminal.gates}
              </div>
              <div>
                <strong style={{ fontSize: '14px' }}>Facilities:</strong>
                <ul style={{ marginTop: '8px', paddingLeft: '20px', fontSize: '14px', color: '#666' }}>
                  {terminal.facilities.map((facility, idx) => (
                    <li key={idx} style={{ marginBottom: '5px' }}>{facility}</li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Services Section */}
      <div style={{ marginBottom: '40px' }}>
        <h3 style={{ color: '#4a90e2', marginBottom: '20px' }}>Services</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
          {airportInfo.services.map((service, idx) => (
            <div key={idx} style={{
              background: 'white',
              padding: '20px',
              borderRadius: '10px',
              boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)'
            }}>
              <h4 style={{ marginTop: 0, marginBottom: '10px', fontSize: '16px' }}>{service.name}</h4>
              <p style={{ color: '#666', marginBottom: '10px', fontSize: '14px' }}>{service.description}</p>
              <div style={{ fontSize: '14px', color: '#666' }}>
                <p style={{ margin: '5px 0' }}><strong>📍 Location:</strong> {service.location}</p>
                <p style={{ margin: '5px 0' }}><strong>💰 Cost:</strong> {service.cost}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Parking Section */}
      <div style={{ marginBottom: '40px' }}>
        <h3 style={{ color: '#4a90e2', marginBottom: '20px' }}>Parking</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
          <div style={{
            background: 'white',
            padding: '20px',
            borderRadius: '10px',
            boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)'
          }}>
            <h4 style={{ marginTop: 0, marginBottom: '15px', fontSize: '16px' }}>🅿️ Short-Term Parking</h4>
            <p style={{ margin: '5px 0', fontSize: '14px', color: '#666' }}><strong>Location:</strong> {airportInfo.parking.short_term.location}</p>
            <p style={{ margin: '5px 0', fontSize: '14px', color: '#666' }}><strong>Capacity:</strong> {airportInfo.parking.short_term.capacity} spaces</p>
            <p style={{ margin: '5px 0', fontSize: '14px', color: '#666' }}><strong>Rate:</strong> {airportInfo.parking.short_term.rate}</p>
          </div>
          <div style={{
            background: 'white',
            padding: '20px',
            borderRadius: '10px',
            boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)'
          }}>
            <h4 style={{ marginTop: 0, marginBottom: '15px', fontSize: '16px' }}>🅿️ Long-Term Parking</h4>
            <p style={{ margin: '5px 0', fontSize: '14px', color: '#666' }}><strong>Location:</strong> {airportInfo.parking.long_term.location}</p>
            <p style={{ margin: '5px 0', fontSize: '14px', color: '#666' }}><strong>Capacity:</strong> {airportInfo.parking.long_term.capacity} spaces</p>
            <p style={{ margin: '5px 0', fontSize: '14px', color: '#666' }}><strong>Rate:</strong> {airportInfo.parking.long_term.rate}</p>
          </div>
          <div style={{
            background: 'white',
            padding: '20px',
            borderRadius: '10px',
            boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)'
          }}>
            <h4 style={{ marginTop: 0, marginBottom: '15px', fontSize: '16px' }}>🚗 Valet Parking</h4>
            <p style={{ margin: '5px 0', fontSize: '14px', color: '#666' }}><strong>Location:</strong> {airportInfo.parking.valet.location}</p>
            <p style={{ margin: '5px 0', fontSize: '14px', color: '#666' }}><strong>Rate:</strong> {airportInfo.parking.valet.rate}</p>
          </div>
        </div>
      </div>

      {/* Transportation Section */}
      <div style={{ marginBottom: '40px' }}>
        <h3 style={{ color: '#4a90e2', marginBottom: '20px' }}>Transportation</h3>
        <div style={{
          background: 'white',
          padding: '25px',
          borderRadius: '10px',
          boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)'
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px' }}>
            <div>
              <strong style={{ fontSize: '14px' }}>🚕 Taxi:</strong>
              <p style={{ margin: '5px 0 0 0', fontSize: '14px', color: '#666' }}>{airportInfo.transportation.taxi}</p>
            </div>
            <div>
              <strong style={{ fontSize: '14px' }}>🚆 Train:</strong>
              <p style={{ margin: '5px 0 0 0', fontSize: '14px', color: '#666' }}>{airportInfo.transportation.train}</p>
            </div>
            <div>
              <strong style={{ fontSize: '14px' }}>🚌 Bus:</strong>
              <p style={{ margin: '5px 0 0 0', fontSize: '14px', color: '#666' }}>{airportInfo.transportation.bus}</p>
            </div>
            <div>
              <strong style={{ fontSize: '14px' }}>🚙 Car Rental:</strong>
              <p style={{ margin: '5px 0 0 0', fontSize: '14px', color: '#666' }}>{airportInfo.transportation.rental}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Contact Section */}
      <div>
        <h3 style={{ color: '#4a90e2', marginBottom: '20px' }}>Contact</h3>
        <div style={{
          background: 'white',
          padding: '25px',
          borderRadius: '10px',
          boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)'
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px', fontSize: '14px' }}>
            <div>
              <strong>📞 Phone:</strong>
              <p style={{ margin: '5px 0 0 0', color: '#666' }}>{airportInfo.contact.phone}</p>
            </div>
            <div>
              <strong>✉️ Email:</strong>
              <p style={{ margin: '5px 0 0 0', color: '#666' }}>{airportInfo.contact.email}</p>
            </div>
            <div>
              <strong>🌐 Website:</strong>
              <p style={{ margin: '5px 0 0 0', color: '#666' }}>{airportInfo.contact.website}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AirportInfo;
