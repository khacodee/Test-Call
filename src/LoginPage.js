import React, { useState } from 'react';

const LoginPage = ({ onLogin }) => {
  const [userId, setuserId] = useState('');

  const handleLogin = () => {
    if (userId.trim()) {
      onLogin(userId); // Gọi hàm onLogin để chuyển userId sang App
    } else {
      alert('Please enter a valid Account ID');
    }
  };

  return (
    <div style={{ textAlign: 'center', marginTop: '50px' }}>
      <h1>Login</h1>
      <input
        type="text"
        placeholder="Enter your Account ID"
        value={userId}
        onChange={(e) => setuserId(e.target.value)}
        style={{ padding: '10px', fontSize: '16px' }}
      />
      <br />
      <button
        onClick={handleLogin}
        style={{ marginTop: '20px', padding: '10px 20px', fontSize: '16px' }}
      >
        Login
      </button>
    </div>
  );
};

export default LoginPage;