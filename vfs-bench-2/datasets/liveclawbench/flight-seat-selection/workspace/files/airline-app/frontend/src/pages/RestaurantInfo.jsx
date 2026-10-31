import React, { useState, useEffect } from 'react';
import { infoAPI } from '../services/api';

const RestaurantInfo = () => {
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRestaurants();
  }, []);

  const fetchRestaurants = async () => {
    try {
      const response = await infoAPI.getRestaurant();
      setRestaurants(response.data.data.restaurants || []);
    } catch (error) {
      console.error('Failed to fetch restaurants:', error);
    } finally {
      setLoading(false);
    }
  };

  const renderStars = (rating) => {
    const stars = [];
    for (let i = 0; i < 5; i++) {
      stars.push(
        <span key={i} style={{ color: i < rating ? '#ffc107' : '#ddd', fontSize: '18px' }}>★</span>
      );
    }
    return stars;
  };

  return (
    <div>
      <h2 style={{ marginBottom: '30px', color: '#333' }}>🍽️ Restaurant Information</h2>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px' }}>Loading...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '20px' }}>
          {restaurants.map(restaurant => (
            <div key={restaurant.id} style={{
              background: 'white',
              borderRadius: '10px',
              boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
              overflow: 'hidden',
              transition: 'transform 0.2s'
            }}>
              <div style={{
                height: '150px',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '48px'
              }}>
                🍴
              </div>
              <div style={{ padding: '20px' }}>
                <h3 style={{ marginTop: 0, marginBottom: '10px', fontSize: '20px' }}>{restaurant.name}</h3>
                <div style={{ marginBottom: '10px' }}>{renderStars(restaurant.rating)}</div>
                <p style={{ color: '#666', marginBottom: '10px', fontSize: '14px' }}>{restaurant.description}</p>
                <div style={{ marginBottom: '8px', fontSize: '14px' }}>
                  <strong>📍 Location:</strong> {restaurant.location}
                </div>
                <div style={{ marginBottom: '8px', fontSize: '14px' }}>
                  <strong>🕐 Hours:</strong> {restaurant.operating_hours}
                </div>
                <div style={{ marginBottom: '8px', fontSize: '14px' }}>
                  <strong>🍴 Cuisine:</strong> {restaurant.cuisine_type}
                </div>
                <div style={{ fontSize: '14px' }}>
                  <strong>📞 Phone:</strong> {restaurant.phone}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default RestaurantInfo;
