import React, { useState, useEffect, useRef } from 'react';
import { mockAPI } from '../services/api';
import { format } from 'date-fns';

const MockChat = () => {
  const [sessions, setSessions] = useState([]);
  const [currentSession, setCurrentSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    fetchSessions();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchSessions = async () => {
    try {
      const response = await mockAPI.getChatSessions();
      setSessions(response.data.data.sessions);
    } catch (err) {
      // Ignore
    }
  };

  const handleCreateSession = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await mockAPI.createChatSession();
      const session = response.data.data;
      setCurrentSession(session);
      setMessages(session.messages || []);
      fetchSessions();
    } catch (err) {
      setError('Failed to create chat session');
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();

    if (!newMessage.trim() || !currentSession) return;

    const messageText = newMessage;
    setNewMessage('');
    setLoading(true);

    // Add user message immediately
    setMessages(prev => [...prev, {
      sender_type: 'user',
      message: messageText,
      sent_at: new Date().toISOString()
    }]);

    try {
      const response = await mockAPI.sendMessage(currentSession.session_id, messageText);
      const { bot_response } = response.data.data;

      // Add bot response
      setMessages(prev => [...prev, bot_response]);
    } catch (err) {
      setError('Failed to send message');
    } finally {
      setLoading(false);
    }
  };

  const handleCloseSession = async () => {
    if (!currentSession) return;

    try {
      await mockAPI.closeChatSession(currentSession.session_id);
      setCurrentSession(null);
      setMessages([]);
      fetchSessions();
    } catch (err) {
      setError('Failed to close session');
    }
  };

  const formatTime = (dateString) => {
    return format(new Date(dateString), 'HH:mm');
  };

  return (
    <div>
      <div style={{ marginBottom: '40px' }}>
        <h1 style={{ marginBottom: '10px', fontSize: '36px' }}>💬 Customer Support Chat</h1>
        <p style={{ color: '#666', fontSize: '16px' }}>Chat with our AI-powered support bot</p>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '25px', minHeight: '700px' }}>
        {/* Sessions List */}
        <div>
          <button
            className="btn-primary"
            onClick={handleCreateSession}
            disabled={loading}
            style={{ width: '100%', marginBottom: '20px', padding: '14px', fontSize: '16px', fontWeight: '600' }}
          >
            💬 New Chat Session
          </button>

          <h3 style={{ marginBottom: '15px' }}>Previous Sessions</h3>
          {sessions.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '30px 20px' }}>
              <div style={{ fontSize: '40px', marginBottom: '10px' }}>💭</div>
              <p style={{ fontSize: '14px', color: '#666', margin: 0 }}>No previous sessions</p>
            </div>
          ) : (
            <div style={{ maxHeight: '580px', overflowY: 'auto' }}>
              {sessions.map(session => (
                <div
                  key={session.id}
                  className="card"
                  onClick={() => {
                    setCurrentSession(session);
                    setMessages(session.messages || []);
                  }}
                  style={{
                    cursor: 'pointer',
                    background: currentSession?.id === session.id ? '#f0f8ff' : 'white',
                    borderLeft: currentSession?.id === session.id ? '4px solid #4a90e2' : '3px solid #e0e0e0',
                    marginBottom: '10px',
                    transition: 'all 0.2s'
                  }}
                >
                  <p style={{ margin: '0 0 5px 0', fontWeight: '600', fontSize: '14px' }}>
                    Session {session.session_id.substring(0, 8)}...
                  </p>
                  <p style={{ margin: 0, fontSize: '12px', color: '#666' }}>
                    {session.status} • {session.messages?.length || 0} messages
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Chat Window */}
        <div>
          {currentSession ? (
            <div className="card" style={{
              height: '700px',
              display: 'flex',
              flexDirection: 'column',
              padding: 0,
              overflow: 'hidden'
            }}>
              {/* Chat Header */}
              <div style={{
                padding: '20px',
                borderBottom: '1px solid #e0e0e0',
                background: 'linear-gradient(135deg, #4a90e2 0%, #357abd 100%)',
                color: 'white',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div>
                  <h3 style={{ margin: '0 0 5px 0', fontSize: '20px' }}>💬 Support Chat</h3>
                  <p style={{ margin: 0, fontSize: '13px', opacity: 0.9 }}>Powered by AI • Active now</p>
                </div>
                <button
                  className="btn-danger"
                  onClick={handleCloseSession}
                  style={{ padding: '10px 20px', fontSize: '14px', fontWeight: '600' }}
                >
                  End Chat
                </button>
              </div>

              {/* Messages */}
              <div style={{
                flex: 1,
                overflowY: 'auto',
                padding: '25px',
                background: '#f8f9fa'
              }}>
                {messages.map((msg, index) => (
                  <div
                    key={index}
                    style={{
                      marginBottom: '20px',
                      display: 'flex',
                      justifyContent: msg.sender_type === 'user' ? 'flex-end' : 'flex-start'
                    }}
                  >
                    <div style={{
                      maxWidth: '65%',
                      padding: '14px 18px',
                      borderRadius: '18px',
                      background: msg.sender_type === 'user' ? '#4a90e2' : 'white',
                      color: msg.sender_type === 'user' ? 'white' : '#333',
                      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                      fontSize: '15px',
                      lineHeight: '1.5'
                    }}>
                      <p style={{ margin: '0 0 5px 0' }}>{msg.message}</p>
                      <p style={{
                        fontSize: '11px',
                        marginTop: '5px',
                        opacity: 0.7,
                        textAlign: 'right'
                      }}>
                        {formatTime(msg.sent_at)}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <form onSubmit={handleSendMessage} style={{
                padding: '20px',
                borderTop: '1px solid #e0e0e0',
                background: 'white',
                display: 'flex',
                gap: '12px'
              }}>
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Type your message..."
                  style={{ flex: 1, padding: '14px 18px', fontSize: '15px' }}
                  disabled={loading}
                />
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={loading || !newMessage.trim()}
                  style={{ padding: '14px 28px', fontSize: '16px', fontWeight: '600' }}
                >
                  Send
                </button>
              </form>
            </div>
          ) : (
            <div className="card" style={{
              height: '700px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '80px', marginBottom: '25px' }}>💬</div>
                <h3 style={{ marginBottom: '15px', fontSize: '24px' }}>Start a New Chat</h3>
                <p style={{ color: '#666', fontSize: '16px', marginBottom: '30px' }}>
                  Get instant support from our AI-powered chat bot
                </p>
                <button
                  className="btn-primary"
                  onClick={handleCreateSession}
                  style={{ padding: '16px 40px', fontSize: '17px', fontWeight: '600' }}
                >
                  💬 Start Chat
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MockChat;
