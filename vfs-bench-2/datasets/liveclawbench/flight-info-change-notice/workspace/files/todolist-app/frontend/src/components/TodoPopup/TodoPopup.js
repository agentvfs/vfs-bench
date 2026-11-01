import React, { useEffect } from 'react';
import TodoItem from '../TodoItem/TodoItem';
import { formatDateForDisplay } from '../../utils/dateUtils';
import './TodoPopup.css';

const TodoPopup = ({ date, todos, onClose, onEdit, onDelete }) => {
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [onClose]);

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="popup-backdrop" onClick={handleBackdropClick}>
      <div className="popup-content">
        <div className="popup-header">
          <h2 className="popup-title">{formatDateForDisplay(date)}</h2>
          <button className="close-btn" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="popup-body">
          {todos.length === 0 ? (
            <div className="no-todos">
              <p>No to-do items for this date.</p>
            </div>
          ) : (
            <div className="todos-list">
              {todos.map((todo) => (
                <TodoItem
                  key={todo.id}
                  todo={todo}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TodoPopup;
