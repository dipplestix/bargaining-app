# bargaining-app

A real-time browser-based simulation of a four-round bargaining game with discounted payoffs. Two human players
connect over the network, receive private valuations, and take turns proposing and responding to offers.

## Getting started

This project is implemented with vanilla HTML, CSS, and JavaScript and synchronises players using a small Node.js
WebSocket server.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the development server:

   ```bash
   npm start
   ```

   The command serves the static files and opens a WebSocket server on the same port (default `http://localhost:8000`).

3. Share the URL with a friend on your local network or deploy the app to a host that supports long-lived WebSocket
   connections.

4. Each player should open the page, choose a display name, and either create a new game or join using a shared game code.

5. Take turns making offers, accepting counteroffers, or walking away. After each game, the interface reveals both
   players' private valuations and outside offers so you can analyse the outcome before starting a fresh game.

### Saved game history

Every completed negotiation (including walk-aways and disconnects) is appended to `data/game-history.json` on the
server. The file contains the full public timeline of offers, the revealed private information, and the final outcome
so you can review past matches or import them into other tools for analysis.

## Game rules

- The negotiation lasts at most four rounds with a `0.95` discount applied each round.
- Three indivisible items are available in every game: 7×Item 1, 4×Item 2, and 1×Item 3.
- Private valuations and outside offers are re-drawn before each game to keep the interaction fresh.
- Player 1 always acts first each round. Offers are binding when accepted by the receiving player.
- Either player can walk away on their turn to receive their outside option (discounted for the current round).

## Project structure

```
├── app.js          # Client-side logic for connecting, rendering, and interacting with the server
├── index.html      # Application markup
├── server.js       # Express + WebSocket server coordinating games
├── styles.css      # Styling
└── package.json    # Dependencies and scripts
```

## Deployment notes

To make the game available across the internet, deploy `server.js` on a Node-compatible host and ensure WebSocket traffic
is allowed. Because valuations are private to each player, the server sends tailored state updates to each connected client.
