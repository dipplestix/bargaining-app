const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8000;

const TOTAL_ROUNDS = 4;
const DISCOUNT = 0.95;
const ITEMS = [
  { name: 'Item 1', total: 7 },
  { name: 'Item 2', total: 4 },
  { name: 'Item 3', total: 1 },
];

const app = express();
app.use(express.static(path.join(__dirname)));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const games = new Map();
const HISTORY_FILE = path.join(__dirname, 'data', 'game-history.json');

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
      case 'createGame':
        handleCreateGame(socket, payload);
        break;
      case 'joinGame':
        handleJoinGame(socket, payload);
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
      default:
        send(socket, { type: 'error', message: 'Unknown message type.' });
    }
  });

  socket.on('close', () => {
    const { gameId, role } = socket;
    if (!gameId || !role) return;
    const game = games.get(gameId);
    if (!game) return;

    if (game.players[role]) {
      game.players[role].socket = null;
    }

    const otherRole = role === 'P1' ? 'P2' : 'P1';
    const otherPlayer = game.players[otherRole];
    if (otherPlayer && otherPlayer.socket) {
      game.statusMessage = `${getPlayerLabel(role)} disconnected.`;
      game.finished = true;
      game.turn = null;
      game.outcome = {
        type: 'disconnect',
        by: role,
        round: game.round,
      };
      send(otherPlayer.socket, {
        type: 'opponentLeft',
        message: `${getPlayerLabel(role)} disconnected. The match has ended.`,
      });
      sendState(game);
      persistGameHistory(game);
    }

    games.delete(gameId);
  });
});

function handleCreateGame(socket, payload = {}) {
  const name = sanitizeName(payload.name) || 'Player 1';
  const gameId = generateGameId();

  const game = {
    id: gameId,
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
  const gameId = typeof payload.gameId === 'string' ? payload.gameId.trim().toUpperCase() : '';
  const name = sanitizeName(payload.name) || 'Player 2';

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

  sendState(game);
  persistGameHistory(game);
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

  game.finished = true;
  game.turn = null;
  game.outcome = {
    type: 'walk',
    by: role,
    round: game.round,
    player1Discounted: game.players.P1.outside * discountFactor,
    player2Discounted: game.players.P2.outside * discountFactor,
  };

  addHistoryEntry(game, `${getPlayerLabel(role)} walked away in round ${game.round}.`);
  game.statusMessage = `${getPlayerLabel(role)} walked away.`;

  sendState(game);
  persistGameHistory(game);
}

function handleRequestNewGame(socket) {
  const game = getGameForSocket(socket);
  if (!game) return;
  if (!game.players.P1 || !game.players.P2 || !game.players.P1.socket || !game.players.P2.socket) {
    send(socket, { type: 'error', message: 'Both players must be connected to start a new game.' });
    return;
  }

  startNewMatch(game);
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

function persistGameHistory(game) {
  if (!game || !game.finished) {
    return;
  }

  const record = {
    id: game.id,
    finishedAt: new Date().toISOString(),
    round: game.round,
    config: {
      totalRounds: TOTAL_ROUNDS,
      discount: DISCOUNT,
      items: ITEMS,
    },
    history: [...game.history].reverse(),
    outcome: game.outcome,
    players: {
      P1: game.players.P1
        ? {
            name: game.players.P1.name,
            values: game.players.P1.values,
            outside: game.players.P1.outside,
          }
        : null,
      P2: game.players.P2
        ? {
            name: game.players.P2.name,
            values: game.players.P2.values,
            outside: game.players.P2.outside,
          }
        : null,
    },
  };

  const dir = path.dirname(HISTORY_FILE);
  fs.promises
    .mkdir(dir, { recursive: true })
    .then(() => fs.promises.readFile(HISTORY_FILE, 'utf8'))
    .catch((error) => {
      if (error.code === 'ENOENT') {
        return '[]';
      }
      throw error;
    })
    .then((contents) => {
      let existing = [];
      try {
        existing = JSON.parse(contents);
        if (!Array.isArray(existing)) {
          existing = [];
        }
      } catch (parseError) {
        console.error('Failed to parse existing history file, starting fresh.', parseError);
        existing = [];
      }
      existing.push(record);
      return fs.promises.writeFile(HISTORY_FILE, JSON.stringify(existing, null, 2));
    })
    .catch((error) => {
      console.error('Failed to persist game history.', error);
    });
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
  } while (games.has(code));
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

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
