import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { faqAPI } from '../services/api';

const FAQDetail = () => {
  const { id } = useParams();
  const [faq, setFaq] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchFAQ();
  }, [id]);

  const fetchFAQ = async () => {
    try {
      const response = await faqAPI.getDetails(id);
      setFaq(response.data.data);
    } catch (error) {
      console.error('Failed to fetch FAQ:', error);
    } finally {
      setLoading(false);
    }
  };

  const getCategoryIcon = (category) => {
    const icons = {
      booking: '📋',
      'check-in': '✅',
      baggage: '🧳',
      payment: '💳',
      general: '❓'
    };
    return icons[category] || '❓';
  };

  const getCategoryColor = (category) => {
    const colors = {
      booking: '#4a90e2',
      'check-in': '#28a745',
      baggage: '#ffc107',
      payment: '#17a2b8',
      general: '#6c757d'
    };
    return colors[category] || colors.general;
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '40px' }}>Loading...</div>;
  }

  if (!faq) {
    return (
      <div style={{ textAlign: 'center', padding: '40px' }}>
        <p>FAQ not found.</p>
        <Link to="/" style={{ color: '#4a90e2', textDecoration: 'none' }}>← Back to Home</Link>
      </div>
    );
  }

  return (
    <div>
      <Link to="/" style={{ color: '#4a90e2', textDecoration: 'none', marginBottom: '20px', display: 'inline-block' }}>
        ← Back to Home
      </Link>

      <div style={{
        background: 'white',
        padding: '40px',
        borderRadius: '10px',
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
        marginTop: '20px'
      }}>
        <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', alignItems: 'center' }}>
          <span style={{ fontSize: '32px' }}>{getCategoryIcon(faq.category)}</span>
          <span style={{
            background: getCategoryColor(faq.category),
            color: 'white',
            padding: '5px 15px',
            borderRadius: '15px',
            fontSize: '12px',
            fontWeight: '600',
            textTransform: 'uppercase'
          }}>
            {faq.category}
          </span>
        </div>

        <h1 style={{ marginTop: 0, marginBottom: '30px', fontSize: '26px', color: '#333' }}>
          {faq.question}
        </h1>

        <div style={{
          fontSize: '16px',
          lineHeight: '1.8',
          color: '#555',
          background: '#f8f9fa',
          padding: '25px',
          borderRadius: '8px',
          whiteSpace: 'pre-wrap'
        }}>
          {faq.answer}
        </div>
      </div>
    </div>
  );
};

export default FAQDetail;
