import React, { useMemo } from 'react';
import CalendarDay from './CalendarDay';
import { parseMonth, getDaysInMonth, getFirstDayOfMonth, getCurrentDate } from '../../utils/dateUtils';
import './Calendar.css';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const Calendar = ({ currentMonth, todoSummary, onDateClick }) => {
  const { year, month } = parseMonth(currentMonth);
  const today = getCurrentDate();

  const calendarDays = useMemo(() => {
    const daysInMonth = getDaysInMonth(year, month);
    const firstDayOfWeek = getFirstDayOfMonth(year, month);
    const days = [];

    // Previous month days
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    const daysInPrevMonth = getDaysInMonth(prevYear, prevMonth);

    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      const day = daysInPrevMonth - i;
      const dateStr = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      days.push({
        date: dateStr,
        day,
        isCurrentMonth: false,
        todoCount: todoSummary[dateStr] || 0,
      });
    }

    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      days.push({
        date: dateStr,
        day,
        isCurrentMonth: true,
        todoCount: todoSummary[dateStr] || 0,
      });
    }

    // Next month days (fill remaining cells to complete the grid)
    const totalCells = 42; // 6 rows × 7 days
    const remainingDays = totalCells - days.length;
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;

    for (let day = 1; day <= remainingDays; day++) {
      const dateStr = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      days.push({
        date: dateStr,
        day,
        isCurrentMonth: false,
        todoCount: todoSummary[dateStr] || 0,
      });
    }

    return days;
  }, [year, month, todoSummary]);

  return (
    <div className="calendar">
      <div className="calendar-header">
        {WEEKDAYS.map((day) => (
          <div key={day} className="weekday-header">
            {day}
          </div>
        ))}
      </div>
      <div className="calendar-grid">
        {calendarDays.map((dayInfo, index) => (
          <CalendarDay
            key={index}
            date={new Date(dayInfo.date)}
            isCurrentMonth={dayInfo.isCurrentMonth}
            isToday={dayInfo.date === today}
            todoCount={dayInfo.todoCount}
            onClick={() => onDateClick(dayInfo.date)}
          />
        ))}
      </div>
    </div>
  );
};

export default Calendar;
