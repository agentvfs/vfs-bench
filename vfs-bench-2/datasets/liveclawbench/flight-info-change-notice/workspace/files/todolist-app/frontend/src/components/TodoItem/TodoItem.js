import React from 'react';
import { formatTimeForDisplay } from '../../utils/dateUtils';
import './TodoItem.css';

const TodoItem = ({ todo, onEdit, onDelete }) => {
  return (
    <div className="todo-item">
      <div className="todo-item-header">
        <h3 className="todo-title">{todo.title}</h3>
        <div className="todo-actions">
          <button className="edit-btn" onClick={() => onEdit(todo)}>
            Edit
          </button>
          <button className="delete-btn" onClick={() => onDelete(todo.id)}>
            Delete
          </button>
        </div>
      </div>
      <div className="todo-details">
        {todo.time && (
          <div className="todo-detail">
            <span className="detail-label">Time:</span>
            <span className="detail-value">{formatTimeForDisplay(todo.time)}</span>
          </div>
        )}
        {todo.location && (
          <div className="todo-detail">
            <span className="detail-label">Location:</span>
            <span className="detail-value">{todo.location}</span>
          </div>
        )}
        {todo.person && (
          <div className="todo-detail">
            <span className="detail-label">Person:</span>
            <span className="detail-value">{todo.person}</span>
          </div>
        )}
        {todo.description && (
          <div className="todo-description">
            <span className="detail-label">Notes:</span>
            <p className="description-text">{todo.description}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TodoItem;
