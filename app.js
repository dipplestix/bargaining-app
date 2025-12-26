const state = {
  socket: null,
  sessionId: null,
  role: null,
  gameId: null,
  config: null,
  publicState: null,
  privateInfo: null,
  opponentInfo: null,
  inQueue: false,
  tournament: null,
  mode: null, // 'quick', 'private', 'tournament'
};

document.addEventListener('DOMContentLoaded', () => {
  const lobbyStatusEl = document.getElementById('lobby-status');
  const nameInput = document.getElementById('player-name');
  const gameIdInput = document.getElementById('game-id');
  const createBtn = document.getElementById('create-game');
  const joinBtn = document.getElementById('join-game');
  const lobbyCard = document.getElementById('connection-card');

  // Mode selection elements
  const modeSelection = document.getElementById('mode-selection');
  const quickMatchBtn = document.getElementById('quick-match');
  const privateGameBtn = document.getElementById('private-game');
  const tournamentModeBtn = document.getElementById('tournament-mode');
  const backToModeBtn = document.getElementById('back-to-mode');

  // Queue elements
  const queueStatus = document.getElementById('queue-status');
  const queuePositionEl = document.getElementById('queue-position');
  const leaveQueueBtn = document.getElementById('leave-queue');

  // Private game elements
  const privateGamePanel = document.getElementById('private-game-panel');

  // Tournament elements
  const tournamentPanel = document.getElementById('tournament-panel');
  const tournamentNameInput = document.getElementById('tournament-name');
  const createTournamentBtn = document.getElementById('create-tournament');
  const tournamentCodeInput = document.getElementById('tournament-code');
  const joinTournamentBtn = document.getElementById('join-tournament');
  const tournamentLobby = document.getElementById('tournament-lobby');
  const tournamentIdEl = document.getElementById('tournament-id');
  const tournamentStatusEl = document.getElementById('tournament-status-text');
  const tournamentPlayersEl = document.getElementById('tournament-players');
  const startTournamentBtn = document.getElementById('start-tournament');
  const readyForMatchBtn = document.getElementById('ready-for-match');
  const tournamentStandings = document.getElementById('tournament-standings');
  const standingsBody = document.getElementById('standings-body');
  const tournamentMatches = document.getElementById('tournament-matches');
  const matchesBody = document.getElementById('matches-body');
  const backFromTournamentBtn = document.getElementById('back-from-tournament');

  const roundEl = document.getElementById('round');
  const turnEl = document.getElementById('turn');
  const statusMessageEl = document.getElementById('status-message');
  const historyListEl = document.getElementById('history-list');
  const currentOfferEl = document.getElementById('current-offer');
  const summaryEl = document.getElementById('summary');
  const playerValuesEl = document.getElementById('player-values');
  const outsideOfferEl = document.getElementById('player-outside');
  const opponentCard = document.getElementById('opponent-card');
  const opponentValuesEl = document.getElementById('opponent-values');
  const opponentOutsideEl = document.getElementById('opponent-outside');
  const offerForm = document.getElementById('offer-form');
  const walkAwayBtn = document.getElementById('walk-away');
  const acceptBtn = document.getElementById('accept-offer');
  const submitOfferBtn = document.getElementById('submit-offer');
  const newGameBtn = document.getElementById('new-game');
  const totalRoundsEl = document.getElementById('total-rounds');
  const totalRoundsStatusEl = document.getElementById('total-rounds-status');
  const discountRateEl = document.getElementById('discount-rate');
  const itemsListEl = document.getElementById('items-list');
  const roleLabelEl = document.getElementById('player-role');
  const gameCodeEl = document.getElementById('status-game-code');
  const lobbyHelperEl = document.getElementById('lobby-helper');
  const gamePanel = document.querySelector('.game-panel');

  const offerInputs = [
    document.getElementById('offer-item-1'),
    document.getElementById('offer-item-2'),
    document.getElementById('offer-item-3'),
  ];

  // Load saved session and name
  const savedSessionId = localStorage.getItem('bargaining_session_id');
  const savedName = localStorage.getItem('bargaining_player_name');
  if (savedName) {
    nameInput.value = savedName;
  }

  connectSocket();

  // Mode selection handlers
  if (quickMatchBtn) {
    quickMatchBtn.addEventListener('click', () => {
      if (!ensureRegistered()) return;
      state.mode = 'quick';
      showPanel('queue');
      state.socket.send(JSON.stringify({ type: 'joinQueue' }));
    });
  }

  if (privateGameBtn) {
    privateGameBtn.addEventListener('click', () => {
      state.mode = 'private';
      showPanel('private');
    });
  }

  if (tournamentModeBtn) {
    tournamentModeBtn.addEventListener('click', () => {
      state.mode = 'tournament';
      showPanel('tournament');
    });
  }

  if (backToModeBtn) {
    backToModeBtn.addEventListener('click', () => {
      showPanel('mode');
    });
  }

  if (leaveQueueBtn) {
    leaveQueueBtn.addEventListener('click', () => {
      state.socket.send(JSON.stringify({ type: 'leaveQueue' }));
      state.inQueue = false;
      showPanel('mode');
    });
  }

  // Tournament handlers
  if (createTournamentBtn) {
    createTournamentBtn.addEventListener('click', () => {
      if (!ensureRegistered()) return;
      const name = tournamentNameInput.value.trim() || 'Tournament';
      state.socket.send(JSON.stringify({
        type: 'createTournament',
        payload: { name }
      }));
    });
  }

  if (joinTournamentBtn) {
    joinTournamentBtn.addEventListener('click', () => {
      if (!ensureRegistered()) return;
      const code = tournamentCodeInput.value.trim().toUpperCase();
      if (!code) {
        showLobbyStatus('Enter a tournament code.', true);
        return;
      }
      state.socket.send(JSON.stringify({
        type: 'joinTournament',
        payload: { tournamentId: code }
      }));
    });
  }

  if (startTournamentBtn) {
    startTournamentBtn.addEventListener('click', () => {
      if (!state.tournament) return;
      state.socket.send(JSON.stringify({
        type: 'startTournament',
        payload: { tournamentId: state.tournament.id }
      }));
    });
  }

  if (readyForMatchBtn) {
    readyForMatchBtn.addEventListener('click', () => {
      if (!state.tournament) return;
      state.socket.send(JSON.stringify({
        type: 'readyForMatch',
        payload: { tournamentId: state.tournament.id }
      }));
    });
  }

  if (backFromTournamentBtn) {
    backFromTournamentBtn.addEventListener('click', () => {
      state.tournament = null;
      showPanel('mode');
    });
  }

  // Private game handlers
  createBtn.addEventListener('click', () => {
    if (!ensureRegistered()) return;
    disableLobbyButtons();
    state.socket.send(
      JSON.stringify({
        type: 'createGame',
        payload: { name: nameInput.value.trim() },
      }),
    );
  });

  joinBtn.addEventListener('click', () => {
    if (!ensureRegistered()) return;
    const gameCode = gameIdInput.value.trim().toUpperCase();
    if (!gameCode) {
      showLobbyStatus('Enter a game code to join.', true);
      return;
    }

    disableLobbyButtons();
    state.socket.send(
      JSON.stringify({
        type: 'joinGame',
        payload: { name: nameInput.value.trim(), gameId: gameCode },
      }),
    );
  });

  offerForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!canAct()) return;

    const quantities = offerInputs.map((input) => Number.parseInt(input.value, 10) || 0);
    if (!validateOffer(quantities)) {
      showStatus('Offer must be whole numbers within the available quantities.', true);
      return;
    }

    state.socket.send(
      JSON.stringify({
        type: 'makeOffer',
        payload: { quantities },
      }),
    );
    offerInputs.forEach((input) => {
      input.value = '';
    });
  });

  acceptBtn.addEventListener('click', () => {
    if (!canAccept()) return;
    state.socket.send(JSON.stringify({ type: 'acceptOffer' }));
  });

  walkAwayBtn.addEventListener('click', () => {
    if (!canAct()) return;
    state.socket.send(JSON.stringify({ type: 'walkAway' }));
  });

  newGameBtn.addEventListener('click', () => {
    if (!state.publicState || !state.publicState.finished) return;

    // If this was a tournament game, go back to tournament lobby
    if (state.publicState.tournamentId) {
      state.socket.send(JSON.stringify({
        type: 'getTournamentStatus',
        payload: { tournamentId: state.publicState.tournamentId }
      }));
      return;
    }

    state.socket.send(JSON.stringify({ type: 'requestNewGame' }));
  });

  // Name input saves to localStorage
  nameInput.addEventListener('change', () => {
    localStorage.setItem('bargaining_player_name', nameInput.value.trim());
  });

  function connectSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${window.location.host}`);
    state.socket = socket;

    socket.addEventListener('open', () => {
      showLobbyStatus('Connected. Registering...');
      // Register with session
      const name = nameInput.value.trim() || 'Anonymous';
      socket.send(JSON.stringify({
        type: 'register',
        payload: {
          sessionId: savedSessionId || null,
          name: name
        }
      }));
    });

    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        console.error('Invalid message from server', error);
        return;
      }

      switch (message.type) {
        case 'registered':
          handleRegistered(message);
          break;
        case 'error':
          showLobbyStatus(message.message, true);
          enableLobbyButtons();
          break;
        case 'lobby':
          handleLobbyMessage(message);
          enableLobbyButtons();
          break;
        case 'state':
          handleStateMessage(message);
          break;
        case 'opponentLeft':
          showStatus(message.message, true);
          break;
        case 'queueStatus':
          handleQueueStatus(message);
          break;
        case 'matchFound':
          handleMatchFound(message);
          break;
        case 'tournamentCreated':
        case 'tournamentJoined':
        case 'tournamentUpdate':
        case 'tournamentStatus':
          handleTournamentUpdate(message);
          break;
        case 'tournamentMatchStart':
          handleTournamentMatchStart(message);
          break;
        case 'tournamentWaiting':
          showLobbyStatus(message.message);
          break;
        case 'serverShutdown':
          showLobbyStatus('Server is restarting. Please refresh the page.', true);
          break;
        default:
          break;
      }
    });

    socket.addEventListener('close', () => {
      showLobbyStatus('Connection lost. Refresh the page to reconnect.', true);
      disableLobbyButtons();
      disableGameInputs();
    });

    socket.addEventListener('error', () => {
      showLobbyStatus('WebSocket error occurred.', true);
    });
  }

  function ensureRegistered() {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
      showLobbyStatus('Connecting... please wait.', true);
      return false;
    }
    if (!state.sessionId) {
      showLobbyStatus('Registering... please wait.', true);
      return false;
    }
    return true;
  }

  function handleRegistered(message) {
    state.sessionId = message.sessionId;
    localStorage.setItem('bargaining_session_id', message.sessionId);
    showLobbyStatus(`Welcome, ${message.name}! Choose a game mode.`);
    enableLobbyButtons();
    showPanel('mode');
  }

  function handleQueueStatus(message) {
    state.inQueue = message.waiting;
    if (queuePositionEl) {
      queuePositionEl.textContent = message.position || 1;
    }
    if (message.waiting) {
      showPanel('queue');
    }
  }

  function handleMatchFound(message) {
    state.inQueue = false;
    state.gameId = message.gameId;
    state.role = message.role;
    showLobbyStatus(`Match found! Playing against ${message.opponent}`);
    showPanel('game');
  }

  function handleTournamentUpdate(message) {
    state.tournament = message.tournament;
    updateTournamentUI();
    showPanel('tournament-lobby');
  }

  function handleTournamentMatchStart(message) {
    state.gameId = message.gameId;
    state.role = message.role;
    showLobbyStatus(`Tournament match starting! Round ${message.roundNumber} vs ${message.opponent}`);
    showPanel('game');
  }

  function updateTournamentUI() {
    if (!state.tournament) return;

    if (tournamentIdEl) {
      tournamentIdEl.textContent = state.tournament.id;
    }
    if (tournamentStatusEl) {
      tournamentStatusEl.textContent = state.tournament.status;
    }
    if (tournamentPlayersEl) {
      tournamentPlayersEl.innerHTML = state.tournament.players
        .map(p => {
          const payoff = p.totalPayoff ? p.totalPayoff.toFixed(2) : '0.00';
          return `<li>${p.name} - ${payoff} pts (${p.gamesPlayed || 0} games)</li>`;
        })
        .join('');
    }

    // Show/hide start button based on status and if creator
    if (startTournamentBtn) {
      const canStart = state.tournament.status === 'pending' && state.tournament.playerCount >= 2;
      startTournamentBtn.disabled = !canStart;
      startTournamentBtn.classList.toggle('hidden', state.tournament.status !== 'pending');
    }

    if (readyForMatchBtn) {
      readyForMatchBtn.classList.toggle('hidden', state.tournament.status !== 'active');
    }

    if (backFromTournamentBtn) {
      backFromTournamentBtn.classList.toggle('hidden', state.tournament.status === 'active');
    }

    // Show standings
    if (standingsBody && state.tournament.players) {
      const sorted = [...state.tournament.players].sort((a, b) => (b.totalPayoff || 0) - (a.totalPayoff || 0));
      standingsBody.innerHTML = sorted.map((p, idx) => `
        <tr>
          <td>${idx + 1}</td>
          <td>${p.name}</td>
          <td>${(p.totalPayoff || 0).toFixed(2)}</td>
          <td>${p.gamesPlayed || 0}</td>
        </tr>
      `).join('');
    }

    // Show matches
    if (matchesBody && state.tournament.matches) {
      matchesBody.innerHTML = state.tournament.matches.map(m => `
        <tr>
          <td>${m.roundNumber}</td>
          <td>${m.player1} vs ${m.player2}</td>
          <td>${m.status}</td>
        </tr>
      `).join('');
    }

    if (tournamentStandings) {
      tournamentStandings.classList.toggle('hidden', state.tournament.status === 'pending');
    }
    if (tournamentMatches) {
      tournamentMatches.classList.toggle('hidden', state.tournament.status === 'pending');
    }
  }

  function showPanel(panel) {
    // Hide all panels
    if (modeSelection) modeSelection.classList.add('hidden');
    if (queueStatus) queueStatus.classList.add('hidden');
    if (privateGamePanel) privateGamePanel.classList.add('hidden');
    if (tournamentPanel) tournamentPanel.classList.add('hidden');
    if (tournamentLobby) tournamentLobby.classList.add('hidden');
    if (gamePanel) gamePanel.classList.add('hidden');

    // Show requested panel
    switch (panel) {
      case 'mode':
        if (modeSelection) modeSelection.classList.remove('hidden');
        break;
      case 'queue':
        if (queueStatus) queueStatus.classList.remove('hidden');
        break;
      case 'private':
        if (privateGamePanel) privateGamePanel.classList.remove('hidden');
        break;
      case 'tournament':
        if (tournamentPanel) tournamentPanel.classList.remove('hidden');
        break;
      case 'tournament-lobby':
        if (tournamentLobby) tournamentLobby.classList.remove('hidden');
        break;
      case 'game':
        if (gamePanel) gamePanel.classList.remove('hidden');
        break;
    }
  }

  function handleLobbyMessage(message) {
    if (message.gameId) {
      state.gameId = message.gameId;
      gameIdInput.value = message.gameId;
      gameCodeEl.textContent = message.gameId;
    }
    if (message.role) {
      state.role = message.role;
      updateRoleLabel();
    }
    if (message.message) {
      showLobbyStatus(message.message);
    }

    if (state.role && lobbyCard) {
      lobbyCard.classList.add('connected');
      if (lobbyHelperEl) {
        lobbyHelperEl.textContent = 'Share this code with your opponent to play together.';
      }
      showPanel('game');
    }
  }

  function handleStateMessage(message) {
    state.publicState = message.state;
    state.privateInfo = message.you;
    state.opponentInfo = message.opponent || null;
    state.gameId = message.state.gameId;
    if (!state.role && message.you && message.you.role) {
      state.role = message.you.role;
    }

    if (!state.config) {
      state.config = {
        items: message.state.items,
        totalRounds: message.state.totalRounds,
        discount: message.state.discount,
      };
      renderStaticConfig();
    }

    updateRoleLabel();
    updateGameCode();
    showPanel('game');
    updatePlayerInfo();
    renderHistory();
    renderCurrentOffer();
    renderSummary();
    updateStatusBar();
    updateOpponentInfo();
    updateActionControls();
  }

  function renderStaticConfig() {
    if (!state.config) return;
    totalRoundsEl.textContent = state.config.totalRounds;
    if (totalRoundsStatusEl) {
      totalRoundsStatusEl.textContent = state.config.totalRounds;
    }
    discountRateEl.textContent = state.config.discount.toFixed(2);
    itemsListEl.innerHTML = state.config.items
      .map((item) => `<li>${item.total} × ${item.name}</li>`)
      .join('');
    offerInputs.forEach((input, idx) => {
      const item = state.config.items[idx];
      if (item) {
        input.max = item.total;
      }
    });
  }

  function updateRoleLabel() {
    if (!roleLabelEl) return;
    if (!state.role || !state.privateInfo) {
      roleLabelEl.textContent = 'Not connected';
      return;
    }
    const playerName = state.privateInfo.name || (state.role === 'P1' ? 'Player 1' : 'Player 2');
    roleLabelEl.textContent = `${state.role === 'P1' ? 'Player 1' : 'Player 2'} (${playerName})`;
  }

  function updateGameCode() {
    if (!gameCodeEl) return;
    gameCodeEl.textContent = state.gameId || '—';
  }

  function updatePlayerInfo() {
    if (!state.privateInfo) return;
    const values = state.privateInfo.values || [];
    if (!values.length) {
      playerValuesEl.innerHTML = '<li class="muted-text">Waiting for the negotiation to start...</li>';
    } else {
      playerValuesEl.innerHTML = values
        .map((value, idx) => `<li>${state.config.items[idx].name}: <strong>${value}</strong> value per unit</li>`)
        .join('');
    }
    outsideOfferEl.textContent = state.privateInfo.outside ?? '—';
  }

  function renderHistory() {
    if (!state.publicState) return;
    historyListEl.innerHTML = state.publicState.history
      .map((entry) => `<li>${entry}</li>`)
      .join('');
  }

  function renderCurrentOffer() {
    if (!state.publicState) return;
    const currentOffer = state.publicState.currentOffer;
    if (!currentOffer) {
      currentOfferEl.innerHTML = '';
      return;
    }

    const heading = currentOffer.from === state.role ? 'Offer you made' : 'Offer to you';
    const description = formatQuantities(currentOffer.quantities);
    const yourShare = getShareFor(state.role, currentOffer);
    const yourValue = computeValue(yourShare, state.privateInfo.values || []);
    const discounted = yourValue * Math.pow(state.config.discount, (state.publicState.round || 1) - 1);

    currentOfferEl.innerHTML = `
      <h3>${heading}</h3>
      <p>${getPlayerLabel(currentOffer.from)} proposes ${description}.</p>
      <p>Your share if accepted: ${formatQuantities(yourShare)}</p>
      <p>Your undiscounted value: <strong>${yourValue.toFixed(2)}</strong></p>
      <p>Your discounted payoff this round: <strong>${discounted.toFixed(2)}</strong></p>
    `;
  }

  function renderSummary() {
    if (!state.publicState || !state.publicState.finished || !state.publicState.outcome) {
      summaryEl.innerHTML = '';
      return;
    }

    const outcome = state.publicState.outcome;
    const discountFactor = Math.pow(state.config.discount, (outcome.round || 1) - 1).toFixed(4);
    const players = state.publicState.players || {};

    let tournamentNote = '';
    if (state.publicState.tournamentId) {
      tournamentNote = '<p class="muted-text">This was a tournament match. Click "Next Match" to continue.</p>';
    }

    if (outcome.type === 'deal') {
      summaryEl.innerHTML = `
        <h2>Outcome</h2>
        <p class="outcome-success">Deal reached in round ${outcome.round} (discount factor ${discountFactor}).</p>
        <table class="summary-table">
          <thead>
            <tr>
              <th></th>
              <th>${labelWithName('P1', players.P1)}</th>
              <th>${labelWithName('P2', players.P2)}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>Units received</th>
              <td>${formatQuantities(outcome.player1Share)}</td>
              <td>${formatQuantities(outcome.player2Share)}</td>
            </tr>
            <tr>
              <th>Undiscounted value</th>
              <td>${outcome.player1Value.toFixed(2)}</td>
              <td>${outcome.player2Value.toFixed(2)}</td>
            </tr>
            <tr>
              <th>Discounted payoff</th>
              <td>${outcome.player1Discounted.toFixed(2)}</td>
              <td>${outcome.player2Discounted.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
        ${tournamentNote}
      `;
    } else {
      const walker = getPlayerLabel(outcome.by);
      summaryEl.innerHTML = `
        <h2>Outcome</h2>
        <p class="outcome-fail">${walker} walked away in round ${outcome.round} (discount factor ${discountFactor}).</p>
        <p>Discounted payoffs:</p>
        <ul>
          <li>${labelWithName('P1', players.P1)}: ${outcome.player1Discounted.toFixed(2)} (outside offer)</li>
          <li>${labelWithName('P2', players.P2)}: ${outcome.player2Discounted.toFixed(2)} (outside offer)</li>
        </ul>
        ${tournamentNote}
      `;
    }
  }

  function updateStatusBar() {
    if (!state.publicState) {
      roundEl.textContent = '—';
      turnEl.textContent = '—';
      statusMessageEl.textContent = 'Not connected.';
      statusMessageEl.classList.toggle('outcome-fail', false);
      return;
    }

    roundEl.textContent = state.publicState.round ?? '—';
    turnEl.textContent = state.publicState.turn
      ? labelWithName(state.publicState.turn, state.publicState.players[state.publicState.turn])
      : '—';
    statusMessageEl.textContent = state.publicState.statusMessage || '';
    statusMessageEl.classList.toggle('outcome-fail', false);
  }

  function updateOpponentInfo() {
    if (!opponentCard) return;
    if (!state.publicState || !state.publicState.finished || !state.opponentInfo) {
      opponentCard.classList.add('hidden');
      opponentValuesEl.innerHTML = '';
      opponentOutsideEl.textContent = '';
      return;
    }

    opponentCard.classList.remove('hidden');
    opponentValuesEl.innerHTML = state.opponentInfo.values
      .map((value, idx) => `<li>${state.config.items[idx].name}: <strong>${value}</strong> value per unit</li>`)
      .join('');
    opponentOutsideEl.textContent = state.opponentInfo.outside;
  }

  function updateActionControls() {
    if (!state.publicState || !state.privateInfo) {
      disableGameInputs();
      return;
    }

    const finished = state.publicState.finished;
    const isTurn = state.publicState.turn === state.role;
    const offerForYou = state.publicState.currentOffer && state.publicState.currentOffer.to === state.role;

    offerInputs.forEach((input) => {
      input.disabled = !isTurn || finished;
      if (!isTurn) {
        input.value = '';
      }
    });

    submitOfferBtn.disabled = !isTurn || finished;
    walkAwayBtn.disabled = !isTurn || finished;
    acceptBtn.disabled = !offerForYou || !isTurn || finished;
    newGameBtn.disabled = !finished;

    // Update button text for tournament games
    if (state.publicState.tournamentId && finished) {
      newGameBtn.textContent = 'Next Match';
    } else {
      newGameBtn.textContent = 'Start New Game';
    }
  }

  function disableGameInputs() {
    offerInputs.forEach((input) => {
      input.disabled = true;
    });
    submitOfferBtn.disabled = true;
    walkAwayBtn.disabled = true;
    acceptBtn.disabled = true;
    newGameBtn.disabled = true;
  }

  function canAct() {
    return (
      state.socket &&
      state.socket.readyState === WebSocket.OPEN &&
      state.publicState &&
      !state.publicState.finished &&
      state.publicState.turn === state.role
    );
  }

  function canAccept() {
    return (
      canAct() &&
      state.publicState.currentOffer &&
      state.publicState.currentOffer.to === state.role
    );
  }

  function validateOffer(offer) {
    if (!Array.isArray(offer) || !state.config) return false;
    return offer.every((value, idx) => {
      if (!Number.isInteger(value) || value < 0) return false;
      return value <= state.config.items[idx].total;
    });
  }

  function getShareFor(role, offer) {
    if (!state.config) return [];
    if (offer.from === 'P1') {
      return role === 'P1'
        ? state.config.items.map((item, idx) => item.total - offer.quantities[idx])
        : offer.quantities.slice();
    }
    return role === 'P1'
      ? offer.quantities.slice()
      : state.config.items.map((item, idx) => item.total - offer.quantities[idx]);
  }

  function computeValue(quantities, values) {
    return quantities.reduce((sum, qty, idx) => sum + qty * (values[idx] || 0), 0);
  }

  function formatQuantities(quantities) {
    if (!state.config) return '';
    return quantities
      .map((qty, idx) => `${qty} × ${state.config.items[idx].name}`)
      .join(', ');
  }

  function labelWithName(role, info) {
    if (!info || !info.name) return getPlayerLabel(role);
    return `${getPlayerLabel(role)} (${info.name})`;
  }

  function getPlayerLabel(role) {
    return role === 'P1' ? 'Player 1' : 'Player 2';
  }

  function showLobbyStatus(message, isError = false) {
    if (!lobbyStatusEl) return;
    lobbyStatusEl.textContent = message;
    lobbyStatusEl.classList.toggle('error', Boolean(isError));
  }

  function showStatus(message, isError = false) {
    state.publicState = state.publicState || {};
    statusMessageEl.textContent = message;
    statusMessageEl.classList.toggle('outcome-fail', Boolean(isError));
  }

  function disableLobbyButtons() {
    createBtn.disabled = true;
    joinBtn.disabled = true;
  }

  function enableLobbyButtons() {
    createBtn.disabled = false;
    joinBtn.disabled = false;
  }
});
