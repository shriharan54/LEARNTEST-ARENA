import { io } from 'socket.io-client';

const socket = io({
  transports: ['websocket', 'polling']
});

socket.on('connect_error', (err) => {
  console.error('Socket connection error:', err);
});

export default socket;
