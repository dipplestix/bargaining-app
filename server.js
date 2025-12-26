const path = require('path');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const db = require('./lib/db');

const PORT = process.env.PORT || 8888;

const TOTAL_ROUNDS = 4;
const DISCOUNT = 0.95;
const ITEMS = [
  { name: 'Item 1', total: 7 },
  { name: 'Item 2', total: 4 },
  { name: 'Item 3', total: 1 },
];

const app = express();
app.use(express.static(path.join(__dirname)));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Active games in memory (also persisted to SQLite)
const games = new Map();

// Quick match waiting queue: sessionId -> { socket, name, joinedAt }
const waitingQueue = new Map();

// Active tournaments in memory
const tournaments = new Map();

// Session to socket mapping for tournament notifications
const sessionSockets = new Map();

wss.on('connection', (socket) => {
  socket.on('message', (data) => {
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch (error) {
      send(socket, { type: 'error', message: 'Malformed message.' });
      return;
    }

    const { type, payload } = parsed;
    switch (type) {
      case 'register':
        handleRegister(socket, payload);
        break;
      case 'createGame':
        handleCreateGame(socket, payload);
        break;
      case 'joinGame':
        handleJoinGame(socket, payload);
        break;
      case 'joinQueue':
        handleJoinQueue(socket);
        break;
      case 'leaveQueue':
        handleLeaveQueue(socket);
        break;
      case 'makeOffer':
        handleOffer(socket, payload);
        break;
      case 'acceptOffer':
        handleAccept(socket);
        break;
      case 'walkAway':
        handleWalkAway(socket);
        break;
      case 'requestNewGame':
        handleRequestNewGame(socket);
        break;
      case 'createTournament':
        handleCreateTournament(socket, payload);
        break;
      case 'joinTournament':
        handleJoinTournament(socket, payload);
        break;
      case 'startTournament':
        handleStartTournament(socket, payload);
        break;
      case 'getTournamentStatus':
        handleGetTournamentStatus(socket, payload);
        break;
      case 'readyForMatch':
        handleReadyForMatch(socket, payload);
        break;
      default:
        send(socket, { type: 'error', message: 'Unknown message type.' });
    }
  });

  socket.on('close', () => {
    const { sessionId, gameId, role } = socket;

    // Remove from session sockets
    if (sessionId) {
      sessionSockets.delete(sessionId);
    }

    // Remove from waiting queue
    if (sessionId && waitingQueue.has(sessionId)) {
      waitingQueue.delete(sessionId);
    }

    // Handle game disconnection
    if (!gameId || !role) return;
    const game = games.get(gameId);
    if (!game) return;

    if (game.players[role]) {
      game.players[role].socket = null;
    }

    const otherRole = role === 'P1' ? 'P2' : 'P1';
    const otherPlayer = game.players[otherRole];

    // Log disconnect if game was active
    if (!game.finished && game.dbGameId) {
      db.logGameOutcome(
        game.dbGameId,
        'disconnect',
        game.round,
        role,
        null,
        null,
        game.players.P1.outside * Math.pow(DISCOUNT, game.round - 1),
        game.players.P2.outside * Math.pow(DISCOUNT, game.round - 1)
      );
    }

    if (otherPlayer && otherPlayer.socket) {
      game.statusMessage = `${getPlayerLabel(role)} disconnected.`;
      game.finished = true;
      game.turn = null;
      send(otherPlayer.socket, {
        type: 'opponentLeft',
        message: `${getPlayerLabel(role)} disconnected. The match has ended.`,
      });
      sendState(game);
    }

    games.delete(gameId);
  });
});

// Session management
function handleRegister(socket, payload = {}) {
  const sessionId = payload.sessionId || uuidv4();
  const name = sanitizeName(payload.name) || 'Anonymous';

  const session = db.findOrCreateSession(sessionId, name);

  socket.sessionId = sessionId;
  socket.playerName = name;
  sessionSockets.set(sessionId, socket);

  send(socket, {
    type: 'registered',
    sessionId: session.id,
    name: session.display_name,
  });
}

// Quick match queue
function handleJoinQueue(socket) {
  if (!socket.sessionId) {
    send(socket, { type: 'error', message: 'Please register first.' });
    return;
  }

  // Remove from any existing game
  if (socket.gameId) {
    send(socket, { type: 'error', message: 'You are already in a game.' });
    return;
  }

  waitingQueue.set(socket.sessionId, {
    socket,
    name: socket.playerName,
    joinedAt: Date.now(),
  });

  send(socket, {
    type: 'queueStatus',
    waiting: true,
    position: waitingQueue.size,
  });

  tryPairPlayers();
}

function handleLeaveQueue(socket) {
  if (socket.sessionId && waitingQueue.has(socket.sessionId)) {
    waitingQueue.delete(socket.sessionId);
    send(socket, { type: 'queueStatus', waiting: false, position: 0 });
  }
}

function tryPairPlayers() {
  if (waitingQueue.size < 2) return;

  const entries = [...waitingQueue.entries()];
  const [p1SessionId, p1Entry] = entries[0];
  const [p2SessionId, p2Entry] = entries[1];

  waitingQueue.delete(p1SessionId);
  waitingQueue.delete(p2SessionId);

  // Notify remaining players of updated positions
  let position = 1;
  for (const [, entry] of waitingQueue) {
    send(entry.socket, { type: 'queueStatus', waiting: true, position: position++ });
  }

  // Create a quick match game
  createQuickMatch(p1Entry.socket, p2Entry.socket);
}

function createQuickMatch(socket1, socket2) {
  const gameId = generateGameId();

  const game = {
    id: gameId,
    dbGameId: null,
    tournamentId: null,
    tournamentMatchId: null,
    round: 1,
    turn: null,
    currentOffer: null,
    history: [],
    finished: false,
    outcome: null,
    statusMessage: 'Starting game...',
    players: {
      P1: {
        socket: socket1,
        sessionId: socket1.sessionId,
        name: socket1.playerName,
        values: null,
        outside: null,
      },
      P2: {
        socket: socket2,
        sessionId: socket2.sessionId,
        name: socket2.playerName,
        values: null,
        outside: null,
      },
    },
  };

  games.set(gameId, game);

  socket1.gameId = gameId;
  socket1.role = 'P1';
  socket2.gameId = gameId;
  socket2.role = 'P2';

  send(socket1, {
    type: 'matchFound',
    gameId,
    role: 'P1',
    opponent: socket2.playerName,
  });

  send(socket2, {
    type: 'matchFound',
    gameId,
    role: 'P2',
    opponent: socket1.playerName,
  });

  startNewMatch(game);
}

function handleCreateGame(socket, payload = {}) {
  if (!socket.sessionId) {
    send(socket, { type: 'error', message: 'Please register first.' });
    return;
  }

  const name = socket.playerName || sanitizeName(payload.name) || 'Player 1';
  const gameId = generateGameId();

  const game = {
    id: gameId,
    dbGameId: null,
    tournamentId: null,
    tournamentMatchId: null,
    round: 1,
    turn: null,
    currentOffer: null,
    history: [],
    finished: false,
    outcome: null,
    statusMessage: 'Waiting for another player to join.',
    players: {
      P1: {
        socket,
        sessionId: socket.sessionId,
        name,
        values: null,
        outside: null,
      },
      P2: null,
    },
  };

  games.set(gameId, game);

  socket.gameId = gameId;
  socket.role = 'P1';

  send(socket, {
    type: 'lobby',
    status: 'created',
    gameId,
    role: 'P1',
    message: 'Game created. Share the code so another player can join.',
  });

  sendState(game);
}

function handleJoinGame(socket, payload = {}) {
  if (!socket.sessionId) {
    send(socket, { type: 'error', message: 'Please register first.' });
    return;
  }

  const gameId = typeof payload.gameId === 'string' ? payload.gameId.trim().toUpperCase() : '';
  const name = socket.playerName || sanitizeName(payload.name) || 'Player 2';

  if (!gameId) {
    send(socket, { type: 'error', message: 'Enter a valid game code to join.' });
    return;
  }

  const game = games.get(gameId);
  if (!game) {
    send(socket, { type: 'error', message: 'Game not found. Double-check the code.' });
    return;
  }

  if (game.players.P2 && game.players.P2.socket) {
    send(socket, { type: 'error', message: 'This game already has two players.' });
    return;
  }

  game.players.P2 = {
    socket,
    sessionId: socket.sessionId,
    name,
    values: null,
    outside: null,
  };

  socket.gameId = gameId;
  socket.role = 'P2';

  send(socket, {
    type: 'lobby',
    status: 'joined',
    gameId,
    role: 'P2',
    message: 'Joined game. Waiting for the host to start the negotiation.',
  });

  const host = game.players.P1;
  if (host && host.socket) {
    send(host.socket, {
      type: 'lobby',
      status: 'opponent-joined',
      gameId,
      role: 'P1',
      message: `${name} joined as Player 2. The negotiation is starting!`,
    });
  }

  startNewMatch(game);
}

function handleOffer(socket, payload = {}) {
  const game = getGameForSocket(socket);
  if (!game) return;
  if (game.finished) {
    send(socket, { type: 'error', message: 'The game is already finished.' });
    return;
  }

  const role = socket.role;
  if (game.turn !== role) {
    send(socket, { type: 'error', message: 'It is not your turn to act.' });
    return;
  }

  if (!Array.isArray(payload.quantities) || payload.quantities.length !== ITEMS.length) {
    send(socket, { type: 'error', message: 'Offer must include all item quantities.' });
    return;
  }

  const quantities = payload.quantities.map((value) => Number.parseInt(value, 10));
  if (quantities.some((value) => !Number.isInteger(value) || value < 0)) {
    send(socket, { type: 'error', message: 'Quantities must be whole numbers greater than or equal to zero.' });
    return;
  }

  if (quantities.some((value, idx) => value > ITEMS[idx].total)) {
    send(socket, { type: 'error', message: 'Quantities cannot exceed the available total of an item.' });
    return;
  }

  const toRole = role === 'P1' ? 'P2' : 'P1';
  const offerer = game.players[role];
  const recipient = game.players[toRole];
  const discountFactor = Math.pow(DISCOUNT, game.round - 1);

  // Calculate values for logging
  const keepShare = ITEMS.map((item, idx) => item.total - quantities[idx]);
  const valueToSelf = computeValue(keepShare, offerer.values) * discountFactor;
  const valueToOpponent = computeValue(quantities, recipient.values) * discountFactor;

  // Log to database
  if (game.dbGameId) {
    db.logAction(game.dbGameId, socket.sessionId, role, 'offer', game.round, {
      quantities,
      valueToSelf,
      valueToOpponent,
      discountFactor,
    });
  }

  game.currentOffer = {
    from: role,
    to: toRole,
    quantities,
  };

  addHistoryEntry(game, `${getPlayerLabel(role)} offers ${formatQuantities(quantities)} to ${getPlayerLabel(toRole)}.`);

  game.turn = toRole;
  if (role === 'P2' && game.round < TOTAL_ROUNDS) {
    game.round += 1;
  }

  game.statusMessage = `Waiting for ${getPlayerLabel(toRole)} to respond.`;

  sendState(game);
}

function handleAccept(socket) {
  const game = getGameForSocket(socket);
  if (!game) return;
  if (game.finished) {
    send(socket, { type: 'error', message: 'The game is already finished.' });
    return;
  }

  const role = socket.role;
  if (game.turn !== role) {
    send(socket, { type: 'error', message: 'It is not your turn to act.' });
    return;
  }

  if (!game.currentOffer || game.currentOffer.to !== role) {
    send(socket, { type: 'error', message: 'There is no offer for you to accept.' });
    return;
  }

  const { currentOffer } = game;
  const shares = computeShares(currentOffer);
  const discountFactor = Math.pow(DISCOUNT, game.round - 1);

  const player1Value = computeValue(shares.P1, game.players.P1.values);
  const player2Value = computeValue(shares.P2, game.players.P2.values);

  // Log to database
  if (game.dbGameId) {
    db.logAction(game.dbGameId, socket.sessionId, role, 'accept', game.round, {
      discountFactor,
    });

    db.logGameOutcome(
      game.dbGameId,
      'deal',
      game.round,
      role,
      shares.P1,
      shares.P2,
      player1Value * discountFactor,
      player2Value * discountFactor
    );
  }

  game.finished = true;
  game.turn = null;
  game.outcome = {
    type: 'deal',
    round: game.round,
    offer: currentOffer,
    player1Value,
    player2Value,
    player1Discounted: player1Value * discountFactor,
    player2Discounted: player2Value * discountFactor,
    player1Share: shares.P1,
    player2Share: shares.P2,
  };

  addHistoryEntry(game, `Deal reached in round ${game.round}.`);
  game.statusMessage = 'Deal reached!';

  // Update tournament scores if applicable
  if (game.tournamentId) {
    db.updatePlayerScore(game.tournamentId, game.players.P1.sessionId, player1Value * discountFactor);
    db.updatePlayerScore(game.tournamentId, game.players.P2.sessionId, player2Value * discountFactor);
    if (game.tournamentMatchId) {
      db.markMatchCompleted(game.tournamentMatchId);
    }
    checkTournamentCompletion(game.tournamentId);
  }

  sendState(game);
}

function handleWalkAway(socket) {
  const game = getGameForSocket(socket);
  if (!game) return;
  if (game.finished) {
    send(socket, { type: 'error', message: 'The game is already finished.' });
    return;
  }

  const role = socket.role;
  if (game.turn !== role) {
    send(socket, { type: 'error', message: 'It is not your turn to act.' });
    return;
  }

  const discountFactor = Math.pow(DISCOUNT, game.round - 1);
  const p1Payoff = game.players.P1.outside * discountFactor;
  const p2Payoff = game.players.P2.outside * discountFactor;

  // Log to database
  if (game.dbGameId) {
    db.logAction(game.dbGameId, socket.sessionId, role, 'walk', game.round, {
      discountFactor,
    });

    db.logGameOutcome(
      game.dbGameId,
      'walk',
      game.round,
      role,
      null,
      null,
      p1Payoff,
      p2Payoff
    );
  }

  game.finished = true;
  game.turn = null;
  game.outcome = {
    type: 'walk',
    by: role,
    round: game.round,
    player1Discounted: p1Payoff,
    player2Discounted: p2Payoff,
  };

  addHistoryEntry(game, `${getPlayerLabel(role)} walked away in round ${game.round}.`);
  game.statusMessage = `${getPlayerLabel(role)} walked away.`;

  // Update tournament scores if applicable
  if (game.tournamentId) {
    db.updatePlayerScore(game.tournamentId, game.players.P1.sessionId, p1Payoff);
    db.updatePlayerScore(game.tournamentId, game.players.P2.sessionId, p2Payoff);
    if (game.tournamentMatchId) {
      db.markMatchCompleted(game.tournamentMatchId);
    }
    checkTournamentCompletion(game.tournamentId);
  }

  sendState(game);
}

function handleRequestNewGame(socket) {
  const game = getGameForSocket(socket);
  if (!game) return;
  if (!game.players.P1 || !game.players.P2 || !game.players.P1.socket || !game.players.P2.socket) {
    send(socket, { type: 'error', message: 'Both players must be connected to start a new game.' });
    return;
  }

  // For tournament games, don't allow new game - redirect to next match
  if (game.tournamentId) {
    send(socket, { type: 'error', message: 'Tournament games cannot be restarted. Check tournament status for next match.' });
    return;
  }

  startNewMatch(game);
}

// Tournament handlers
function handleCreateTournament(socket, payload = {}) {
  if (!socket.sessionId) {
    send(socket, { type: 'error', message: 'Please register first.' });
    return;
  }

  const name = sanitizeName(payload.name) || 'Tournament';
  const tournamentId = generateGameId();

  db.createTournament(tournamentId, name);
  db.addTournamentPlayer(tournamentId, socket.sessionId, socket.playerName);

  const tournament = {
    id: tournamentId,
    name,
    status: 'pending',
    creatorSessionId: socket.sessionId,
    players: [{ sessionId: socket.sessionId, name: socket.playerName }],
    matches: [],
  };

  tournaments.set(tournamentId, tournament);

  send(socket, {
    type: 'tournamentCreated',
    tournament: sanitizeTournament(tournament),
  });
}

function handleJoinTournament(socket, payload = {}) {
  if (!socket.sessionId) {
    send(socket, { type: 'error', message: 'Please register first.' });
    return;
  }

  const tournamentId = typeof payload.tournamentId === 'string' ? payload.tournamentId.trim().toUpperCase() : '';

  if (!tournamentId) {
    send(socket, { type: 'error', message: 'Enter a valid tournament code.' });
    return;
  }

  let tournament = tournaments.get(tournamentId);
  if (!tournament) {
    // Try loading from database
    const dbTournament = db.getTournamentWithPlayers(tournamentId);
    if (!dbTournament) {
      send(socket, { type: 'error', message: 'Tournament not found.' });
      return;
    }
    tournament = {
      id: dbTournament.id,
      name: dbTournament.name,
      status: dbTournament.status,
      creatorSessionId: null,
      players: dbTournament.players.map(p => ({ sessionId: p.session_id, name: p.display_name })),
      matches: dbTournament.matches,
    };
    tournaments.set(tournamentId, tournament);
  }

  if (tournament.status !== 'pending') {
    send(socket, { type: 'error', message: 'This tournament has already started.' });
    return;
  }

  // Check if already joined
  if (tournament.players.some(p => p.sessionId === socket.sessionId)) {
    send(socket, {
      type: 'tournamentJoined',
      tournament: sanitizeTournament(tournament),
    });
    return;
  }

  db.addTournamentPlayer(tournamentId, socket.sessionId, socket.playerName);
  tournament.players.push({ sessionId: socket.sessionId, name: socket.playerName });

  send(socket, {
    type: 'tournamentJoined',
    tournament: sanitizeTournament(tournament),
  });

  // Notify other players
  broadcastTournamentUpdate(tournament);
}

function handleStartTournament(socket, payload = {}) {
  const tournamentId = typeof payload.tournamentId === 'string' ? payload.tournamentId.trim().toUpperCase() : '';
  const tournament = tournaments.get(tournamentId);

  if (!tournament) {
    send(socket, { type: 'error', message: 'Tournament not found.' });
    return;
  }

  if (tournament.creatorSessionId !== socket.sessionId) {
    send(socket, { type: 'error', message: 'Only the tournament creator can start it.' });
    return;
  }

  if (tournament.status !== 'pending') {
    send(socket, { type: 'error', message: 'Tournament has already started.' });
    return;
  }

  if (tournament.players.length < 2) {
    send(socket, { type: 'error', message: 'Need at least 2 players to start.' });
    return;
  }

  if (tournament.players.length % 2 !== 0) {
    send(socket, { type: 'error', message: 'Need an even number of players.' });
    return;
  }

  // Generate round-robin schedule
  const schedule = generateRoundRobinSchedule(tournament.players.map(p => p.sessionId));

  let roundNumber = 1;
  for (const round of schedule) {
    for (const match of round) {
      const matchId = uuidv4();
      db.addTournamentMatch(matchId, tournamentId, roundNumber, match.player1, match.player2);
      tournament.matches.push({
        id: matchId,
        roundNumber,
        player1SessionId: match.player1,
        player2SessionId: match.player2,
        status: 'pending',
      });
    }
    roundNumber++;
  }

  tournament.status = 'active';
  db.startTournament(tournamentId);

  broadcastTournamentUpdate(tournament);
}

function handleGetTournamentStatus(socket, payload = {}) {
  const tournamentId = typeof payload.tournamentId === 'string' ? payload.tournamentId.trim().toUpperCase() : '';

  let tournament = tournaments.get(tournamentId);
  if (!tournament) {
    const dbTournament = db.getTournamentWithPlayers(tournamentId);
    if (!dbTournament) {
      send(socket, { type: 'error', message: 'Tournament not found.' });
      return;
    }
    tournament = {
      id: dbTournament.id,
      name: dbTournament.name,
      status: dbTournament.status,
      creatorSessionId: null,
      players: dbTournament.players.map(p => ({
        sessionId: p.session_id,
        name: p.display_name,
        totalPayoff: p.total_payoff,
        gamesPlayed: p.games_played,
      })),
      matches: dbTournament.matches.map(m => ({
        id: m.id,
        roundNumber: m.round_number,
        player1SessionId: m.player1_session_id,
        player2SessionId: m.player2_session_id,
        status: m.status,
      })),
    };
    tournaments.set(tournamentId, tournament);
  }

  send(socket, {
    type: 'tournamentStatus',
    tournament: sanitizeTournament(tournament),
  });
}

function handleReadyForMatch(socket, payload = {}) {
  const tournamentId = typeof payload.tournamentId === 'string' ? payload.tournamentId.trim().toUpperCase() : '';
  const tournament = tournaments.get(tournamentId);

  if (!tournament || tournament.status !== 'active') {
    send(socket, { type: 'error', message: 'Tournament not active.' });
    return;
  }

  // Find the next pending match for this player
  const nextMatch = tournament.matches.find(m =>
    m.status === 'pending' &&
    (m.player1SessionId === socket.sessionId || m.player2SessionId === socket.sessionId)
  );

  if (!nextMatch) {
    send(socket, { type: 'tournamentWaiting', message: 'No matches available. Waiting for other games to complete.' });
    return;
  }

  // Check if opponent is also ready (connected)
  const opponentSessionId = nextMatch.player1SessionId === socket.sessionId
    ? nextMatch.player2SessionId
    : nextMatch.player1SessionId;
  const opponentSocket = sessionSockets.get(opponentSessionId);

  if (!opponentSocket || opponentSocket.readyState !== WebSocket.OPEN) {
    send(socket, { type: 'tournamentWaiting', message: 'Waiting for opponent to connect...' });
    return;
  }

  // Both players ready - start the match
  startTournamentMatch(tournament, nextMatch);
}

function startTournamentMatch(tournament, match) {
  const p1Socket = sessionSockets.get(match.player1SessionId);
  const p2Socket = sessionSockets.get(match.player2SessionId);

  if (!p1Socket || !p2Socket) {
    return;
  }

  const gameId = generateGameId();

  const p1Player = tournament.players.find(p => p.sessionId === match.player1SessionId);
  const p2Player = tournament.players.find(p => p.sessionId === match.player2SessionId);
  const p1Name = p1Player && p1Player.name ? p1Player.name : 'Player 1';
  const p2Name = p2Player && p2Player.name ? p2Player.name : 'Player 2';

  const game = {
    id: gameId,
    dbGameId: null,
    tournamentId: tournament.id,
    tournamentMatchId: match.id,
    round: 1,
    turn: null,
    currentOffer: null,
    history: [],
    finished: false,
    outcome: null,
    statusMessage: 'Starting tournament match...',
    players: {
      P1: {
        socket: p1Socket,
        sessionId: match.player1SessionId,
        name: p1Name,
        values: null,
        outside: null,
      },
      P2: {
        socket: p2Socket,
        sessionId: match.player2SessionId,
        name: p2Name,
        values: null,
        outside: null,
      },
    },
  };

  games.set(gameId, game);

  p1Socket.gameId = gameId;
  p1Socket.role = 'P1';
  p2Socket.gameId = gameId;
  p2Socket.role = 'P2';

  match.status = 'active';
  db.markMatchActive(match.id, gameId);

  send(p1Socket, {
    type: 'tournamentMatchStart',
    gameId,
    role: 'P1',
    opponent: p2Name,
    tournamentId: tournament.id,
    roundNumber: match.roundNumber,
  });

  send(p2Socket, {
    type: 'tournamentMatchStart',
    gameId,
    role: 'P2',
    opponent: p1Name,
    tournamentId: tournament.id,
    roundNumber: match.roundNumber,
  });

  startNewMatch(game);
}

function checkTournamentCompletion(tournamentId) {
  const tournament = tournaments.get(tournamentId);
  if (!tournament) return;

  const allCompleted = tournament.matches.every(m => m.status === 'completed');
  if (allCompleted) {
    tournament.status = 'completed';
    db.completeTournament(tournamentId);
    broadcastTournamentUpdate(tournament);
  }
}

function broadcastTournamentUpdate(tournament) {
  const msg = {
    type: 'tournamentUpdate',
    tournament: sanitizeTournament(tournament),
  };

  for (const player of tournament.players) {
    const sock = sessionSockets.get(player.sessionId);
    if (sock && sock.readyState === WebSocket.OPEN) {
      send(sock, msg);
    }
  }
}

function sanitizeTournament(tournament) {
  // Refresh standings from database
  const dbTournament = db.getTournamentWithPlayers(tournament.id);
  const standings = dbTournament && dbTournament.players ? dbTournament.players : [];

  return {
    id: tournament.id,
    name: tournament.name,
    status: tournament.status,
    playerCount: tournament.players.length,
    players: tournament.players.map(p => {
      const dbPlayer = standings.find(s => s.session_id === p.sessionId);
      return {
        name: p.name,
        totalPayoff: dbPlayer && dbPlayer.total_payoff ? dbPlayer.total_payoff : 0,
        gamesPlayed: dbPlayer && dbPlayer.games_played ? dbPlayer.games_played : 0,
      };
    }),
    matches: tournament.matches.map(m => {
      const p1 = tournament.players.find(p => p.sessionId === m.player1SessionId);
      const p2 = tournament.players.find(p => p.sessionId === m.player2SessionId);
      return {
        roundNumber: m.roundNumber,
        player1: p1 && p1.name ? p1.name : 'Unknown',
        player2: p2 && p2.name ? p2.name : 'Unknown',
        status: m.status,
      };
    }),
  };
}

function generateRoundRobinSchedule(playerIds) {
  const players = [...playerIds];
  const n = players.length;
  const rounds = [];

  // For n players, need n-1 rounds
  const numRounds = n - 1;
  for (let round = 0; round < numRounds; round++) {
    const matches = [];
    for (let i = 0; i < n / 2; i++) {
      const p1 = players[i];
      const p2 = players[n - 1 - i];
      matches.push({ player1: p1, player2: p2 });
    }
    rounds.push(matches);

    // Rotate players (keep first player fixed)
    const last = players.pop();
    players.splice(1, 0, last);
  }

  return rounds;
}

function startNewMatch(game) {
  game.round = 1;
  game.turn = 'P1';
  game.currentOffer = null;
  game.history = [];
  game.finished = false;
  game.outcome = null;
  game.statusMessage = `Waiting for ${getPlayerLabel('P1')} to make an opening offer.`;

  assignPrivateInfo(game.players.P1);
  assignPrivateInfo(game.players.P2);

  // Log game start to database
  const dbGameId = uuidv4();
  game.dbGameId = dbGameId;

  db.logGameStart(
    dbGameId,
    game.tournamentId,
    game.players.P1.sessionId,
    game.players.P2.sessionId,
    game.players.P1.name,
    game.players.P2.name,
    game.players.P1.values,
    game.players.P2.values,
    game.players.P1.outside,
    game.players.P2.outside
  );

  sendState(game);
}

function sendState(game) {
  const baseState = {
    gameId: game.id,
    round: game.round,
    totalRounds: TOTAL_ROUNDS,
    discount: DISCOUNT,
    items: ITEMS,
    turn: game.turn,
    history: game.history,
    currentOffer: game.currentOffer,
    finished: game.finished,
    outcome: game.outcome,
    statusMessage: game.statusMessage,
    tournamentId: game.tournamentId || null,
    players: {
      P1: game.players.P1 ? { name: game.players.P1.name } : null,
      P2: game.players.P2 ? { name: game.players.P2.name } : null,
    },
  };

  const p1 = game.players.P1;
  if (p1 && p1.socket) {
    send(p1.socket, {
      type: 'state',
      state: baseState,
      you: {
        role: 'P1',
        name: p1.name,
        values: p1.values,
        outside: p1.outside,
      },
      opponent: game.finished && game.players.P2
        ? {
            role: 'P2',
            name: game.players.P2.name,
            values: game.players.P2.values,
            outside: game.players.P2.outside,
          }
        : null,
    });
  }

  const p2 = game.players.P2;
  if (p2 && p2.socket) {
    send(p2.socket, {
      type: 'state',
      state: baseState,
      you: {
        role: 'P2',
        name: p2.name,
        values: p2.values,
        outside: p2.outside,
      },
      opponent: game.finished && game.players.P1
        ? {
            role: 'P1',
            name: game.players.P1.name,
            values: game.players.P1.values,
            outside: game.players.P1.outside,
          }
        : null,
    });
  }
}

function addHistoryEntry(game, message) {
  game.history = [message, ...game.history].slice(0, 50);
}

function assignPrivateInfo(player) {
  if (!player) return;
  const values = ITEMS.map(() => randomInt(5, 100));
  const totalValue = computeValue(
    ITEMS.map((item) => item.total),
    values,
  );
  const outside = randomInt(10, Math.max(10, Math.round(totalValue)));

  player.values = values;
  player.outside = outside;
}

function computeShares(offer) {
  if (offer.from === 'P1') {
    return {
      P1: ITEMS.map((item, idx) => item.total - offer.quantities[idx]),
      P2: offer.quantities.slice(),
    };
  }

  return {
    P1: offer.quantities.slice(),
    P2: ITEMS.map((item, idx) => item.total - offer.quantities[idx]),
  };
}

function computeValue(quantities, values) {
  return quantities.reduce((sum, qty, idx) => sum + qty * values[idx], 0);
}

function formatQuantities(quantities) {
  return quantities
    .map((qty, idx) => `${qty} × ${ITEMS[idx].name}`)
    .join(', ');
}

function getGameForSocket(socket) {
  const { gameId, role } = socket;
  if (!gameId || !role) {
    send(socket, { type: 'error', message: 'You are not part of an active game.' });
    return null;
  }

  const game = games.get(gameId);
  if (!game) {
    send(socket, { type: 'error', message: 'Game session not found.' });
    return null;
  }

  return game;
}

function getPlayerLabel(role) {
  return role === 'P1' ? 'Player 1' : 'Player 2';
}

function generateGameId() {
  const characters = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => characters.charAt(Math.floor(Math.random() * characters.length))).join('');
  } while (games.has(code) || tournaments.has(code));
  return code;
}

function sanitizeName(name) {
  if (typeof name !== 'string') return '';
  return name.trim().slice(0, 20) || '';
}

function randomInt(min, max) {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

// Graceful shutdown
function shutdown() {
  console.log('Shutting down gracefully...');

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'serverShutdown', message: 'Server is restarting.' }));
      client.close();
    }
  });

  db.close();

  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.log('Forcing exit.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
