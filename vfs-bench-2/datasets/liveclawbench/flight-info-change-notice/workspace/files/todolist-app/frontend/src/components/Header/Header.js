import React from 'react';
import './Header.css';

const Header = ({ onCreateClick }) => {
  return (
    <header className="header">
      <div className="header-left">
        <h1 className="header-title">My To-Do List</h1>
      </div>
      <div className="header-right">
        <span className="header-username">Welcome, User!</span>
        <button className="create-btn" onClick={onCreateClick}>
          + Create Item
        </button>
      </div>
    </header>
  );
};

export default Header;
