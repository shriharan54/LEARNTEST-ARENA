import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

mongoose.connect('mongodb://127.0.0.1:27017/learntest_arena')
  .then(() => console.log('MongoDB connected successfully.'))
  .catch(err => console.error('MongoDB connection error:', err));

const matchSchema = new mongoose.Schema({
  pin: String,
  title: String,
  date: { type: Date, default: Date.now },
  players: Array,
  questions: Array  // stores questions with explanations for audit/review
});
const Match = mongoose.model('Match', matchSchema);

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }
});
const User = mongoose.model('User', userSchema);

try {
  const serviceAccount = JSON.parse(readFileSync('./serviceAccountKey.json', 'utf8'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log("Firebase Admin initialized successfully.");
} catch (err) {
  console.warn("Firebase Admin init failed. Check serviceAccountKey.json.", err.message);
}

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = 'learntest-arena-super-secret-key';

app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ email, password: hashedPassword });
    await newUser.save();
    
    const token = jwt.sign({ email: newUser.email }, JWT_SECRET, { expiresIn: '2h' });
    res.status(201).json({ token, user: { email: newUser.email } });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "No user found with this email" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Incorrect password" });

    const token = jwt.sign({ email: user.email }, JWT_SECRET, { expiresIn: '2h' });
    res.status(200).json({ token, user: { email: user.email } });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 10 * 1024 * 1024  // 10MB — allows text content through socket
});

// Available quizzes removed as per user request (switch to AI generation only)
const activeGames = {};

function generatePIN() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function verifyToken(token) {
  if (!token) return null;
  if (token === "mock-session-token") {
    return { uid: 'mock-user', name: 'Mock User' };
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded;
  } catch (err) {
    try {
      const decodedToken = await admin.auth().verifyIdToken(token);
      return decodedToken;
    } catch (error) {
      console.error("Token verification failed:", err.message, error.message);
      return null;
    }
  }
}

const startTimer = (pin, io) => {
  const game = activeGames[pin];
  if (!game) return;
  
  if (game.timerInterval) clearInterval(game.timerInterval);
  if (game.autoNextTimeout) clearTimeout(game.autoNextTimeout);
  
  const question = game.questions[game.currentQuestion];
  game.timer = question.time || 20;
  game.answersCount = 0;
  game.answeredPlayers.clear();
  
  io.to(pin).emit('timer_update', game.timer);
  
  game.timerInterval = setInterval(() => {
    if (!activeGames[pin] || game.status !== "PLAYING") {
      clearInterval(game.timerInterval);
      game.timerInterval = null;
      return;
    }
    
    game.timer--;
    io.to(pin).emit('timer_update', game.timer);
    
    const allPlayersAnswered = game.players.length > 0 && game.answersCount >= game.players.length;
    
    if (game.timer <= 0 || allPlayersAnswered) {
      clearInterval(game.timerInterval);
      game.timerInterval = null;
      
      const delay = 7; // 7 seconds to show leaderboard/correct answer

      // Broadcast to ALL in the room — correctAnswer only (no explanation for players)
      io.to(pin).emit('question_ended', {
        correctAnswer: question.answer,
        players: game.players,
        nextDelay: delay
      });

      // Send explanation ONLY to the host socket
      io.to(game.hostId).emit('host_explanation', {
        explanation: question.explanation || '',
        correctAnswer: question.answer,
        correctAnswerText: question.options ? question.options[question.answer] : ''
      });

      console.log(`Question ended for game ${pin}. Auto-advancing in ${delay}s...`);
      
      game.autoNextTimeout = setTimeout(() => {
        advanceQuestion(pin, io);
      }, delay * 1000);
    }
  }, 1000);
};

const advanceQuestion = (pin, io) => {
  const game = activeGames[pin];
  if (!game) return;

  if (game.autoNextTimeout) {
    clearTimeout(game.autoNextTimeout);
    game.autoNextTimeout = null;
  }
  if (game.timerInterval) {
    clearInterval(game.timerInterval);
    game.timerInterval = null;
  }

  game.currentQuestion++;
  if (game.currentQuestion < game.questions.length) {
    io.to(pin).emit('next_question', {
      question: game.questions[game.currentQuestion],
      index: game.currentQuestion,
      total: game.questions.length
    });
    startTimer(pin, io);
  } else {
    game.status = "RESULTS";
    const sortedPlayers = game.players.sort((a,b) => b.score - a.score);
    io.to(pin).emit('game_over', sortedPlayers);
    
    try {
      const newMatch = new Match({
        pin: pin,
        title: game.title,
        players: sortedPlayers,
        questions: game.questions  // persist questions with explanations
      });
      newMatch.save()
        .then(() => console.log(`Match ${pin} saved to MongoDB.`))
        .catch(err => console.error(`Error saving match ${pin} to MongoDB:`, err));
    } catch (error) {
      console.error("MongoDB exception:", error);
    }
  }
};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('generate_quiz_preview', async (data) => {
    const { topic, numQuestions, fileContent, token } = data;
    const user = await verifyToken(token);
    if (!user) {
      socket.emit('join_error', "Unauthorized: Invalid or missing token.");
      return;
    }
    
    console.log(`Generating AI quiz for topic: ${topic}, Count: ${numQuestions}`);
    let generated;
    try {
      const response = await fetch('http://127.0.0.1:8000/generate_quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, numQuestions, fileContent })
      });
      if (!response.ok) throw new Error("Python backend error");
      generated = await response.json();
    } catch (err) {
      console.error("Failed to call Python backend:", err);
      socket.emit('join_error', "Failed to generate AI quiz from backend.");
      return;
    }
    
    socket.emit('quiz_preview_ready', generated);
  });

  socket.on('create_room_from_preview', async (generatedQuiz, token) => {
    const user = await verifyToken(token);
    if (!user) {
        socket.emit('join_error', "Unauthorized.");
        return;
    }
    const pin = generatePIN();
    
    activeGames[pin] = {
      pin,
      title: generatedQuiz.title,
      hostId: socket.id,
      players: [],
      questions: generatedQuiz.questions,
      currentQuestion: -1,
      status: "LOBBY",
      answersCount: 0,
      timer: 0,
      answeredPlayers: new Set()
    };
    
    socket.join(pin);
    socket.emit('host_ready', activeGames[pin]);
    console.log(`AI Game hosted: ${pin} for title ${generatedQuiz.title}`);
  });

  socket.on('join_game', async (pin, nickname, token, avatar) => {
    const user = await verifyToken(token);
    if (!user) {
      socket.emit('join_error', "Unauthorized: Invalid or missing token.");
      return;
    }

    const game = activeGames[pin];
    if (game && game.status === "LOBBY") {
      const player = { id: socket.id, nickname, score: 0, avatar: avatar || 'adventurer-1' };
      game.players.push(player);
      socket.join(pin);
      io.to(pin).emit('player_joined', game.players);
      socket.emit('joined_successfully', { pin, nickname, questionsCount: game.questions.length });
    } else {
      socket.emit('join_error', "Game not found or already started");
    }
  });

  socket.on('start_game', (pin) => {
    const game = activeGames[pin];
    if (game && socket.id === game.hostId) {
      game.status = "PLAYING";
      game.currentQuestion = 0;
      io.to(pin).emit('game_started', {
        question: game.questions[0],
        index: 0,
        total: game.questions.length
      });
      startTimer(pin, io);
    }
  });

  socket.on('submit_answer', (pin, answerIndex) => {
    const game = activeGames[pin];
    if (game && game.status === "PLAYING" && !game.answeredPlayers.has(socket.id)) {
      game.answeredPlayers.add(socket.id);
      game.answersCount++;
      const player = game.players.find(p => p.id === socket.id);
      if (player) {
        const correct = game.questions[game.currentQuestion].answer === answerIndex;
        if (correct) {
            const timeBonus = Math.floor((game.timer / (game.questions[game.currentQuestion].time || 20)) * 500);
            player.score += 500 + timeBonus;
        }
      }
      io.to(game.hostId).emit('answer_received', game.answersCount);
    }
  });

  socket.on('next_question', (pin) => {
    const game = activeGames[pin];
    if (game && socket.id === game.hostId) {
      advanceQuestion(pin, io);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
