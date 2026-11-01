# To-Do List Web Application

A full-stack calendar-based to-do list application with React frontend, Flask backend, and SQLite database.

## Features

- Calendar-based interface for managing to-do items
- Month view with todo count badges on each date
- Detailed popup view for viewing todos on a specific date
- Create, edit, and delete to-do items
- Optional fields: time, location, person, and description
- Responsive and modern UI design

## Technology Stack

### Backend
- **Flask** - Web framework
- **SQLite** - Database
- **flask-cors** - CORS support

### Frontend
- **React** - UI library
- **CSS3** - Styling with modern gradients and animations

## Project Structure

```
/cpfs01/yilong.xu/todolist/
├── README.md
├── backend/
│   ├── app.py                 # Flask application with API routes
│   ├── models.py              # Database models and CRUD operations
│   ├── config.py              # Configuration settings
│   ├── requirements.txt       # Python dependencies
│   ├── init_db.py            # Database initialization script
│   └── todos.db              # SQLite database (created on init)
└── frontend/
    ├── public/
    │   └── index.html
    └── src/
        ├── index.js
        ├── App.js
        ├── App.css
        ├── components/
        │   ├── Header/
        │   ├── Calendar/
        │   ├── TodoPopup/
        │   ├── TodoItem/
        │   └── TodoForm/
        ├── services/
        │   └── api.js
        └── utils/
            └── dateUtils.js
```

## Database Schema

### Table: `todos`

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique identifier |
| title | TEXT | NOT NULL | Todo title (required) |
| date | TEXT | NOT NULL | Date in YYYY-MM-DD format |
| time | TEXT | NULL | Time in HH:MM format (optional) |
| location | TEXT | NULL | Location (optional) |
| person | TEXT | NULL | Associated person (optional) |
| description | TEXT | NULL | Detailed notes (optional) |
| created_at | TEXT | NOT NULL | Creation timestamp |
| updated_at | TEXT | NOT NULL | Last update timestamp |

## API Endpoints

**Base URL:** `http://localhost:5000/api`

1. **GET /api/todos** - Get all todos or filter by date range/month
2. **GET /api/todos/\<date\>** - Get todos for specific date
3. **GET /api/todos/item/\<id\>** - Get single todo by ID
4. **POST /api/todos** - Create new todo
5. **PUT /api/todos/\<id\>** - Update existing todo
6. **DELETE /api/todos/\<id\>** - Delete todo
7. **GET /api/summary/\<month\>** - Get todo count summary for month

## Installation and Setup

### Prerequisites
- Python 3.7+
- Node.js 14+
- npm

### Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Create a virtual environment (optional but recommended):
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Initialize the database:
   ```bash
   python init_db.py
   ```

5. Start the Flask server:
   ```bash
   python app.py
   ```

The backend will run on `http://localhost:5000`

### Frontend Setup

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the React development server:
   ```bash
   npm start
   ```

The frontend will run on `http://localhost:3000`

## Usage

1. Open your browser and navigate to `http://localhost:3000`
2. The calendar displays the current month
3. Click "Create Item" to add a new to-do
4. Click on any date to view its to-do items in a popup
5. Edit or delete items directly from the popup view
6. Navigate between months using the Previous/Next buttons

## Development

### Running Tests

**Backend:**
```bash
cd backend
python -m pytest  # if tests are added
```

**Frontend:**
```bash
cd frontend
npm test
```

### Building for Production

**Frontend:**
```bash
cd frontend
npm run build
```

This creates an optimized production build in the `frontend/build` directory.

## Security Considerations

- Input validation on all API endpoints
- Parameterized SQL queries to prevent SQL injection
- CORS configuration for frontend-backend communication
- Date and time format validation

## Future Enhancements

- User authentication and authorization
- Recurring todo items
- Categories and tags
- Search and filter functionality
- Export to calendar formats (iCal, Google Calendar)
- Mobile-responsive improvements
- Dark mode theme

## License

This project is for educational purposes.

## Author

Created as a demonstration of full-stack web development with React and Flask.
