import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { announcementsAPI } from '../services/api';

const AnnouncementDetail = () => {
  const { id } = useParams();
  const [announcement, setAnnouncement] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAnnouncement();
  }, [id]);

  const fetchAnnouncement = async () => {
    try {
      const response = await announcementsAPI.getDetails(id);
      setAnnouncement(response.data.data);
    } catch (error) {
      console.error('Failed to fetch announcement:', error);
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

  const getCategoryIcon = (category) => {
    const icons = {
      general: '📢',
      flight: '✈️',
      promotion: '🎉',
      emergency: '⚠️'
    };
    return icons[category] || '📢';
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '40px' }}>Loading...</div>;
  }

  if (!announcement) {
    return (
      <div style={{ textAlign: 'center', padding: '40px' }}>
        <p>Announcement not found.</p>
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
          <span style={{ fontSize: '32px' }}>{getCategoryIcon(announcement.category)}</span>
          <span style={{
            background: getPriorityColor(announcement.priority),
            color: 'white',
            padding: '5px 15px',
            borderRadius: '15px',
            fontSize: '12px',
            fontWeight: '600',
            textTransform: 'uppercase'
          }}>
            {announcement.priority}
          </span>
        </div>

        <h1 style={{ marginTop: 0, marginBottom: '15px', fontSize: '28px', color: '#333' }}>
          {announcement.title}
        </h1>

        <div style={{ color: '#999', fontSize: '14px', marginBottom: '30px' }}>
          Published: {new Date(announcement.published_at).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })}
        </div>

        <div style={{
          fontSize: '16px',
          lineHeight: '1.8',
          color: '#555',
          whiteSpace: 'pre-wrap'
        }}>
          {announcement.content}
        </div>

        {announcement.expires_at && (
          <div style={{
            marginTop: '30px',
            padding: '15px',
            background: '#f8f9fa',
            borderRadius: '5px',
            fontSize: '14px',
            color: '#666'
          }}>
            <strong>Valid until:</strong> {new Date(announcement.expires_at).toLocaleDateString()}
          </div>
        )}
      </div>
    </div>
  );
};

export default AnnouncementDetail;
