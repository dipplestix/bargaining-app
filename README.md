# bargaining-app

A real-time browser-based simulation of a six-round bargaining game. Players connect over the network, receive private valuations, and take turns proposing and responding to offers.

## Features

- **Quick Match**: Join a queue and get automatically paired with another player
- **Private Games**: Create a game code and share it with a friend
- **Tournaments**: Run round-robin tournaments with any even number of players
- **Data Logging**: All games and actions are logged to SQLite for analysis
- **Bot Simulation**: Test strategies with automated players

## Getting Started

### Installation

```bash
npm install
```

### Running the Server

```bash
npm start
```

The server runs on `http://localhost:8888` by default. Set the `PORT` environment variable to change it.

### Playing the Game

1. Open the URL in your browser
2. Enter your display name
3. Choose a game mode:
   - **Quick Match**: Auto-pair with another waiting player
   - **Private Game**: Create/join with a 4-letter code
   - **Tournament**: Create or join a round-robin tournament

## Game Rules

- The negotiation lasts at most six rounds (3 offers per player)
- On round 6, Player 2 can only accept or walk away (no counter-offer)
- Three indivisible items are available: 7×Item 1, 4×Item 2, and 1×Item 3
- Private valuations (5-100 per item) and outside offers (0 to total value) are randomly assigned each game
- Player 1 always acts first. Offers are binding when accepted
- Either player can walk away to receive their outside option

## Running Simulations

Generate test data by running bot simulations:

```bash
# Start the server in one terminal
npm start

# Run simulations in another terminal
node simulate.js
```

The simulation runs 28 games with different strategy combinations:
- `fair` - Split items roughly 50/50
- `greedy` - Offer very little to opponent
- `generous` - Give more to opponent
- `strategic` - Consider own values, keep high-value items
- `impatient` - Start generous, get greedier each round
- `random` - Random offers

## Analyzing Data

After playing games or running simulations:

```bash
node analyze.js
```

This produces insights including:
- Overall deal vs walkaway rates
- Outcomes by round
- Payoff statistics
- Strategy performance comparison
- Allocation efficiency
- First mover advantage analysis

### Custom SQL Queries

The SQLite database (`bargaining.db`) contains:

```sql
-- Sessions: player identities
SELECT * FROM sessions;

-- Games: all game records with outcomes
SELECT * FROM games WHERE outcome_type IS NOT NULL;

-- Actions: every offer, accept, and walkaway
SELECT * FROM actions ORDER BY timestamp;

-- Example: Average payoff by outcome type
SELECT outcome_type, AVG(player1_payoff + player2_payoff) as avg_total
FROM games GROUP BY outcome_type;
```

## Project Structure

```
├── server.js       # Express + WebSocket server
├── app.js          # Client-side game logic
├── index.html      # Application markup
├── styles.css      # Styling
├── lib/
│   └── db.js       # SQLite database module
├── simulate.js     # Bot simulation script
├── analyze.js      # Data analysis script
├── bargaining.db   # SQLite database (created on first run)
└── package.json    # Dependencies and scripts
```

## API Endpoints

- `GET /health` - Server health check

## Deployment

Deploy `server.js` on any Node.js host with WebSocket support. The database file (`bargaining.db`) is created automatically on first run.

For production, consider:
- Setting `PORT` environment variable
- Using a process manager like PM2
- Backing up the database file periodically
