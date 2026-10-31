import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Login = () => {
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(formData.email, formData.password);
      navigate('/search');
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '450px', margin: '40px auto' }}>
      <div className="card" style={{ padding: '35px' }}>
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <div style={{ fontSize: '48px', marginBottom: '10px' }}>✈️</div>
          <h1 style={{ marginBottom: '10px', fontSize: '32px' }}>Welcome Back</h1>
          <p style={{ color: '#666', fontSize: '16px' }}>Sign in to your AirLine account</p>
        </div>

        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email Address</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="Enter your email"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="Enter your password"
              required
            />
          </div>

          <button
            type="submit"
            className="btn-primary"
            disabled={loading}
            style={{ width: '100%', marginTop: '15px', padding: '14px', fontSize: '16px' }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div style={{ marginTop: '25px', textAlign: 'center', padding: '20px', background: '#f8f9fa', borderRadius: '8px' }}>
          <p style={{ marginBottom: '10px', color: '#666' }}>
            Don't have an account?
          </p>
          <Link
            to="/register"
            style={{
              color: '#4a90e2',
              fontWeight: '600',
              fontSize: '16px',
              textDecoration: 'none'
            }}
          >
            Create an Account
          </Link>
        </div>

        <div style={{ marginTop: '20px', padding: '15px', background: '#e8f4f8', borderRadius: '8px', fontSize: '14px', color: '#555' }}>
          <strong>Test Accounts:</strong><br />
          Email: john@example.com or jane@example.com<br />
          Password: password123
        </div>
      </div>
    </div>
  );
};

export default Login;
