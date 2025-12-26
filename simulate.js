const WebSocket = require('ws');

const SERVER_URL = 'ws://localhost:8888';
const NUM_GAMES = 20;

// Different strategies for players
const STRATEGIES = {
  // Greedy: offer very little to opponent
  greedy: (values, outside, items, round, isFirst) => {
    return items.map(item => Math.floor(item.total * 0.2));
  },

  // Fair: split roughly 50/50
  fair: (values, outside, items, round, isFirst) => {
    return items.map(item => Math.floor(item.total * 0.5));
  },

  // Generous: give more to opponent
  generous: (values, outside, items, round, isFirst) => {
    return items.map(item => Math.floor(item.total * 0.6));
  },

  // Strategic: consider own values, offer less of high-value items
  strategic: (values, outside, items, round, isFirst) => {
    const maxVal = Math.max(...values);
    return items.map((item, idx) => {
      // Offer less of items we value highly
      const ratio = 1 - (values[idx] / maxVal) * 0.5;
      return Math.floor(item.total * ratio * 0.4);
    });
  },

  // Impatient: starts generous, gets greedier each round
  impatient: (values, outside, items, round, isFirst) => {
    const generosity = Math.max(0.2, 0.7 - (round - 1) * 0.15);
    return items.map(item => Math.floor(item.total * generosity));
  },

  // Random: random offers
  random: (values, outside, items, round, isFirst) => {
    return items.map(item => Math.floor(Math.random() * (item.total + 1)));
  },
};

// Decision strategies for accepting/rejecting
const ACCEPT_STRATEGIES = {
  // Accept if value is above outside option
  rational: (offerValue, outside, round, discount) => {
    const discountedOutside = outside * Math.pow(discount, round - 1);
    return offerValue >= discountedOutside * 0.9; // Accept if close to outside
  },

  // Accept if getting at least 40% of potential value
  threshold: (offerValue, outside, round, discount, maxPossible) => {
    return offerValue >= maxPossible * 0.35;
  },

  // More likely to accept in later rounds
  desperate: (offerValue, outside, round, discount) => {
    const threshold = Math.max(0.3, 0.8 - (round - 1) * 0.2);
    const discountedOutside = outside * Math.pow(discount, round - 1);
    return offerValue >= discountedOutside * threshold;
  },
};

class SimulatedPlayer {
  constructor(name, offerStrategy, acceptStrategy) {
    this.name = name;
    this.offerStrategy = offerStrategy;
    this.acceptStrategy = acceptStrategy;
    this.socket = null;
    this.state = {};
    this.resolve = null;
    this.gameFinished = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = new WebSocket(SERVER_URL);

      this.socket.on('open', () => {
        this.socket.send(JSON.stringify({
          type: 'register',
          payload: { name: this.name }
        }));
      });

      this.socket.on('message', (data) => {
        const msg = JSON.parse(data);
        this.handleMessage(msg, resolve);
      });

      this.socket.on('error', reject);
    });
  }

  handleMessage(msg, connectResolve) {
    switch (msg.type) {
      case 'registered':
        this.state.sessionId = msg.sessionId;
        if (connectResolve) connectResolve();
        break;

      case 'lobby':
        this.state.gameId = msg.gameId;
        this.state.role = msg.role;
        break;

      case 'matchFound':
        this.state.gameId = msg.gameId;
        this.state.role = msg.role;
        break;

      case 'state':
        this.state.game = msg.state;
        this.state.you = msg.you;
        this.state.opponent = msg.opponent;

        if (msg.state.finished) {
          this.gameFinished = true;
          if (this.resolve) this.resolve(msg.state.outcome);
        } else if (msg.state.turn === this.state.role) {
          this.takeTurn();
        }
        break;

      case 'opponentLeft':
        this.gameFinished = true;
        if (this.resolve) this.resolve({ type: 'disconnect' });
        break;
    }
  }

  joinQueue() {
    this.socket.send(JSON.stringify({ type: 'joinQueue' }));
  }

  createGame() {
    this.socket.send(JSON.stringify({
      type: 'createGame',
      payload: { name: this.name }
    }));
  }

  joinGame(gameId) {
    this.socket.send(JSON.stringify({
      type: 'joinGame',
      payload: { name: this.name, gameId }
    }));
  }

  takeTurn() {
    const game = this.state.game;
    const you = this.state.you;

    if (!you || !you.values) return;

    // Check if there's an offer to us
    if (game.currentOffer && game.currentOffer.to === this.state.role) {
      const offer = game.currentOffer;
      const myShare = this.getMyShare(offer);
      const myValue = this.computeValue(myShare, you.values);
      const discountedValue = myValue * Math.pow(game.discount, game.round - 1);
      const maxPossible = this.computeValue(game.items.map(i => i.total), you.values);

      // Decide to accept or counter
      const shouldAccept = this.decideAccept(discountedValue, you.outside, game.round, game.discount, maxPossible);

      if (shouldAccept) {
        this.socket.send(JSON.stringify({ type: 'acceptOffer' }));
        return;
      }

      // Maybe walk away in later rounds if offer is terrible
      if (game.round >= 3 && discountedValue < you.outside * Math.pow(game.discount, game.round - 1) * 0.5) {
        if (Math.random() < 0.3) {
          this.socket.send(JSON.stringify({ type: 'walkAway' }));
          return;
        }
      }
    }

    // Make an offer
    const quantities = this.makeOffer(you.values, you.outside, game.items, game.round);
    this.socket.send(JSON.stringify({
      type: 'makeOffer',
      payload: { quantities }
    }));
  }

  getMyShare(offer) {
    const items = this.state.game.items;
    if (offer.from === 'P1') {
      return this.state.role === 'P1'
        ? items.map((item, idx) => item.total - offer.quantities[idx])
        : offer.quantities.slice();
    }
    return this.state.role === 'P1'
      ? offer.quantities.slice()
      : items.map((item, idx) => item.total - offer.quantities[idx]);
  }

  computeValue(quantities, values) {
    return quantities.reduce((sum, qty, idx) => sum + qty * values[idx], 0);
  }

  makeOffer(values, outside, items, round) {
    const strategy = STRATEGIES[this.offerStrategy] || STRATEGIES.fair;
    return strategy(values, outside, items, round, this.state.role === 'P1');
  }

  decideAccept(offerValue, outside, round, discount, maxPossible) {
    const strategy = ACCEPT_STRATEGIES[this.acceptStrategy] || ACCEPT_STRATEGIES.rational;
    return strategy(offerValue, outside, round, discount, maxPossible);
  }

  waitForGameEnd() {
    return new Promise((resolve) => {
      if (this.gameFinished) {
        resolve(this.state.game ? this.state.game.outcome : null);
      } else {
        this.resolve = resolve;
      }
    });
  }

  requestNewGame() {
    this.gameFinished = false;
    this.resolve = null;
    this.socket.send(JSON.stringify({ type: 'requestNewGame' }));
  }

  close() {
    if (this.socket) {
      this.socket.close();
    }
  }
}

async function playGame(p1Strategy, p2Strategy, p1Accept, p2Accept) {
  const player1 = new SimulatedPlayer(`Bot_${p1Strategy}`, p1Strategy, p1Accept);
  const player2 = new SimulatedPlayer(`Bot_${p2Strategy}`, p2Strategy, p2Accept);

  try {
    await player1.connect();
    await player2.connect();

    // Small delay to ensure registration completes
    await sleep(100);

    // Player 1 creates game
    player1.createGame();
    await sleep(200);

    // Player 2 joins
    player2.joinGame(player1.state.gameId);

    // Wait for game to finish
    const outcome = await Promise.race([
      player1.waitForGameEnd(),
      player2.waitForGameEnd(),
      sleep(10000).then(() => ({ type: 'timeout' }))
    ]);

    return {
      p1Strategy,
      p2Strategy,
      p1Accept,
      p2Accept,
      outcome
    };
  } finally {
    player1.close();
    player2.close();
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runSimulations() {
  console.log('Starting game simulations...\n');

  const strategyPairs = [
    ['fair', 'fair', 'rational', 'rational'],
    ['greedy', 'fair', 'rational', 'rational'],
    ['fair', 'greedy', 'rational', 'rational'],
    ['greedy', 'greedy', 'rational', 'rational'],
    ['generous', 'greedy', 'rational', 'rational'],
    ['strategic', 'fair', 'rational', 'rational'],
    ['strategic', 'strategic', 'rational', 'rational'],
    ['impatient', 'fair', 'desperate', 'rational'],
    ['random', 'fair', 'rational', 'rational'],
    ['random', 'random', 'threshold', 'threshold'],
    ['fair', 'strategic', 'desperate', 'rational'],
    ['generous', 'generous', 'rational', 'rational'],
    ['impatient', 'impatient', 'desperate', 'desperate'],
    ['strategic', 'greedy', 'threshold', 'rational'],
  ];

  const results = [];
  let gameNum = 0;

  for (const [p1Strat, p2Strat, p1Accept, p2Accept] of strategyPairs) {
    // Play 2 games per strategy pair (to get some variation)
    for (let i = 0; i < 2; i++) {
      gameNum++;
      console.log(`Game ${gameNum}: ${p1Strat} vs ${p2Strat}`);

      try {
        const result = await playGame(p1Strat, p2Strat, p1Accept, p2Accept);
        results.push(result);

        if (result.outcome) {
          if (result.outcome.type === 'deal') {
            console.log(`  -> Deal in round ${result.outcome.round}: P1=${result.outcome.player1Discounted.toFixed(2)}, P2=${result.outcome.player2Discounted.toFixed(2)}`);
          } else if (result.outcome.type === 'walk') {
            console.log(`  -> Walk away by ${result.outcome.by} in round ${result.outcome.round}`);
          } else {
            console.log(`  -> ${result.outcome.type}`);
          }
        }
      } catch (err) {
        console.log(`  -> Error: ${err.message}`);
      }

      await sleep(300); // Brief pause between games
    }
  }

  console.log(`\nCompleted ${results.length} games.`);
  console.log('Data saved to bargaining.db');
}

// Run if called directly
if (require.main === module) {
  runSimulations()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { playGame, SimulatedPlayer };
