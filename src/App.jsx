import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Users, Play, Send, CheckCircle, FileText, UploadCloud, X, Sparkles, BookOpen, Lightbulb } from 'lucide-react';
import socket from './socket';
import { auth } from './firebase.config';
import { onAuthStateChanged } from 'firebase/auth';
import LoginPage from './components/LoginPage';
import './index.css';

function App() {
  const [screen, setScreen] = useState('LOGIN'); // LOGIN, MENU, JOIN, HOST_SELECT, HOST_LOBBY, PLAYER_LOBBY, GAME, RESULTS
  const [pin, setPin] = useState('');
  const [nickname, setNickname] = useState('');
  const [players, setPlayers] = useState([]);
  const [gameData, setGameData] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [aiTopic, setAiTopic] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [timer, setTimer] = useState(0);
  const [answersCount, setAnswersCount] = useState(0);
  const [status, setStatus] = useState('');
  const [score, setScore] = useState(0);
  const [numQuestions, setNumQuestions] = useState(5);
  const [uploadedFileContent, setUploadedFileContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [pdfPageCount, setPdfPageCount] = useState(null);
  const [pdfExtracting, setPdfExtracting] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const [sessionToken, setSessionToken] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [correctAnswerIndex, setCorrectAnswerIndex] = useState(null);
  const [selectedAnswerIndex, setSelectedAnswerIndex] = useState(null);
  const [autoNextTimer, setAutoNextTimer] = useState(null);
  const [selectedAvatar, setSelectedAvatar] = useState('adventurer-1');
  const [explanationText, setExplanationText] = useState(null); // host only
  
  const avatars = [
    'adventurer-1', 'adventurer-2', 'adventurer-3', 'adventurer-4', 'adventurer-5',
    'big-smile-1', 'big-smile-2', 'big-smile-3', 'bottts-1', 'bottts-2'
  ];

  const handleAuthSuccess = async (user) => {
    try {
      if (!user) return;
      let token = "mock-session-token";
      if (user && typeof user.getIdToken === 'function') {
        token = await user.getIdToken();
      }
      setSessionToken(token);
      setCurrentUser(user);
      
      // Pre-fill nickname from email if not set
      if (!nickname && user.email) {
         setNickname(user.email.split('@')[0]);
      }

      if (screen === 'LOGIN') {
        setScreen('MENU');
      }
    } catch (err) {
      console.error("Token error:", err);
      alert("Failed to get authorization token.");
    }
  };







  const handleLogout = async () => {
    setSessionToken(null);
    setCurrentUser(null);
    setScreen('LOGIN');
  };

  useEffect(() => {
    console.log('App mounted, socket id:', socket.id);

    socket.on('connect', () => {
      console.log('Socket connected!', socket.id);
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected');
    });

    socket.on('player_joined', (updatedPlayers) => {
      console.log('Players updated:', updatedPlayers);
      setPlayers(updatedPlayers);
    });

    socket.on('joined_successfully', (data) => {
      setGameData(data);
      setScreen('PLAYER_LOBBY');
    });

    socket.on('quiz_preview_ready', (generated) => {
      setPreviewData(generated);
      setScreen('PREVIEW_QUIZ');
      setIsGenerating(false);
    });

    socket.on('host_ready', (game) => {
      console.log('Host ready, game:', game);
      setGameData(game);
      setScreen('HOST_LOBBY');
      setIsGenerating(false);
    });

    socket.on('game_started', (data) => {
      setCurrentQuestion(data);
      setScreen('GAME');
      setAnswersCount(0);
      setExplanationText(null);
    });

    socket.on('host_explanation', (data) => {
      // Only the host receives this event (targeted emit)
      setExplanationText(data.explanation || '');
    });

    socket.on('next_question', (data) => {
      setCurrentQuestion(data);
      setStatus('');
      setAnswersCount(0);
      setCorrectAnswerIndex(null);
      setSelectedAnswerIndex(null);
      setAutoNextTimer(null);
      setExplanationText(null);
    });

    socket.on('timer_update', (t) => {
      setTimer(t);
    });

    socket.on('answer_received', (count) => {
      setAnswersCount(count);
    });

    socket.on('question_ended', (data) => {
      setStatus('ENDED');
      setCorrectAnswerIndex(data.correctAnswer);
      if (data.players) setPlayers(data.players);
      
      if (data.nextDelay) {
        setAutoNextTimer(data.nextDelay);
        const interval = setInterval(() => {
          setAutoNextTimer(prev => {
            if (prev <= 1) {
              clearInterval(interval);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      }
    });

    socket.on('game_over', (finalPlayers) => {
      setPlayers(finalPlayers);
      setScreen('RESULTS');
    });

    socket.on('join_error', (msg) => alert(msg));

    return () => {
      socket.off('player_joined');
      socket.off('joined_successfully');
      socket.off('host_ready');
      socket.off('game_started');
      socket.off('next_question');
      socket.off('game_over');
      socket.off('join_error');
      socket.off('quiz_preview_ready');
      socket.off('host_explanation');
    };
  }, []);

  const joinGame = () => {
    if (pin && nickname && sessionToken) {
      socket.emit('join_game', pin, nickname, sessionToken, selectedAvatar);
    } else if (!sessionToken) {
      alert("You must be logged in!");
    }
  };

  const getQuizzes = () => {
    setScreen('HOST_SELECT');
  };


  const generateAiQuiz = () => {
    if (!sessionToken) {
      alert("Authentication required!");
      return;
    }
    if (!aiTopic && !uploadedFileContent) {
      alert("Please provide a topic or upload a file!");
      return;
    }
    setIsGenerating(true);
    socket.emit('generate_quiz_preview', {
      topic: aiTopic,
      numQuestions: parseInt(numQuestions),
      fileContent: uploadedFileContent,
      token: sessionToken
    });
  };

  const processFile = useCallback(async (file) => {
    if (!file) return;
    const isPdf = file.name.toLowerCase().endsWith('.pdf');
    const isTxt = file.name.toLowerCase().endsWith('.txt') || file.name.toLowerCase().endsWith('.csv');
    if (!isPdf && !isTxt) {
      alert('Only PDF, TXT, or CSV files are supported.');
      return;
    }

    setFileName(file.name);
    setPdfPageCount(null);
    setPdfError('');
    setUploadedFileContent('');

    if (isPdf) {
      // Upload PDF directly to Python backend — avoids Socket.IO 1MB limit
      setPdfExtracting(true);
      try {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('http://127.0.0.1:8000/extract_pdf', {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || 'Extraction failed');
        }
        const data = await res.json();
        setUploadedFileContent(data.text);
        setPdfPageCount(data.estimatedPages);
        if (!aiTopic) setAiTopic(file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '));
      } catch (err) {
        console.error('PDF extraction error:', err);
        setPdfError(`Could not extract PDF: ${err.message}. Is the Python backend running on port 8000?`);
        setFileName('');
      } finally {
        setPdfExtracting(false);
      }
    } else {
      // Plain text / CSV — read client-side
      const reader = new FileReader();
      reader.onload = (event) => {
        setUploadedFileContent(event.target.result);
        if (!aiTopic) setAiTopic(file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '));
      };
      reader.readAsText(file);
    }
  }, [aiTopic]);

  const handleFileUpload = (e) => processFile(e.target.files[0]);

  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    processFile(e.dataTransfer.files[0]);
  };

  const clearFile = () => {
    setFileName('');
    setUploadedFileContent('');
    setPdfPageCount(null);
    setPdfError('');
  };

  const startGame = () => {
    if (players.length === 0) {
      alert("Wait for at least one player to join before starting!");
      return;
    }
    socket.emit('start_game', gameData.pin);
  };

  const nextQuestion = () => {
    socket.emit('next_question', gameData.pin);
  };

  const submitAnswer = (index) => {
    if (status) return;
    setStatus('SUBMITTED');
    setSelectedAnswerIndex(index);
    socket.emit('submit_answer', gameData?.pin || pin, index);
  };

  return (
    <div className={`app-container ${screen === 'HOST_SELECT' ? 'host-page-active' : ''}`}>
      <AnimatePresence mode="wait">
        {currentUser && screen !== 'LOGIN' && (
          <div style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'var(--surface)', padding: '0.5rem 1rem', borderRadius: '20px', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '0.5rem', border: '1px solid var(--glass-border)', zIndex: 100 }}>
            <span style={{ fontSize: '0.85rem', opacity: 0.8 }}>Logged in as:</span>
            <strong>{currentUser.email || currentUser.displayName || currentUser.phoneNumber || currentUser.name || 'User'}</strong>
          </div>
        )}
        {screen === 'LOGIN' && (
          <LoginPage onLoginSuccess={handleAuthSuccess} />
        )}

        {screen === 'MENU' && (
          <motion.div 
            key="menu"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="join-container glass"
          >
            <h1 style={{ fontSize: '4.5rem', lineHeight: '1.2', marginBottom: '1rem' }}>LEARNTEST ARENA</h1>
            <p style={{marginBottom: '2rem', opacity: 0.8}}>Assemble your legion or host the grand games.</p>
            <div style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
              <button onClick={() => setScreen('JOIN')}>ENTER THE ARENA</button>
              <button onClick={getQuizzes} style={{background: 'var(--primary)', border: '1px solid var(--accent)'}}>HOST THE GAMES</button>
              <button onClick={handleLogout} style={{background: 'rgba(255,255,255,0.1)', border: '1px solid var(--glass-border)'}}>LOGOUT</button>
            </div>
          </motion.div>
        )}

        {screen === 'PREVIEW_QUIZ' && previewData && (
          <motion.div 
            key="preview-quiz"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="host-select-container glass"
            style={{ padding: '2rem', maxWidth: '800px', margin: 'auto' }}
          >
            <h2>Preview Quiz: {previewData.title}</h2>
            <div style={{ maxHeight: '60vh', overflowY: 'auto', textAlign: 'left', margin: '2rem 0', paddingRight: '0.5rem' }}>
              {previewData.questions.map((q, i) => (
                <div key={i} className="preview-question-card glass" style={{ marginBottom: '1.5rem', padding: '1.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                    <div style={{ background: 'var(--accent)', color: 'white', width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', flexShrink: 0 }}>
                      {i + 1}
                    </div>
                    <strong style={{ fontSize: '1.2rem', color: 'var(--text)' }}>{q.question}</strong>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    {q.options.map((opt, j) => {
                      const isCorrect = j === q.answer;
                      return (
                        <div 
                          key={j} 
                          style={{ 
                            padding: '0.75rem 1rem', 
                            borderRadius: '8px', 
                            background: isCorrect ? 'rgba(0, 200, 83, 0.1)' : 'rgba(255,255,255,0.05)',
                            border: isCorrect ? '1px solid var(--success)' : '1px solid rgba(255,255,255,0.1)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            color: isCorrect ? 'var(--success)' : 'var(--text)',
                            opacity: isCorrect ? 1 : 0.8
                          }}
                        >
                          {isCorrect ? <CheckCircle size={16} /> : <div style={{ width: 16 }} />}
                          <span style={{ fontSize: '0.95rem' }}>{opt}</span>
                          {isCorrect && <span style={{ marginLeft: 'auto', fontSize: '0.7rem', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px' }}>Answer</span>}
                        </div>
                      );
                    })}
                  </div>
                  {/* Explanation preview */}
                  {q.explanation && (
                    <div className="preview-explanation-block">
                      <Lightbulb size={15} className="preview-exp-icon" />
                      <span><strong style={{ color: 'var(--success)' }}>Explanation: </strong>{q.explanation}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button 
                onClick={() => setScreen('HOST_SELECT')} 
                style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid var(--glass-border)' }}
                disabled={isGenerating}
              >
                CANCEL
              </button>
              <button 
                onClick={() => {
                  socket.emit('create_room_from_preview', previewData, sessionToken);
                  setIsGenerating(true);
                }} 
                disabled={isGenerating}
                style={{ background: 'var(--success)', border: 'none' }}
              >
                {isGenerating ? 'CREATING...' : 'CREATE ROOM'}
              </button>
            </div>
          </motion.div>
        )}

        {screen === 'HOST_SELECT' && (
          <motion.div
            key="host-select"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="host-select-container"
          >
            <h1>Create Your Quiz</h1>
            <p style={{ textAlign: 'center', opacity: 0.7, marginBottom: '2rem', fontFamily: 'Marcellus, serif' }}>
              Upload a PDF or name a topic — Gemini AI will do the rest.
            </p>

            <div className="host-select-panels">

              {/* LEFT — PDF Upload */}
              <div className="host-panel glass">
                <div className="host-panel-header">
                  <BookOpen size={22} />
                  <span>Upload PDF</span>
                </div>

                <input
                  type="file"
                  accept=".txt,.csv,.pdf"
                  onChange={handleFileUpload}
                  id="file-upload"
                  style={{ display: 'none' }}
                />

                {pdfError && (
                  <div className="pdf-error-box">
                    <X size={16} style={{flexShrink:0}}/>
                    <span>{pdfError}</span>
                  </div>
                )}

                {pdfExtracting ? (
                  <div className="pdf-extracting">
                    <span className="spin-dot" style={{width:20,height:20,borderWidth:3}} />
                    <p className="drop-title" style={{marginTop:'0.5rem'}}>Reading PDF…</p>
                    <p className="drop-sub">Extracting text from your document</p>
                  </div>
                ) : !fileName ? (
                  <label
                    htmlFor="file-upload"
                    className={`pdf-dropzone ${isDragging ? 'dragging' : ''}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <UploadCloud size={48} className="drop-icon" />
                    <p className="drop-title">Drag & Drop your PDF here</p>
                    <p className="drop-sub">or click to browse files</p>
                    <span className="drop-badge">PDF · TXT · CSV</span>
                  </label>
                ) : (
                  <div className="pdf-preview-card">
                    <div className="pdf-icon-wrap">
                      <FileText size={40} />
                    </div>
                    <div className="pdf-info">
                      <p className="pdf-name">{fileName}</p>
                      {pdfPageCount && (
                        <p className="pdf-meta">~{pdfPageCount} page{pdfPageCount !== 1 ? 's' : ''} · {uploadedFileContent.length.toLocaleString()} chars extracted</p>
                      )}
                      <p className="pdf-meta pdf-ready">✓ Ready to generate questions</p>
                    </div>
                    <button
                      onClick={clearFile}
                      className="pdf-clear-btn"
                      title="Remove file"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}

                <p className="panel-note">
                  AI will read the document and create questions from its content.
                </p>
              </div>

              {/* DIVIDER */}
              <div className="host-or-divider">
                <span>OR</span>
              </div>

              {/* RIGHT — Topic + Settings */}
              <div className="host-panel glass">
                <div className="host-panel-header">
                  <Sparkles size={22} />
                  <span>Topic &amp; Settings</span>
                </div>

                <div className="host-field">
                  <label>Quiz Topic</label>
                  <input
                    type="text"
                    placeholder="e.g. Ancient Rome, Photosynthesis…"
                    value={aiTopic}
                    onChange={(e) => setAiTopic(e.target.value)}
                  />
                </div>

                <div className="host-field">
                  <label>Number of Questions</label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={numQuestions}
                    onChange={(e) => setNumQuestions(e.target.value)}
                  />
                </div>

                <button
                  onClick={generateAiQuiz}
                  className="generate-btn"
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <><span className="spin-dot" />PREPARING ARENA…</>
                  ) : (
                    <>✨ CONSTRUCT THE QUIZ</>
                  )}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '2rem' }}>
              <button
                onClick={() => setScreen('MENU')}
                style={{ maxWidth: '200px', background: 'rgba(255,255,255,0.1)', border: '1px solid var(--glass-border)' }}
              >
                BACK
              </button>
            </div>
          </motion.div>
        )}

        {screen === 'JOIN' && (
          <motion.div 
            key="join"
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            className="join-container glass"
          >
            <h2>Legion Registry</h2>
            <input 
              type="text" 
              placeholder="Legion PIN (Game Code)" 
              value={pin} 
              onChange={(e) => setPin(e.target.value)}
            />
            <input 
              type="text" 
              placeholder="Nickname" 
              value={nickname} 
              onChange={(e) => setNickname(e.target.value)}
            />

            <div style={{ margin: '1.5rem 0' }}>
              <p style={{ fontSize: '0.9rem', marginBottom: '1rem', opacity: 0.7 }}>CHOOSE YOUR AVATAR</p>
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(5, 1fr)', 
                gap: '0.5rem',
                maxHeight: '120px',
                overflowY: 'auto',
                padding: '0.5rem',
                background: 'rgba(255,255,255,0.05)',
                borderRadius: '12px'
              }}>
                {avatars.map((av) => (
                  <div 
                    key={av}
                    onClick={() => setSelectedAvatar(av)}
                    style={{ 
                      cursor: 'pointer',
                      padding: '4px',
                      borderRadius: '8px',
                      background: selectedAvatar === av ? 'var(--accent)' : 'transparent',
                      transition: 'all 0.2s',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <img 
                      src={`https://api.dicebear.com/7.x/adventurer/svg?seed=${av}`} 
                      alt="avatar" 
                      style={{ width: '30px', height: '30px', borderRadius: '4px' }} 
                    />
                  </div>
                ))}
              </div>
            </div>

            <button onClick={joinGame} style={{marginBottom: '1rem'}}>JOIN THE LEGION</button>
            <button onClick={() => setScreen('MENU')} style={{background: 'rgba(255,255,255,0.1)', border: '1px solid var(--glass-border)'}}>BACK</button>
          </motion.div>
        )}

        {screen === 'HOST_LOBBY' && (
          <motion.div 
            key="host-lobby"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="lobby-container"
          >
            <div className="glass" style={{padding: '2rem', marginBottom: '2rem'}}>
              <p>Join the Legion with PIN:</p>
              <h1 style={{fontSize: '5rem', letterSpacing: '10px', color: 'var(--accent)'}}>{gameData.pin}</h1>
            </div>
            
            <div className="player-list">
              {players.map((p, i) => (
                <div key={i} className="player-tag" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <img src={`https://api.dicebear.com/7.x/adventurer/svg?seed=${p.avatar || 'adventurer-1'}`} alt="pfp" style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
                  {p.nickname}
                </div>
              ))}
            </div>

            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', marginBottom: '2rem'}}>
              <Users size={24} /> <span>{players.length} Players</span>
            </div>

            <div style={{display: 'flex', gap: '1rem', justifyContent: 'center', maxWidth: '400px', margin: 'auto'}}>
              <button onClick={() => setScreen('MENU')} style={{background: 'rgba(255,255,255,0.1)', border: '1px solid var(--glass-border)'}}>BACK</button>
              <button 
                onClick={startGame} 
                style={{
                  background: players.length === 0 ? 'rgba(255,255,255,0.05)' : 'var(--success)',
                  border: players.length === 0 ? '1px dashed var(--glass-border)' : 'none',
                  opacity: players.length === 0 ? 0.7 : 1,
                  cursor: players.length === 0 ? 'not-allowed' : 'pointer'
                }}
              >
                START GAME
              </button>
            </div>
          </motion.div>
        )}

        {screen === 'PLAYER_LOBBY' && (
          <motion.div 
            key="player-lobby"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="join-container glass"
          >
            <h1>You are in the Coliseum!</h1>
            <p>Wait for the Emperor to start the battle.</p>
            <div style={{marginTop: '2rem'}}>
              <div className="player-tag" style={{display: 'inline-flex', alignItems: 'center', gap: '0.5rem'}}>
                <img src={`https://api.dicebear.com/7.x/adventurer/svg?seed=${selectedAvatar}`} alt="pfp" style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
                {nickname}
              </div>
            </div>
            <button 
              onClick={() => setScreen('MENU')} 
              style={{marginTop: '2rem', background: 'rgba(255,255,255,0.1)', border: '1px solid var(--glass-border)'}}
            >
              BACK
            </button>
          </motion.div>
        )}

        {screen === 'GAME' && currentQuestion && (
          <motion.div 
            key="game"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="game-container"
          >
            {gameData.hostId === socket.id ? (
              /* HOST VIEW */
              <div className="host-game-view">
                <div className="game-header glass">
                  <div className="question-info">
                    <span>LEGION ARENA — QUESTION {currentQuestion.index + 1} / {currentQuestion.total}</span>
                    <h2 style={{ fontSize: '1.2rem', padding: '0.5rem', border: 'none', background: 'none', boxShadow: 'none' }}>
                      LIVE SCOREBOARD
                    </h2>
                  </div>
                  <div style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
                    <div className="timer-circle" style={{ width: '60px', height: '60px', fontSize: '1.6rem', border: '3px solid var(--accent)' }}>{timer}</div>
                    <div className="answers-box">
                      <div className="count">{answersCount}</div>
                      <span>Submissions</span>
                    </div>
                  </div>
                </div>

                <div className="host-live-scoreboard glass" style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {[...players].sort((a, b) => b.score - a.score).map((p, i) => (
                    <div key={i} className={`rank-item ${i === 0 ? 'top' : ''}`} style={{ margin: '0.2rem 0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <span style={{ fontWeight: 'bold', minWidth: '25px' }}>{i + 1}.</span>
                        <img src={`https://api.dicebear.com/7.x/adventurer/svg?seed=${p.avatar || 'adventurer-1'}`} alt="pfp" style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
                        <span>{p.nickname}</span>
                      </div>
                      <span style={{ fontWeight: 'bold' }}>{p.score} pts</span>
                    </div>
                  ))}
                  {players.length === 0 && <p style={{ opacity: 0.5, textAlign: 'center' }}>Waiting for legionaries...</p>}
                </div>

                <div className="host-controls">
                  {status === 'ENDED' ? (
                    <div className="leaderboard-overlay glass" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4rem 2rem', background: 'var(--background)' }}>
                      <motion.h1 
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        style={{ fontSize: '3rem', marginBottom: '3rem', color: 'var(--accent)' }}
                      >
                         ARENA RANKINGS
                      </motion.h1>

                      <div className="podium-container" style={{ display: 'flex', alignItems: 'flex-end', gap: '1rem', height: '300px', marginBottom: '4rem' }}>
                        {[...players].sort((a,b) => b.score - a.score).slice(0, 5).map((p, i) => {
                          const heights = ['100%', '80%', '60%', '50%', '40%'];
                          const order = [1, 0, 2, 3, 4]; // Center the 1st place
                          const pOrdered = [...players].sort((a,b) => b.score - a.score).slice(0, 5);
                          // We'll just show them in order for now as a clean list if podium is too complex
                          return (
                            <motion.div 
                              key={i}
                              initial={{ y: 100, opacity: 0 }}
                              animate={{ y: 0, opacity: 1 }}
                              transition={{ delay: i * 0.1 }}
                              className="podium-item glass"
                              style={{ 
                                width: '120px', 
                                height: heights[i], 
                                display: 'flex', 
                                flexDirection: 'column', 
                                justifyContent: 'flex-end', 
                                padding: '1rem',
                                borderTop: i === 0 ? '4px solid var(--accent)' : '1px solid var(--glass-border)',
                                background: i === 0 ? 'rgba(255,215,0,0.1)' : 'var(--surface)'
                              }}
                            >
                              <div style={{ textAlign: 'center', marginBottom: 'auto' }}>
                                <div style={{ fontSize: '2rem', fontWeight: 'bold', color: i === 0 ? 'gold' : 'var(--text)' }}>
                                  {i + 1}
                                </div>
                                <img src={`https://api.dicebear.com/7.x/adventurer/svg?seed=${p.avatar || 'adventurer-1'}`} alt="pfp" style={{ width: '50px', height: '50px', borderRadius: '50%', background: 'rgba(255,255,255,0.1)', margin: '0.5rem auto' }} />
                              </div>
                              <div style={{ wordBreak: 'break-all', textAlign: 'center', fontWeight: 'bold' }}>{p.nickname}</div>
                              <div style={{ fontSize: '0.9rem', opacity: 0.7 }}>{p.score} pts</div>
                            </motion.div>
                          );
                        })}
                      </div>

                      {/* ── AI Explanation Card (host only) ── */}
                      <AnimatePresence>
                        {explanationText !== null && explanationText !== '' && (
                          <motion.div
                            key="ai-explanation"
                            initial={{ opacity: 0, y: 24 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                            className="ai-explanation-card"
                          >
                            <div className="ai-explanation-header">
                              <Lightbulb size={22} className="lightbulb-icon" />
                              <span className="ai-explanation-title">AI Explanation</span>
                              <span className="ai-explanation-badge">Gemini AI</span>
                            </div>
                            {correctAnswerIndex !== null && currentQuestion?.question?.options && (
                              <div className="ai-explanation-correct-answer">
                                <CheckCircle size={16} />
                                Correct Answer: {currentQuestion.question.options[correctAnswerIndex]}
                              </div>
                            )}
                            <p className="ai-explanation-text">{explanationText}</p>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <button onClick={nextQuestion} className="next-btn" style={{ fontSize: '1.5rem', padding: '1rem 3rem' }}>
                        {currentQuestion.index + 1 === currentQuestion.total ? 'REVEAL FINAL CHAMPION' : 'NEXT QUESTION ⚔'}
                      </button>

                      {autoNextTimer !== null && (
                        <div style={{ marginTop: '1.5rem', fontSize: '1.1rem', opacity: 0.7, color: 'var(--accent)' }}>
                          Automatically advancing in {autoNextTimer}s...
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              /* PLAYER VIEW */
              <div className="player-game-view">
                <div className="player-header glass">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <div className="timer-circle" style={{ width: '50px', height: '50px', fontSize: '1.4rem' }}>{timer}</div>
                    <div style={{ fontSize: '0.9rem', opacity: 0.8 }}>
                      Question {currentQuestion.index + 1} of {currentQuestion.total}
                    </div>
                  </div>
                  
                  <h2 style={{ fontSize: '1.8rem', marginBottom: '1rem', color: 'var(--primary)' }}>
                    {currentQuestion.question.question}
                  </h2>

                  <div style={{ fontSize: '1rem', fontWeight: 'bold', color: 'var(--accent)', textTransform: 'uppercase' }}>
                    {status === 'SUBMITTED' ? '✓ Answer Submitted!' : 
                     status === 'ENDED' ? '⌛ Question Ended' : '⚔ Choose your fate!'}
                  </div>
                  {status === 'ENDED' && correctAnswerIndex !== null && (
                    <motion.div 
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="result-notification"
                      style={{ 
                        marginTop: '1rem', 
                        background: selectedAnswerIndex === correctAnswerIndex ? 'rgba(76, 175, 80, 0.1)' : 'rgba(244, 67, 54, 0.1)', 
                        padding: '1.5rem', 
                        borderRadius: '12px', 
                        border: `2px solid ${selectedAnswerIndex === correctAnswerIndex ? 'var(--success)' : 'var(--accent)'}`,
                        textAlign: 'center'
                      }}
                    >
                      <div style={{ fontSize: '2.5rem', fontWeight: 'bold', marginBottom: '0.5rem', color: selectedAnswerIndex === correctAnswerIndex ? 'var(--success)' : 'var(--accent)' }}>
                         {selectedAnswerIndex === null ? 'TIME EXPIRED' : (selectedAnswerIndex === correctAnswerIndex ? 'CORRECT! ✨' : 'INCORRECT ⚔')}
                      </div>
                      <div style={{ fontSize: '1.1rem', opacity: 0.8 }}>
                        {selectedAnswerIndex === correctAnswerIndex ? (
                          <>Great work! You gained some legion glory.</>
                        ) : (
                          <>The correct answer was: <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>{currentQuestion.question.options[correctAnswerIndex]}</span></>
                        )}
                      </div>
                      <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: '1.2rem' }}>
                        Your current rank: <strong>#{[...players].sort((a,b) => b.score - a.score).findIndex(p => p.id === socket.id) + 1}</strong>
                      </div>

                      {/* Mini Leaderboard for Player Screen */}
                      <div className="mini-leaderboard" style={{ marginTop: '1.5rem', textAlign: 'left', width: '100%' }}>
                        <div style={{ fontSize: '0.8rem', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '0.5rem' }}>Arena Standings</div>
                        {[...players].sort((a,b) => b.score - a.score).slice(0, 5).map((p, i) => (
                          <div key={i} style={{ 
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            padding: '0.5rem 0.75rem', 
                            background: p.id === socket.id ? 'rgba(255,255,255,0.1)' : 'transparent',
                            borderRadius: '4px',
                            marginBottom: '2px',
                            borderLeft: p.id === socket.id ? '3px solid var(--accent)' : 'none'
                          }}>
                            <span style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              {i + 1}. 
                              <img src={`https://api.dicebear.com/7.x/adventurer/svg?seed=${p.avatar || 'adventurer-1'}`} alt="pfp" style={{ width: '20px', height: '20px', borderRadius: '50%' }} />
                              {p.nickname} {p.id === socket.id ? '(You)' : ''}
                            </span>
                            <span style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{p.score}</span>
                          </div>
                        ))}
                      </div>

                      {autoNextTimer !== null && (
                        <div style={{ marginTop: '1rem', fontSize: '0.9rem', opacity: 0.6, fontStyle: 'italic' }}>
                          Next challenge in {autoNextTimer}s...
                        </div>
                      )}
                    </motion.div>
                  )}
                </div>
                
                <div className="player-controller-grid">
                  {currentQuestion.question.options.map((opt, i) => (
                    <button 
                      key={i} 
                      className={`controller-btn option-${i} ${status === 'SUBMITTED' || status === 'ENDED' ? 'disabled' : ''}`}
                      onClick={() => submitAnswer(i)}
                      disabled={status === 'SUBMITTED' || status === 'ENDED'}
                      style={{ 
                        flexDirection: 'row', 
                        justifyContent: 'flex-start', 
                        padding: '1rem 1.5rem', 
                        fontSize: '1.1rem',
                        textAlign: 'left',
                        gap: '1rem',
                        border: status === 'ENDED' && i === correctAnswerIndex ? '4px solid var(--success)' : '2px solid var(--accent)',
                        opacity: status === 'ENDED' && i !== correctAnswerIndex ? 0.4 : 1
                      }}
                    >
                      <span className="controller-shape" style={{ fontSize: '1.8rem', minWidth: '40px' }}>
                        {['A', 'B', 'C', 'D'][i]}
                      </span>
                      <span className="controller-text" style={{ flex: 1, fontFamily: 'Marcellus, serif' }}>
                        {opt}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {screen === 'RESULTS' && (
          <motion.div 
            key="results"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            className="leaderboard glass"
          >
            <Trophy size={64} style={{display: 'block', margin: '0 auto 1rem', color: 'var(--accent)'}} />
            <h1>Glory to the Victors!</h1>
            
            <div style={{margin: '2rem 0'}}>
              {[...players].sort((a,b) => b.score - a.score).map((p, i) => (
                <div key={i} className={`rank-item ${i === 0 ? 'top' : ''}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 1rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <span style={{ fontWeight: 'bold' }}>{i + 1}.</span>
                    <img src={`https://api.dicebear.com/7.x/adventurer/svg?seed=${p.avatar || 'adventurer-1'}`} alt="pfp" style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
                    <span>{p.nickname}</span>
                  </div>
                  <span style={{ fontWeight: 'bold' }}>{p.score} pts</span>
                </div>
              ))}
            </div>

            <div style={{display: 'flex', gap: '1rem'}}>
              <button onClick={() => setScreen('MENU')} style={{background: 'rgba(255,255,255,0.1)', border: '1px solid var(--glass-border)'}}>MAIN MENU</button>
              <button onClick={() => window.location.reload()}>PLAY AGAIN</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
