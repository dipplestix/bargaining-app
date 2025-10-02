const TOTAL_ROUNDS = 4;
const DISCOUNT = 0.95;
const ITEMS = [
  { name: "Item 1", total: 7 },
  { name: "Item 2", total: 4 },
  { name: "Item 3", total: 1 },
];
const PLAYER1_VALUES = [35, 4, 24];
const PLAYER1_OUTSIDE = 285;

document.addEventListener("DOMContentLoaded", () => {
  const roundEl = document.getElementById("round");
  const turnEl = document.getElementById("turn");
  const statusMessageEl = document.getElementById("status-message");
  const historyListEl = document.getElementById("history-list");
  const currentOfferEl = document.getElementById("current-offer");
  const summaryEl = document.getElementById("summary");
  const player1ValuesEl = document.getElementById("player1-values");
  const player1OutsideEl = document.getElementById("player1-outside");
  const player2Card = document.getElementById("player2-card");
  const player2ValuesEl = document.getElementById("player2-values");
  const player2OutsideEl = document.getElementById("player2-outside");
  const offerForm = document.getElementById("offer-form");
  const walkAwayBtn = document.getElementById("walk-away");
  const acceptBtn = document.getElementById("accept-offer");
  const submitOfferBtn = document.getElementById("submit-offer");
  const newGameBtn = document.getElementById("new-game");

  const offerInputs = ITEMS.map((item, index) => {
    const input = document.getElementById(`offer-item-${index + 1}`);
    input.max = item.total;
    return input;
  });

  let state = createInitialState();
  setupPlayer1Info();
  resetUI();
  updateUI();

  offerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (state.finished || state.turn !== "P1") return;

    const offer = offerInputs.map((input, idx) => parseInt(input.value, 10) || 0);
    if (!isValidOffer(offer, "P1")) {
      showStatus("Offer must consist of whole numbers between 0 and the available quantity of each item.", true);
      return;
    }

    const currentOffer = {
      from: "P1",
      to: "P2",
      quantities: offer,
    };

    state.currentOffer = currentOffer;
    logHistory(`Player 1 offers ${formatQuantities(offer)} to Player 2.`);
    showStatus("Waiting for Player 2's response...");
    state.turn = "P2";
    updateUI();

    window.setTimeout(() => {
      player2Response();
    }, 600);
  });

  walkAwayBtn.addEventListener("click", () => {
    if (state.finished) return;
    if (state.turn === "P1") {
      concludeWithWalk("Player 1");
    } else if (state.turn === "P2") {
      concludeWithWalk("Player 2");
    }
  });

  acceptBtn.addEventListener("click", () => {
    if (state.finished || state.turn !== "P1") return;
    if (!state.currentOffer || state.currentOffer.from !== "P2") return;
    concludeWithDeal(state.currentOffer, state.round);
  });

  newGameBtn.addEventListener("click", () => {
    state = createInitialState();
    resetUI();
    updateUI();
  });

  function resetUI() {
    historyListEl.innerHTML = "";
    summaryEl.innerHTML = "";
    currentOfferEl.innerHTML = "";
    player2Card.classList.add("hidden");
    acceptBtn.disabled = true;
    offerInputs.forEach((input) => {
      input.value = "";
      input.disabled = false;
    });
    submitOfferBtn.disabled = false;
    walkAwayBtn.disabled = false;
  }

  function setupPlayer1Info() {
    player1ValuesEl.innerHTML = ITEMS.map(
      (item, idx) => `<li>${item.name}: <strong>${PLAYER1_VALUES[idx]}</strong> value per unit</li>`
    ).join("");
    player1OutsideEl.textContent = PLAYER1_OUTSIDE;
  }

  function updateUI() {
    roundEl.textContent = state.round;
    turnEl.textContent = state.turn === "P1" ? "Player 1" : "Player 2";
    statusMessageEl.textContent = state.statusMessage;

    if (state.currentOffer) {
      const { from, to, quantities } = state.currentOffer;
      const heading = from === "P1" ? "Current Offer to Player 2" : "Current Offer to You";
      const details = formatQuantities(quantities);
      const offerValueP1 = computeValue(getShareFor("P1"), PLAYER1_VALUES);
      const offerValueP2 = computeValue(getShareFor("P2"), state.player2.values);

      currentOfferEl.innerHTML = `
        <h3>${heading}</h3>
        <p>${from} is offering ${details}.</p>
        <p>Player 1 value if accepted now: <strong>${offerValueP1.toFixed(2)}</strong></p>
        <p>Player 2 value if accepted now: <strong>${offerValueP2.toFixed(2)}</strong></p>
      `;
    } else {
      currentOfferEl.innerHTML = "";
    }

    acceptBtn.disabled = !state.currentOffer || state.currentOffer.from !== "P2" || state.finished || state.turn !== "P1";

    if (state.finished) {
      player2Card.classList.remove("hidden");
      player2ValuesEl.innerHTML = ITEMS.map(
        (item, idx) => `<li>${item.name}: <strong>${state.player2.values[idx]}</strong> value per unit</li>`
      ).join("");
      player2OutsideEl.textContent = state.player2.outside;
    }
  }

  function getShareFor(player) {
    if (!state.currentOffer) return ITEMS.map((item) => item.total);

    const offer = state.currentOffer.quantities;
    if (state.currentOffer.from === "P1") {
      if (player === "P1") {
        return ITEMS.map((item, idx) => item.total - offer[idx]);
      }
      return offer.slice();
    }

    // offer from Player 2 to Player 1
    if (player === "P1") {
      return offer.slice();
    }
    return ITEMS.map((item, idx) => item.total - offer[idx]);
  }

  function logHistory(message) {
    const entry = document.createElement("li");
    entry.textContent = message;
    historyListEl.prepend(entry);
  }

  function showStatus(message, isError = false) {
    state.statusMessage = message;
    statusMessageEl.textContent = message;
    statusMessageEl.classList.toggle("outcome-fail", isError);
  }

  function isValidOffer(offer, fromPlayer) {
    return offer.every((value, idx) => {
      const quantity = Number.isFinite(value) ? value : -1;
      if (!Number.isInteger(quantity) || quantity < 0) {
        return false;
      }

      if (fromPlayer === "P1") {
        return quantity <= ITEMS[idx].total;
      }
      // from Player 2 to Player 1, ensure Player 2 keeps non-negative
      return quantity <= ITEMS[idx].total;
    });
  }

  function computeValue(quantities, values) {
    return quantities.reduce((sum, qty, idx) => sum + qty * values[idx], 0);
  }

  function formatQuantities(quantities) {
    return `${quantities[0]} × Item 1, ${quantities[1]} × Item 2, ${quantities[2]} × Item 3`;
  }

  function createInitialState() {
    const player2Values = ITEMS.map(() => randomInt(1, 100));
    const player2Total = computeValue(
      ITEMS.map((item) => item.total),
      player2Values
    );
    const player2Outside = randomInt(1, Math.max(1, Math.round(player2Total)));

    return {
      round: 1,
      turn: "P1",
      statusMessage: "Make an opening offer or walk away.",
      currentOffer: null,
      history: [],
      finished: false,
      outcome: null,
      player2: {
        values: player2Values,
        outside: player2Outside,
      },
    };
  }

  function concludeWithDeal(offer, round) {
    const discountFactor = Math.pow(DISCOUNT, round - 1);
    const player1Share = getShareFor("P1");
    const player2Share = getShareFor("P2");
    const player1Value = computeValue(player1Share, PLAYER1_VALUES);
    const player2Value = computeValue(player2Share, state.player2.values);

    const player1Discounted = player1Value * discountFactor;
    const player2Discounted = player2Value * discountFactor;

    state.finished = true;
    state.outcome = {
      type: "deal",
      round,
      offer,
      player1Value,
      player2Value,
      player1Discounted,
      player2Discounted,
    };

    logHistory(`Deal reached in round ${round}.`);
    showStatus("Deal reached!", false);
    renderSummary();
    disableInputs();
    updateUI();
  }

  function concludeWithWalk(player) {
    const round = state.round;
    const discountFactor = Math.pow(DISCOUNT, round - 1);
    const player1Discounted = PLAYER1_OUTSIDE * discountFactor;
    const player2Discounted = state.player2.outside * discountFactor;

    state.finished = true;
    state.outcome = {
      type: "walk",
      by: player,
      round,
      player1Discounted,
      player2Discounted,
    };

    logHistory(`${player} walks away in round ${round}.`);
    showStatus(`${player} walked away.`, true);
    renderSummary();
    disableInputs();
    updateUI();
  }

  function disableInputs() {
    offerInputs.forEach((input) => (input.disabled = true));
    submitOfferBtn.disabled = true;
    walkAwayBtn.disabled = true;
    acceptBtn.disabled = true;
  }

  function renderSummary() {
    if (!state.outcome) return;

    const round = state.outcome.round;
    const discountFactor = Math.pow(DISCOUNT, round - 1).toFixed(4);

    if (state.outcome.type === "deal") {
      const player1Share = getShareFor("P1");
      const player2Share = getShareFor("P2");
      summaryEl.innerHTML = `
        <h2>Outcome</h2>
        <p class="outcome-success">Deal reached in round ${round} (discount factor ${discountFactor}).</p>
        <table class="summary-table">
          <thead>
            <tr>
              <th></th>
              <th>Player 1</th>
              <th>Player 2</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>Units received</th>
              <td>${formatQuantities(player1Share)}</td>
              <td>${formatQuantities(player2Share)}</td>
            </tr>
            <tr>
              <th>Undiscounted value</th>
              <td>${state.outcome.player1Value.toFixed(2)}</td>
              <td>${state.outcome.player2Value.toFixed(2)}</td>
            </tr>
            <tr>
              <th>Discounted payoff</th>
              <td>${state.outcome.player1Discounted.toFixed(2)}</td>
              <td>${state.outcome.player2Discounted.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      `;
    } else {
      summaryEl.innerHTML = `
        <h2>Outcome</h2>
        <p class="outcome-fail">${state.outcome.by} walked away in round ${round} (discount factor ${discountFactor}).</p>
        <p>Discounted payoffs:</p>
        <ul>
          <li>Player 1: ${state.outcome.player1Discounted.toFixed(2)} (outside offer)</li>
          <li>Player 2: ${state.outcome.player2Discounted.toFixed(2)} (outside offer)</li>
        </ul>
      `;
    }
  }

  function randomInt(min, max) {
    const low = Math.ceil(min);
    const high = Math.floor(max);
    return Math.floor(Math.random() * (high - low + 1)) + low;
  }

  function player2Response() {
    if (state.finished || state.turn !== "P2") return;

    if (!state.currentOffer || state.currentOffer.from !== "P1") {
      state.turn = "P1";
      showStatus("It's your turn.");
      updateUI();
      return;
    }

    const offer = state.currentOffer.quantities;
    const p2Value = computeValue(offer, state.player2.values);
    const discountedOfferValue = p2Value * Math.pow(DISCOUNT, state.round - 1);
    const discountedOutside = state.player2.outside * Math.pow(DISCOUNT, state.round - 1);

    if (discountedOfferValue >= discountedOutside) {
      logHistory("Player 2 accepts your offer.");
      concludeWithDeal(state.currentOffer, state.round);
      return;
    }

    if (state.round === TOTAL_ROUNDS) {
      concludeWithWalk("Player 2");
      return;
    }

    const counter = computePlayer2CounterOffer();
    if (counter) {
      const counterOfferValue = computeValue(
        ITEMS.map((item, idx) => item.total - counter[idx]),
        state.player2.values
      );
      const discountedCounterValue = counterOfferValue * Math.pow(DISCOUNT, state.round - 1);
      if (discountedCounterValue < discountedOutside) {
        concludeWithWalk("Player 2");
        return;
      }

      state.currentOffer = {
        from: "P2",
        to: "P1",
        quantities: counter,
      };
      logHistory(`Player 2 counters by offering you ${formatQuantities(counter)}.`);
      state.turn = "P1";
      showStatus("Player 2 made a counteroffer. You may accept, counter, or walk away.");
      advanceRound();
      updateUI();
    } else {
      concludeWithWalk("Player 2");
    }
  }

  function advanceRound() {
    if (state.round < TOTAL_ROUNDS) {
      state.round += 1;
    }
  }

  function computePlayer2CounterOffer() {
    const threshold = PLAYER1_OUTSIDE;
    let bestOffer = null;
    let bestP2Value = -Infinity;

    for (let item1 = 0; item1 <= ITEMS[0].total; item1 += 1) {
      for (let item2 = 0; item2 <= ITEMS[1].total; item2 += 1) {
        for (let item3 = 0; item3 <= ITEMS[2].total; item3 += 1) {
          const offer = [item1, item2, item3];
          const player1Value = computeValue(offer, PLAYER1_VALUES);
          if (player1Value < threshold * 0.85) {
            continue;
          }
          const player2Share = ITEMS.map((item, idx) => item.total - offer[idx]);
          const player2Value = computeValue(player2Share, state.player2.values);
          if (player2Value > bestP2Value) {
            bestP2Value = player2Value;
            bestOffer = offer;
          }
        }
      }
    }

    if (!bestOffer) {
      for (let item1 = 0; item1 <= ITEMS[0].total; item1 += 1) {
        for (let item2 = 0; item2 <= ITEMS[1].total; item2 += 1) {
          for (let item3 = 0; item3 <= ITEMS[2].total; item3 += 1) {
            const offer = [item1, item2, item3];
            const player2Share = ITEMS.map((item, idx) => item.total - offer[idx]);
            const player2Value = computeValue(player2Share, state.player2.values);
            if (player2Value > bestP2Value) {
              bestP2Value = player2Value;
              bestOffer = offer;
            }
          }
        }
      }
    }

    return bestOffer;
  }
});
