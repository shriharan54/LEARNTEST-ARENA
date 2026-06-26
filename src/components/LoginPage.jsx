import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { auth } from '../firebase.config';
import './LoginPage.css';

const LoginPage = ({ onLoginSuccess }) => {
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  

  // Handle standard Email & Password Auth via MongoDB/Node.js API
  const handleEmailAuth = async (e) => {
    e.preventDefault();
    setError('');
    
    if (!email || !password) {
      setError("Please enter both email and password.");
      return;
    }

    try {
      const endpoint = isLoginMode ? '/api/login' : '/api/register';
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      
      let data;
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch (err) {
        throw new Error("Server response was not JSON. Please restart your terminal running `npm run dev` to load the new backend APIs!");
      }
      
      if (!response.ok) {
        throw new Error(data.message || 'Authentication failed');
      }
      
      // Pass a shimmed user object that matches the Firebase object structure expected by App.jsx
      onLoginSuccess({ 
        email: data.user.email,
        name: data.user.email.split('@')[0],
        getIdToken: () => data.token 
      });
    } catch (error) {
      console.error("Authentication failed:", error);
      setError(error.message);
    }
  };


  return (
    <div className="login-page-container">
      <motion.div 
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.4 }}
        className="login-card glass"
      >
        <h1 className="login-title">THE ARENA</h1>
        <p className="login-subtitle">Identify yourself to claim glory.</p>

        {error && (
          <motion.div 
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="login-error-message"
            style={{ 
              background: 'rgba(244, 67, 54, 0.1)', 
              borderLeft: '4px solid #f44336', 
              color: '#ff5252', 
              padding: '0.75rem 1rem', 
              marginBottom: '1rem', 
              borderRadius: '4px',
              fontSize: '0.9rem',
              textAlign: 'left'
            }}
          >
            {error}
          </motion.div>
        )}



        {/* Email & Password Form */}
        <form className="auth-form" onSubmit={handleEmailAuth} autoComplete="off">
          <input 
            type="email" 
            className="auth-input"
            placeholder="Email Address" 
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (error) setError('');
            }}
            autoComplete="off"
            required
          />
          <input 
            type="password" 
            className="auth-input"
            placeholder="Password" 
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError('');
            }}
            autoComplete="new-password"
            required
          />
          <button type="submit" className="auth-submit-btn">
            {isLoginMode ? 'CLAIM GLORY' : 'JOIN THE RANKS'}
          </button>
        </form>

        <p className="toggle-mode">
          {isLoginMode ? "Don't have an account? " : "Already have an account? "}
          <span onClick={() => setIsLoginMode(!isLoginMode)}>
            {isLoginMode ? "Sign up here" : "Login here"}
          </span>
        </p>


      </motion.div>
    </div>
  );
};

export default LoginPage;
