/**
 * Date utility functions for calendar operations
 */

/**
 * Get the current month in YYYY-MM format
 */
export const getCurrentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * Get the current date in YYYY-MM-DD format
 */
export const getCurrentDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/**
 * Get days in a month
 * @param {number} year - Year
 * @param {number} month - Month (0-11)
 * @returns {number} Number of days in the month
 */
export const getDaysInMonth = (year, month) => {
  return new Date(year, month + 1, 0).getDate();
};

/**
 * Get the day of the week for the first day of the month (0 = Sunday, 1 = Monday, etc.)
 * @param {number} year - Year
 * @param {number} month - Month (0-11)
 * @returns {number} Day of week (0-6)
 */
export const getFirstDayOfMonth = (year, month) => {
  return new Date(year, month, 1).getDay();
};

/**
 * Parse month string to year and month number
 * @param {string} monthStr - Month in YYYY-MM format
 * @returns {Object} { year, month } where month is 0-11
 */
export const parseMonth = (monthStr) => {
  const [year, month] = monthStr.split('-').map(Number);
  return { year, month: month - 1 }; // Convert to 0-indexed
};

/**
 * Format date from Date object to YYYY-MM-DD
 * @param {Date} date - Date object
 * @returns {string} Date string
 */
export const formatDate = (date) => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

/**
 * Get month name from month number
 * @param {number} month - Month (0-11)
 * @returns {string} Month name
 */
export const getMonthName = (month) => {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return months[month];
};

/**
 * Navigate to previous month
 * @param {string} monthStr - Current month in YYYY-MM format
 * @returns {string} Previous month in YYYY-MM format
 */
export const getPreviousMonth = (monthStr) => {
  const { year, month } = parseMonth(monthStr);
  const date = new Date(year, month - 1, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * Navigate to next month
 * @param {string} monthStr - Current month in YYYY-MM format
 * @returns {string} Next month in YYYY-MM format
 */
export const getNextMonth = (monthStr) => {
  const { year, month } = parseMonth(monthStr);
  const date = new Date(year, month + 1, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * Format date for display (e.g., "March 9, 2026")
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @returns {string} Formatted date string
 */
export const formatDateForDisplay = (dateStr) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  return date.toLocaleDateString('en-US', options);
};

/**
 * Format time for display (e.g., "2:30 PM")
 * @param {string} timeStr - Time in HH:MM format (24-hour)
 * @returns {string} Formatted time string
 */
export const formatTimeForDisplay = (timeStr) => {
  if (!timeStr) return '';
  const [hours, minutes] = timeStr.split(':').map(Number);
  const date = new Date(2000, 0, 1, hours, minutes);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};
