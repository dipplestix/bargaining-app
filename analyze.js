const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'bargaining.db');
const db = new Database(DB_PATH, { readonly: true });

console.log('='.repeat(60));
console.log('BARGAINING GAME ANALYSIS');
console.log('='.repeat(60));
console.log();

// 1. Overall Statistics
console.log('1. OVERALL STATISTICS');
console.log('-'.repeat(40));

const totalGames = db.prepare('SELECT COUNT(*) as count FROM games WHERE outcome_type IS NOT NULL').get();
console.log(`Total completed games: ${totalGames.count}`);

const outcomeBreakdown = db.prepare(`
  SELECT outcome_type, COUNT(*) as count
  FROM games
  WHERE outcome_type IS NOT NULL
  GROUP BY outcome_type
`).all();

console.log('\nOutcome breakdown:');
outcomeBreakdown.forEach(row => {
  const pct = ((row.count / totalGames.count) * 100).toFixed(1);
  console.log(`  ${row.outcome_type}: ${row.count} (${pct}%)`);
});

// 2. Round Analysis
console.log('\n2. ROUND ANALYSIS');
console.log('-'.repeat(40));

const roundBreakdown = db.prepare(`
  SELECT outcome_round, outcome_type, COUNT(*) as count
  FROM games
  WHERE outcome_type IS NOT NULL
  GROUP BY outcome_round, outcome_type
  ORDER BY outcome_round
`).all();

console.log('\nOutcomes by round:');
const roundMap = {};
roundBreakdown.forEach(row => {
  if (!roundMap[row.outcome_round]) roundMap[row.outcome_round] = {};
  roundMap[row.outcome_round][row.outcome_type] = row.count;
});

Object.keys(roundMap).sort((a, b) => a - b).forEach(round => {
  const deals = roundMap[round].deal || 0;
  const walks = roundMap[round].walk || 0;
  console.log(`  Round ${round}: ${deals} deals, ${walks} walkaways`);
});

const avgRound = db.prepare(`
  SELECT AVG(outcome_round) as avg_round FROM games WHERE outcome_type = 'deal'
`).get();
console.log(`\nAverage round for deals: ${avgRound.avg_round ? avgRound.avg_round.toFixed(2) : 'N/A'}`);

// 3. Payoff Analysis
console.log('\n3. PAYOFF ANALYSIS');
console.log('-'.repeat(40));

const payoffStats = db.prepare(`
  SELECT
    AVG(player1_payoff) as avg_p1,
    AVG(player2_payoff) as avg_p2,
    MIN(player1_payoff) as min_p1,
    MAX(player1_payoff) as max_p1,
    MIN(player2_payoff) as min_p2,
    MAX(player2_payoff) as max_p2,
    AVG(player1_payoff + player2_payoff) as avg_total
  FROM games
  WHERE outcome_type = 'deal'
`).get();

if (payoffStats.avg_p1) {
  console.log('\nDeal payoffs:');
  console.log(`  Player 1 - Avg: ${payoffStats.avg_p1.toFixed(2)}, Min: ${payoffStats.min_p1.toFixed(2)}, Max: ${payoffStats.max_p1.toFixed(2)}`);
  console.log(`  Player 2 - Avg: ${payoffStats.avg_p2.toFixed(2)}, Min: ${payoffStats.min_p2.toFixed(2)}, Max: ${payoffStats.max_p2.toFixed(2)}`);
  console.log(`  Combined avg: ${payoffStats.avg_total.toFixed(2)}`);
}

const walkPayoffs = db.prepare(`
  SELECT
    AVG(player1_payoff) as avg_p1,
    AVG(player2_payoff) as avg_p2
  FROM games
  WHERE outcome_type = 'walk'
`).get();

if (walkPayoffs.avg_p1) {
  console.log('\nWalkaway payoffs (outside options):');
  console.log(`  Player 1 avg: ${walkPayoffs.avg_p1.toFixed(2)}`);
  console.log(`  Player 2 avg: ${walkPayoffs.avg_p2.toFixed(2)}`);
}

// 4. Action Analysis
console.log('\n4. ACTION ANALYSIS');
console.log('-'.repeat(40));

const actionStats = db.prepare(`
  SELECT action_type, COUNT(*) as count
  FROM actions
  GROUP BY action_type
`).all();

console.log('\nAction counts:');
actionStats.forEach(row => {
  console.log(`  ${row.action_type}: ${row.count}`);
});

const offersByRound = db.prepare(`
  SELECT round_number, COUNT(*) as count, AVG(offer_value_to_opponent) as avg_offer_value
  FROM actions
  WHERE action_type = 'offer'
  GROUP BY round_number
  ORDER BY round_number
`).all();

console.log('\nOffers by round:');
offersByRound.forEach(row => {
  const avgVal = row.avg_offer_value ? row.avg_offer_value.toFixed(2) : 'N/A';
  console.log(`  Round ${row.round_number}: ${row.count} offers, avg value to opponent: ${avgVal}`);
});

// 5. Strategy Analysis (by bot type)
console.log('\n5. STRATEGY ANALYSIS');
console.log('-'.repeat(40));

// Aggregate by strategy name (extract from Bot_strategyname pattern)
const strategyStats = db.prepare(`
  WITH player_results AS (
    SELECT
      REPLACE(s.display_name, 'Bot_', '') as strategy,
      CASE WHEN g.player1_session_id = s.id THEN g.player1_payoff ELSE g.player2_payoff END as payoff,
      g.outcome_type
    FROM sessions s
    JOIN games g ON g.player1_session_id = s.id OR g.player2_session_id = s.id
    WHERE g.outcome_type IS NOT NULL
  )
  SELECT
    strategy,
    COUNT(*) as games_played,
    AVG(payoff) as avg_payoff,
    SUM(payoff) as total_payoff,
    SUM(CASE WHEN outcome_type = 'deal' THEN 1 ELSE 0 END) as deals,
    SUM(CASE WHEN outcome_type = 'walk' THEN 1 ELSE 0 END) as walks
  FROM player_results
  GROUP BY strategy
  ORDER BY avg_payoff DESC
`).all();

console.log('\nStrategy performance (sorted by avg payoff):');
console.log('  Strategy      | Games | Avg Payoff | Deals | Walks');
console.log('  ' + '-'.repeat(50));
strategyStats.forEach(row => {
  const strategy = row.strategy.padEnd(12);
  const games = String(row.games_played).padStart(5);
  const avgPayoff = row.avg_payoff ? row.avg_payoff.toFixed(2).padStart(10) : '0.00'.padStart(10);
  const deals = String(row.deals).padStart(5);
  const walks = String(row.walks).padStart(5);
  console.log(`  ${strategy} | ${games} | ${avgPayoff} | ${deals} | ${walks}`);
});

// 6. Efficiency Analysis
console.log('\n6. EFFICIENCY ANALYSIS');
console.log('-'.repeat(40));

const efficiencyData = db.prepare(`
  SELECT
    id,
    outcome_type,
    outcome_round,
    player1_values,
    player2_values,
    player1_share,
    player2_share,
    player1_payoff,
    player2_payoff,
    player1_outside,
    player2_outside
  FROM games
  WHERE outcome_type = 'deal' AND player1_share IS NOT NULL
`).all();

let totalEfficiency = 0;
let efficiencyCount = 0;

efficiencyData.forEach(game => {
  try {
    const p1Values = JSON.parse(game.player1_values);
    const p2Values = JSON.parse(game.player2_values);
    const items = [7, 4, 1]; // Item totals

    // Calculate max possible combined value (if items went to whoever values them more)
    let maxCombined = 0;
    for (let i = 0; i < items.length; i++) {
      maxCombined += items[i] * Math.max(p1Values[i], p2Values[i]);
    }

    // Actual combined undiscounted value
    const p1Share = JSON.parse(game.player1_share);
    const p2Share = JSON.parse(game.player2_share);
    let actualCombined = 0;
    for (let i = 0; i < items.length; i++) {
      actualCombined += p1Share[i] * p1Values[i] + p2Share[i] * p2Values[i];
    }

    const efficiency = (actualCombined / maxCombined) * 100;
    totalEfficiency += efficiency;
    efficiencyCount++;
  } catch (e) {
    // Skip if JSON parse fails
  }
});

if (efficiencyCount > 0) {
  console.log(`\nAllocation efficiency (actual vs optimal combined value):`);
  console.log(`  Average efficiency: ${(totalEfficiency / efficiencyCount).toFixed(1)}%`);
  console.log(`  (100% means items went to whoever valued them most)`);
}

// 7. First Mover Analysis
console.log('\n7. FIRST MOVER ANALYSIS');
console.log('-'.repeat(40));

const firstMoverDeals = db.prepare(`
  SELECT
    outcome_round,
    player1_payoff,
    player2_payoff,
    CASE WHEN outcome_round % 2 = 1 THEN 'P1' ELSE 'P2' END as last_offerer
  FROM games
  WHERE outcome_type = 'deal'
`).all();

let p1Wins = 0, p2Wins = 0, ties = 0;
let p1TotalAdvantage = 0;

firstMoverDeals.forEach(game => {
  if (game.player1_payoff > game.player2_payoff) p1Wins++;
  else if (game.player2_payoff > game.player1_payoff) p2Wins++;
  else ties++;
  p1TotalAdvantage += game.player1_payoff - game.player2_payoff;
});

console.log(`\nWho got higher payoff in deals:`);
console.log(`  Player 1 (first mover): ${p1Wins} wins`);
console.log(`  Player 2: ${p2Wins} wins`);
console.log(`  Ties: ${ties}`);
if (firstMoverDeals.length > 0) {
  console.log(`  P1 average advantage: ${(p1TotalAdvantage / firstMoverDeals.length).toFixed(2)}`);
}

// 8. Opening Offer Analysis
console.log('\n8. OPENING OFFER ANALYSIS');
console.log('-'.repeat(40));

const openingOffers = db.prepare(`
  SELECT
    a.offer_quantities,
    a.offer_value_to_self,
    a.offer_value_to_opponent,
    g.outcome_type
  FROM actions a
  JOIN games g ON a.game_id = g.id
  WHERE a.action_type = 'offer' AND a.round_number = 1
  ORDER BY a.id
`).all();

// Group by first offer per game
const gameFirstOffers = {};
openingOffers.forEach(offer => {
  if (!gameFirstOffers[offer.game_id]) {
    gameFirstOffers[offer.game_id] = offer;
  }
});

const firstOffers = Object.values(gameFirstOffers);
if (firstOffers.length > 0) {
  const avgSelfValue = firstOffers.reduce((sum, o) => sum + (o.offer_value_to_self || 0), 0) / firstOffers.length;
  const avgOpponentValue = firstOffers.reduce((sum, o) => sum + (o.offer_value_to_opponent || 0), 0) / firstOffers.length;

  console.log(`\nFirst offer statistics (${firstOffers.length} games):`);
  console.log(`  Avg value kept by offerer: ${avgSelfValue.toFixed(2)}`);
  console.log(`  Avg value offered to opponent: ${avgOpponentValue.toFixed(2)}`);

  if (avgSelfValue + avgOpponentValue > 0) {
    const selfRatio = (avgSelfValue / (avgSelfValue + avgOpponentValue) * 100).toFixed(1);
    console.log(`  Offerer keeps: ${selfRatio}% of total value`);
  }
}

// 9. Summary Insights
console.log('\n' + '='.repeat(60));
console.log('SUMMARY INSIGHTS');
console.log('='.repeat(60));

const dealRate = outcomeBreakdown.find(r => r.outcome_type === 'deal');
const walkRate = outcomeBreakdown.find(r => r.outcome_type === 'walk');

if (dealRate && totalGames.count > 0) {
  const dealPct = ((dealRate.count / totalGames.count) * 100).toFixed(0);
  console.log(`\n- Deal rate: ${dealPct}% of games ended in agreement`);
}

if (avgRound.avg_round) {
  if (avgRound.avg_round < 2) {
    console.log('- Most deals happen early (round 1-2), suggesting quick agreement');
  } else {
    console.log('- Deals tend to take multiple rounds, suggesting tough negotiation');
  }
}

if (payoffStats.avg_p1 && payoffStats.avg_p2) {
  const diff = Math.abs(payoffStats.avg_p1 - payoffStats.avg_p2);
  if (diff < 50) {
    console.log('- Payoffs are relatively balanced between players');
  } else if (payoffStats.avg_p1 > payoffStats.avg_p2) {
    console.log('- Player 1 (first mover) has a payoff advantage');
  } else {
    console.log('- Player 2 has a payoff advantage');
  }
}

console.log('\n');

db.close();
