import React from 'react';

const CalendarDay = ({ date, isCurrentMonth, isToday, todoCount, onClick }) => {
  const dayNumber = date.getDate();

  // date parameter is used for the day number extraction above
  void date;

  return (
    <div
      className={`calendar-day ${!isCurrentMonth ? 'other-month' : ''} ${isToday ? 'today' : ''}`}
      onClick={onClick}
    >
      <div className="day-number">{dayNumber}</div>
      {todoCount > 0 && (
        <div className="todo-badge">
          {todoCount > 9 ? '9+' : todoCount}
        </div>
      )}
    </div>
  );
};

export default CalendarDay;
