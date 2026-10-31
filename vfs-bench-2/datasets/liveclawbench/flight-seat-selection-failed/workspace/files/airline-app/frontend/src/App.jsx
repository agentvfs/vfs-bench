import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import SearchFlights from './pages/SearchFlights';
import Booking from './pages/Booking';
import MyBookings from './pages/MyBookings';
import CheckIn from './pages/CheckIn';
import Claims from './pages/Claims';
import Profile from './pages/Profile';
import BaggageTracking from './pages/BaggageTracking';
import RestaurantInfo from './pages/RestaurantInfo';
import AirportInfo from './pages/AirportInfo';
import AnnouncementDetail from './pages/AnnouncementDetail';
import FAQDetail from './pages/FAQDetail';
import SeatSelection from './pages/SeatSelection';

function AppRoutes() {
  return (
    <>
      <Navbar />
      <div className="container" style={{ paddingTop: '20px', paddingBottom: '20px' }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<SearchFlights />} />
          <Route path="/booking/:flightId" element={<Booking />} />
          <Route path="/my-bookings" element={<MyBookings />} />
          <Route path="/seat-selection/:bookingReference" element={<SeatSelection />} />
          <Route path="/checkin" element={<CheckIn />} />
          <Route path="/claims" element={<Claims />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/baggage" element={<BaggageTracking />} />
          <Route path="/restaurant" element={<RestaurantInfo />} />
          <Route path="/airport" element={<AirportInfo />} />
          <Route path="/announcements/:id" element={<AnnouncementDetail />} />
          <Route path="/faq/:id" element={<FAQDetail />} />
        </Routes>
      </div>
    </>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </Router>
  );
}

export default App;
