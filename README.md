# bargaining-app

A lightweight browser-based simulation of a four-round bargaining game with discounted payoffs. You play as Player 1 and negotiate against an automated Player 2 to decide how three types of items are divided.

## Getting started

This project is implemented with vanilla HTML, CSS, and JavaScript. No build step is required.

1. Start a static web server in the repository directory, for example:

   ```bash
   python -m http.server 8000
   ```

2. Open `http://localhost:8000` in your browser to launch the game.

3. Use the form to propose offers, accept counteroffers, or walk away. The negotiation lasts at most four rounds and applies a 0.95 discount factor each round.

After each game the interface reveals Player 2's private valuations and outside offer so you can analyse the outcome and adjust your strategy for the next run.
