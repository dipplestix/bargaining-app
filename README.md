# bargaining-app

A lightweight browser-based simulation of a four-round bargaining game with discounted payoffs. You now play as Player 1 and can rotate through any number of AI opponents to decide how three types of items are divided. Every game draws fresh private values and outside options for every participant from the specified uniform distributions, so no two negotiations share the same incentives.

## Getting started

This project is implemented with vanilla HTML, CSS, and JavaScript. No build step is required.

1. Start a static web server in the repository directory, for example:

   ```bash
   python -m http.server 8000
   ```

2. Open `http://localhost:8000` in your browser to launch the game.

3. Use the form to propose offers, accept counteroffers, or walk away. The negotiation lasts at most four rounds and applies a 0.95 discount factor each round.

4. Add more opponents from the sidebar to spin up additional private-value agents. Switching the opponent or starting a new game rerolls everyone's values and outside offers according to the 1–100 uniform distribution (and 1–total-value for outside offers), so you can explore many matchups quickly.

After each game the interface reveals the opponent's private valuations and outside offer so you can analyse the outcome and adjust your strategy for the next run.
