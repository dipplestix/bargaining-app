const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'bargaining.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  -- Player sessions (persistent identity across games)
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- Individual games (each 2-player match)
  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    tournament_id TEXT,
    player1_session_id TEXT NOT NULL,
    player2_session_id TEXT NOT NULL,
    player1_name TEXT,
    player2_name TEXT,
    player1_values TEXT NOT NULL,
    player2_values TEXT NOT NULL,
    player1_outside INTEGER NOT NULL,
    player2_outside INTEGER NOT NULL,
    outcome_type TEXT,
    outcome_round INTEGER,
    outcome_by TEXT,
    player1_share TEXT,
    player2_share TEXT,
    player1_payoff REAL,
    player2_payoff REAL,
    started_at TEXT DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
  );

  -- Every action logged for analysis
  CREATE TABLE IF NOT EXISTS actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    player_role TEXT NOT NULL,
    action_type TEXT NOT NULL,
    round_number INTEGER NOT NULL,
    offer_quantities TEXT,
    offer_value_to_self REAL,
    offer_value_to_opponent REAL,
    discount_factor REAL,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (game_id) REFERENCES games(id)
  );

  -- Tournaments
  CREATE TABLE IF NOT EXISTS tournaments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    started_at TEXT,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS tournament_players (
    tournament_id TEXT,
    session_id TEXT,
    display_name TEXT,
    total_payoff REAL DEFAULT 0,
    games_played INTEGER DEFAULT 0,
    PRIMARY KEY (tournament_id, session_id),
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );

  CREATE TABLE IF NOT EXISTS tournament_matches (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL,
    round_number INTEGER NOT NULL,
    player1_session_id TEXT NOT NULL,
    player2_session_id TEXT NOT NULL,
    game_id TEXT,
    status TEXT DEFAULT 'pending',
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id),
    FOREIGN KEY (game_id) REFERENCES games(id)
  );

  -- Indexes for common queries
  CREATE INDEX IF NOT EXISTS idx_games_tournament ON games(tournament_id);
  CREATE INDEX IF NOT EXISTS idx_games_player1 ON games(player1_session_id);
  CREATE INDEX IF NOT EXISTS idx_games_player2 ON games(player2_session_id);
  CREATE INDEX IF NOT EXISTS idx_actions_game ON actions(game_id);
  CREATE INDEX IF NOT EXISTS idx_actions_session ON actions(session_id);
  CREATE INDEX IF NOT EXISTS idx_actions_timestamp ON actions(timestamp);
  CREATE INDEX IF NOT EXISTS idx_tournament_matches_tournament ON tournament_matches(tournament_id);
`);

// Prepared statements for sessions
const insertSession = db.prepare(`
  INSERT INTO sessions (id, display_name) VALUES (?, ?)
`);

const getSession = db.prepare(`
  SELECT * FROM sessions WHERE id = ?
`);

const updateSessionLastSeen = db.prepare(`
  UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP, display_name = ? WHERE id = ?
`);

// Prepared statements for games
const insertGame = db.prepare(`
  INSERT INTO games (
    id, tournament_id, player1_session_id, player2_session_id,
    player1_name, player2_name, player1_values, player2_values,
    player1_outside, player2_outside
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateGameOutcome = db.prepare(`
  UPDATE games SET
    outcome_type = ?,
    outcome_round = ?,
    outcome_by = ?,
    player1_share = ?,
    player2_share = ?,
    player1_payoff = ?,
    player2_payoff = ?,
    completed_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

// Prepared statements for actions
const insertAction = db.prepare(`
  INSERT INTO actions (
    game_id, session_id, player_role, action_type, round_number,
    offer_quantities, offer_value_to_self, offer_value_to_opponent, discount_factor
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// Prepared statements for tournaments
const insertTournament = db.prepare(`
  INSERT INTO tournaments (id, name) VALUES (?, ?)
`);

const getTournament = db.prepare(`
  SELECT * FROM tournaments WHERE id = ?
`);

const updateTournamentStatus = db.prepare(`
  UPDATE tournaments SET status = ?, started_at = CASE WHEN ? = 'active' THEN CURRENT_TIMESTAMP ELSE started_at END,
  completed_at = CASE WHEN ? = 'completed' THEN CURRENT_TIMESTAMP ELSE completed_at END
  WHERE id = ?
`);

const insertTournamentPlayer = db.prepare(`
  INSERT OR REPLACE INTO tournament_players (tournament_id, session_id, display_name) VALUES (?, ?, ?)
`);

const getTournamentPlayers = db.prepare(`
  SELECT * FROM tournament_players WHERE tournament_id = ? ORDER BY total_payoff DESC
`);

const updateTournamentPlayerScore = db.prepare(`
  UPDATE tournament_players SET total_payoff = total_payoff + ?, games_played = games_played + 1
  WHERE tournament_id = ? AND session_id = ?
`);

const insertTournamentMatch = db.prepare(`
  INSERT INTO tournament_matches (id, tournament_id, round_number, player1_session_id, player2_session_id)
  VALUES (?, ?, ?, ?, ?)
`);

const getTournamentMatches = db.prepare(`
  SELECT * FROM tournament_matches WHERE tournament_id = ? ORDER BY round_number, id
`);

const getPendingTournamentMatches = db.prepare(`
  SELECT * FROM tournament_matches WHERE tournament_id = ? AND status = 'pending' ORDER BY round_number, id
`);

const updateTournamentMatchStatus = db.prepare(`
  UPDATE tournament_matches SET status = ?, game_id = ? WHERE id = ?
`);

const getTournamentMatchById = db.prepare(`
  SELECT * FROM tournament_matches WHERE id = ?
`);

// Helper functions
function createSession(id, displayName) {
  insertSession.run(id, displayName);
  return { id, display_name: displayName };
}

function findOrCreateSession(id, displayName) {
  const existing = getSession.get(id);
  if (existing) {
    updateSessionLastSeen.run(displayName, id);
    return { ...existing, display_name: displayName };
  }
  return createSession(id, displayName);
}

function logGameStart(gameId, tournamentId, p1SessionId, p2SessionId, p1Name, p2Name, p1Values, p2Values, p1Outside, p2Outside) {
  insertGame.run(
    gameId,
    tournamentId || null,
    p1SessionId,
    p2SessionId,
    p1Name,
    p2Name,
    JSON.stringify(p1Values),
    JSON.stringify(p2Values),
    p1Outside,
    p2Outside
  );
}

function logGameOutcome(gameId, outcomeType, outcomeRound, outcomeBy, p1Share, p2Share, p1Payoff, p2Payoff) {
  updateGameOutcome.run(
    outcomeType,
    outcomeRound,
    outcomeBy || null,
    p1Share ? JSON.stringify(p1Share) : null,
    p2Share ? JSON.stringify(p2Share) : null,
    p1Payoff,
    p2Payoff,
    gameId
  );
}

function logAction(gameId, sessionId, playerRole, actionType, roundNumber, details = {}) {
  insertAction.run(
    gameId,
    sessionId,
    playerRole,
    actionType,
    roundNumber,
    details.quantities ? JSON.stringify(details.quantities) : null,
    details.valueToSelf || null,
    details.valueToOpponent || null,
    details.discountFactor || null
  );
}

function createTournament(id, name) {
  insertTournament.run(id, name);
  return { id, name, status: 'pending' };
}

function addTournamentPlayer(tournamentId, sessionId, displayName) {
  insertTournamentPlayer.run(tournamentId, sessionId, displayName);
}

function getTournamentWithPlayers(tournamentId) {
  const tournament = getTournament.get(tournamentId);
  if (!tournament) return null;
  const players = getTournamentPlayers.all(tournamentId);
  const matches = getTournamentMatches.all(tournamentId);
  return { ...tournament, players, matches };
}

function startTournament(tournamentId) {
  updateTournamentStatus.run('active', 'active', 'active', tournamentId);
}

function completeTournament(tournamentId) {
  updateTournamentStatus.run('completed', 'completed', 'completed', tournamentId);
}

function addTournamentMatch(matchId, tournamentId, roundNumber, p1SessionId, p2SessionId) {
  insertTournamentMatch.run(matchId, tournamentId, roundNumber, p1SessionId, p2SessionId);
}

function getNextPendingMatch(tournamentId) {
  const matches = getPendingTournamentMatches.all(tournamentId);
  return matches.length > 0 ? matches[0] : null;
}

function markMatchActive(matchId, gameId) {
  updateTournamentMatchStatus.run('active', gameId, matchId);
}

function markMatchCompleted(matchId) {
  const match = getTournamentMatchById.get(matchId);
  if (match) {
    updateTournamentMatchStatus.run('completed', match.game_id, matchId);
  }
}

function updatePlayerScore(tournamentId, sessionId, payoff) {
  updateTournamentPlayerScore.run(payoff, tournamentId, sessionId);
}

function close() {
  db.close();
}

module.exports = {
  db,
  findOrCreateSession,
  logGameStart,
  logGameOutcome,
  logAction,
  createTournament,
  addTournamentPlayer,
  getTournamentWithPlayers,
  startTournament,
  completeTournament,
  addTournamentMatch,
  getNextPendingMatch,
  markMatchActive,
  markMatchCompleted,
  updatePlayerScore,
  close,
};
