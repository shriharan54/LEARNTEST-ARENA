import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import admin from 'firebase-admin';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { GoogleGenAI } from '@google/genai';
import multer from 'multer';
import { createRequire } from 'module';
import { createServer as createViteServer } from 'vite';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

// MongoDB connection with fast timeout & in-memory fallback
let isMongoConnected = false;
const inMemoryUsers = new Map();
const inMemoryMatches = [];

mongoose.set('bufferCommands', false);
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/learntest_arena', {
  serverSelectionTimeoutMS: 2000
})
  .then(() => {
    isMongoConnected = true;
    console.log('MongoDB connected successfully.');
  })
  .catch((_err) => {
    console.warn('MongoDB not connected — in-memory fallback active for users and matches.');
  });

const matchSchema = new mongoose.Schema({
  pin: String,
  title: String,
  date: { type: Date, default: Date.now },
  players: Array,
  questions: Array
});
const Match = mongoose.model('Match', matchSchema);

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }
});
const User = mongoose.model('User', userSchema);

// Safe Firebase Admin initialization
try {
  if (existsSync('./serviceAccountKey.json')) {
    const serviceAccount = JSON.parse(readFileSync('./serviceAccountKey.json', 'utf8'));
    if (serviceAccount.project_id && !serviceAccount.project_id.includes('YOUR_PROJECT_ID')) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log("Firebase Admin initialized successfully.");
    } else {
      console.log("Firebase Admin credentials are placeholder. Skipping Admin SDK initialization.");
    }
  }
} catch (err) {
  console.warn("Firebase Admin init skipped/failed:", err.message);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });

const JWT_SECRET = process.env.JWT_SECRET || 'learntest-arena-super-secret-key';

// PDF extraction route
const handlePdfExtract = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ detail: "No file uploaded" });
    }
    const pdfBuffer = req.file.buffer;
    const data = await pdfParse(pdfBuffer);
    const fullText = data.text || '';
    const text = fullText.slice(0, 15000);
    console.log(`Extracted ${text.length} characters from uploaded PDF.`);
    return res.json({
      success: true,
      text: text,
      charCount: text.length,
      estimatedPages: data.numpages || Math.max(1, Math.round(pdfBuffer.length / 35000))
    });
  } catch (err) {
    console.error("PDF extract error:", err);
    return res.status(500).json({ detail: "Failed to extract PDF: " + err.message });
  }
};

app.post('/extract_pdf', upload.single('file'), handlePdfExtract);
app.post('/api/extract_pdf', upload.single('file'), handlePdfExtract);

// Authentication routes
app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    if (isMongoConnected) {
      try {
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ message: "User already exists" });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ email, password: hashedPassword });
        await newUser.save();
        
        const token = jwt.sign({ email: newUser.email }, JWT_SECRET, { expiresIn: '2h' });
        return res.status(201).json({ token, user: { email: newUser.email } });
      } catch (mongoErr) {
        console.warn("Mongo register failed, falling back to in-memory store:", mongoErr.message);
      }
    }

    // In-memory fallback
    if (inMemoryUsers.has(email)) {
      return res.status(400).json({ message: "User already exists" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    inMemoryUsers.set(email, { email, password: hashedPassword });

    const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '2h' });
    return res.status(201).json({ token, user: { email } });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    if (isMongoConnected) {
      try {
        const user = await User.findOne({ email });
        if (user) {
          const isMatch = await bcrypt.compare(password, user.password);
          if (!isMatch) return res.status(400).json({ message: "Incorrect password" });

          const token = jwt.sign({ email: user.email }, JWT_SECRET, { expiresIn: '2h' });
          return res.status(200).json({ token, user: { email: user.email } });
        }
      } catch (mongoErr) {
        console.warn("Mongo login query failed, falling back to in-memory store:", mongoErr.message);
      }
    }

    // In-memory fallback
    const user = inMemoryUsers.get(email);
    if (!user) return res.status(400).json({ message: "No user found with this email" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Incorrect password" });

    const token = jwt.sign({ email: user.email }, JWT_SECRET, { expiresIn: '2h' });
    res.status(200).json({ token, user: { email: user.email } });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Quiz generation function using Gemini API or fallback
function generateMockQuiz(topic, numQuestions = 5) {
  const count = Math.min(20, Math.max(1, parseInt(numQuestions) || 5));
  const t = topic || 'Trivia Arena';
  const mockQuestions = [];
  for (let i = 0; i < count; i++) {
    mockQuestions.push({
      question: `Question ${i + 1}: What is a primary concept regarding ${t}?`,
      options: [
        `Core principle of ${t}`,
        `Secondary hypothesis`,
        `Historical misconception`,
        `Unrelated theorem`
      ],
      answer: 0,
      time: 20,
      explanation: `Option 1 represents the foundational principle of ${t}. Review study notes for deeper understanding.`
    });
  }
  return {
    title: `${t} Quiz`,
    questions: mockQuestions
  };
}

async function generateQuiz(topic, numQuestions = 5, fileContent = '') {
  const count = Math.min(20, Math.max(1, parseInt(numQuestions) || 5));
  const safeTopic = topic ? topic.trim() : (fileContent ? 'Document Study' : 'General Trivia');
  const apiKey = process.env.GEMINI_API_KEY;

  if (apiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Generate exactly ${count} multiple-choice trivia questions about the topic "${safeTopic}".
${fileContent ? `Use the following context text if relevant:\n${fileContent.slice(0, 15000)}` : ''}

Return strictly valid JSON with this structure:
{
  "title": "${safeTopic} Quiz",
  "questions": [
    {
      "question": "Question text?",
      "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
      "answer": 0,
      "time": 20,
      "explanation": "A clear, friendly explanation (2-3 sentences) of why the correct answer is right. Use simple language suitable for students."
    }
  ]
}
Rules:
- There MUST be exactly 4 options per question.
- The "answer" field must be an integer (0, 1, 2, or 3) representing the index of the correct option.
- The "explanation" field MUST be present for every question. Write it in simple, student-friendly language that explains WHY the correct answer is right.
- Do not return any markdown blocks or backticks, just the raw JSON object.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json'
        }
      });

      let text = response.text ? response.text.trim() : '';
      if (text.startsWith('```json')) {
        text = text.replace(/^```json/, '').replace(/```$/, '').trim();
      } else if (text.startsWith('```')) {
        text = text.replace(/^```/, '').replace(/```$/, '').trim();
      }

      const parsed = JSON.parse(text);
      if (parsed && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
        for (const q of parsed.questions) {
          if (!q.time) q.time = 20;
          if (!q.explanation) {
            q.explanation = `Option ${(q.answer ?? 0) + 1} is correct.`;
          }
        }
        return parsed;
      }
    } catch (geminiErr) {
      console.warn("Gemini quiz generation failed, using fallback quiz:", geminiErr.message);
    }
  }

  return generateMockQuiz(safeTopic, count);
}

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 10 * 1024 * 1024
});

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
      if (admin.apps && admin.apps.length > 0) {
        const decodedToken = await admin.auth().verifyIdToken(token);
        return decodedToken;
      }
    } catch {
      console.error("Token verification failed:", err.message);
    }
    return null;
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
    
    if (isMongoConnected) {
      try {
        const newMatch = new Match({
          pin: pin,
          title: game.title,
          players: sortedPlayers,
          questions: game.questions
        });
        newMatch.save()
          .then(() => console.log(`Match ${pin} saved to MongoDB.`))
          .catch(err => console.error(`Error saving match ${pin} to MongoDB:`, err.message));
      } catch (error) {
        console.error("MongoDB save exception:", error.message);
      }
    } else {
      inMemoryMatches.push({
        pin,
        title: game.title,
        players: sortedPlayers,
        questions: game.questions,
        date: new Date()
      });
      console.log(`Match ${pin} recorded in memory.`);
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
    
    console.log(`Generating quiz for topic: ${topic}, count: ${numQuestions}`);
    try {
      const generated = await generateQuiz(topic, numQuestions, fileContent);
      socket.emit('quiz_preview_ready', generated);
    } catch (err) {
      console.error("Failed to generate quiz:", err);
      socket.emit('join_error', "Failed to generate quiz: " + err.message);
    }
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

// Vite middleware in dev, static files in production
async function setupViteOrStatic() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.use((req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
}

await setupViteOrStatic();

const PORT = 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
