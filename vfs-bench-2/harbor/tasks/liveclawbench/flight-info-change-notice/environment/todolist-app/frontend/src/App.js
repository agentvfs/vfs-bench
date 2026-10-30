import React, { useState, useEffect } from 'react';
import Header from './components/Header/Header';
import Calendar from './components/Calendar/Calendar';
import TodoPopup from './components/TodoPopup/TodoPopup';
import TodoForm from './components/TodoForm/TodoForm';
import { getCurrentMonth, getPreviousMonth, getNextMonth, getMonthName, parseMonth } from './utils/dateUtils';
import { getTodosByDate, createTodo, updateTodo, deleteTodo, getMonthSummary } from './services/api';
import './App.css';

function App() {
  const [currentMonth, setCurrentMonth] = useState(getCurrentMonth());
  const [todoSummary, setTodoSummary] = useState({});
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedDateTodos, setSelectedDateTodos] = useState([]);
  const [showPopup, setShowPopup] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingTodo, setEditingTodo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load month summary when month changes
  const loadMonthSummary = async () => {
    try {
      setLoading(true);
      const summary = await getMonthSummary(currentMonth);
      setTodoSummary(summary);
      setError(null);
    } catch (err) {
      console.error('Failed to load month summary:', err);
      setError('Failed to load calendar data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMonthSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMonth]);

  const handlePreviousMonth = () => {
    setCurrentMonth(getPreviousMonth(currentMonth));
  };

  const handleNextMonth = () => {
    setCurrentMonth(getNextMonth(currentMonth));
  };

  const handleDateClick = async (date) => {
    try {
      setLoading(true);
      const todos = await getTodosByDate(date);
      setSelectedDate(date);
      setSelectedDateTodos(todos);
      setShowPopup(true);
      setError(null);
    } catch (err) {
      console.error('Failed to load todos:', err);
      setError('Failed to load to-do items');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateClick = () => {
    setEditingTodo(null);
    setShowForm(true);
  };

  const handleEditClick = (todo) => {
    setEditingTodo(todo);
    setShowPopup(false);
    setShowForm(true);
  };

  const handleDeleteClick = async (todoId) => {
    if (!window.confirm('Are you sure you want to delete this to-do item?')) {
      return;
    }

    try {
      setLoading(true);
      await deleteTodo(todoId);
      await loadMonthSummary();

      // Refresh the popup if it's open
      if (showPopup && selectedDate) {
        const todos = await getTodosByDate(selectedDate);
        setSelectedDateTodos(todos);
      }

      setError(null);
    } catch (err) {
      console.error('Failed to delete todo:', err);
      setError('Failed to delete to-do item');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveTodo = async (todoData) => {
    try {
      setLoading(true);

      if (editingTodo) {
        await updateTodo(editingTodo.id, todoData);
      } else {
        await createTodo(todoData);
      }

      await loadMonthSummary();

      // Refresh the popup if it's open for the same date
      if (showPopup && selectedDate === todoData.date) {
        const todos = await getTodosByDate(selectedDate);
        setSelectedDateTodos(todos);
      }

      setShowForm(false);
      setEditingTodo(null);
      setError(null);
    } catch (err) {
      console.error('Failed to save todo:', err);
      setError('Failed to save to-do item');
    } finally {
      setLoading(false);
    }
  };

  const handleClosePopup = () => {
    setShowPopup(false);
    setSelectedDate(null);
    setSelectedDateTodos([]);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setEditingTodo(null);
  };

  const { year, month } = parseMonth(currentMonth);
  const monthName = getMonthName(month);

  return (
    <div className="app">
      <Header onCreateClick={handleCreateClick} />

      <main className="main-content">
        {error && (
          <div className="error-banner">
            {error}
            <button onClick={() => setError(null)}>&times;</button>
          </div>
        )}

        {loading && <div className="loading-overlay">Loading...</div>}

        <div className="calendar-container">
          <div className="month-navigation">
            <button className="nav-btn" onClick={handlePreviousMonth}>
              &lt; Previous
            </button>
            <h2 className="current-month">
              {monthName} {year}
            </h2>
            <button className="nav-btn" onClick={handleNextMonth}>
              Next &gt;
            </button>
          </div>

          <Calendar
            currentMonth={currentMonth}
            todoSummary={todoSummary}
            onDateClick={handleDateClick}
          />
        </div>
      </main>

      {showPopup && selectedDate && (
        <TodoPopup
          date={selectedDate}
          todos={selectedDateTodos}
          onClose={handleClosePopup}
          onEdit={handleEditClick}
          onDelete={handleDeleteClick}
        />
      )}

      {showForm && (
        <TodoForm
          todo={editingTodo}
          initialDate={selectedDate || undefined}
          onSave={handleSaveTodo}
          onClose={handleCloseForm}
        />
      )}
    </div>
  );
}

export default App;
