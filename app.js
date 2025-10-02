const TOTAL_ROUNDS = 4;
const DISCOUNT = 0.95;
const VALUE_RANGE = { min: 1, max: 100 };
const ITEMS = [
  { name: "Item 1", total: 7 },
  { name: "Item 2", total: 4 },
  { name: "Item 3", total: 1 },
];
const TOTAL_ITEM_COUNTS = ITEMS.map((item) => item.total);

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
  const opponentSelect = document.getElementById("opponent-select");
  const addOpponentBtn = document.getElementById("add-opponent");
  const opponentLabelEl = document.getElementById("opponent-label");
  const activeOpponentNameEl = document.getElementById("active-opponent-name");
  const opponentInfoHeadingEl = document.getElementById("opponent-info-heading");

  const offerInputs = ITEMS.map((item, index) => {
    const input = document.getElementById(`offer-item-${index + 1}`);
    input.max = item.total;
    return input;
  });

  const session = {
    opponents: [],
    activeOpponentIndex: 0,
    nextOpponentNumber: 1,
  };

  let state = null;

  initializeSession();

  offerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (state.finished || state.turn !== "P1") return;

    const offer = offerInputs.map((input) => parseInt(input.value, 10) || 0);
    if (!isValidOffer(offer)) {
      showStatus(
        "Offer must use whole numbers between 0 and the available quantity of each item.",
        true
      );
      return;
    }

    const currentOffer = {
      from: "P1",
      to: "P2",
      quantities: offer,
    };

    state.currentOffer = currentOffer;
    logHistory(`Player 1 offers ${formatQuantities(offer)} to ${state.opponent.name}.`);
    showStatus(`Waiting for ${state.opponent.name}'s response...`);
    state.turn = "P2";
    updateUI();

    window.setTimeout(() => {
      opponentResponse();
    }, 600);
  });

  walkAwayBtn.addEventListener("click", () => {
    if (state.finished) return;
    if (state.turn === "P1") {
      concludeWithWalk("Player 1");
    } else if (state.turn === "P2") {
      concludeWithWalk(state.opponent.name);
    }
  });

  acceptBtn.addEventListener("click", () => {
    if (state.finished || state.turn !== "P1") return;
    if (!state.currentOffer || state.currentOffer.from !== "P2") return;
    concludeWithDeal(state.currentOffer, state.round);
  });

  newGameBtn.addEventListener("click", () => {
    startNewGame();
  });

  addOpponentBtn.addEventListener("click", () => {
    addOpponent();
    renderOpponentOptions();
    startNewGame();
  });

  opponentSelect.addEventListener("change", (event) => {
    const index = Number.parseInt(event.target.value, 10);
    if (Number.isNaN(index) || !session.opponents[index]) {
      return;
    }
    session.activeOpponentIndex = index;
    startNewGame();
  });

  function initializeSession() {
    if (session.opponents.length === 0) {
      addOpponent();
    }
    renderOpponentOptions();
    startNewGame();
  }

  function addOpponent() {
    const opponentName = `Opponent ${session.nextOpponentNumber}`;
    session.nextOpponentNumber += 1;
    const values = generateValues();
    const opponent = {
      name: opponentName,
      values,
      outside: drawOutside(values),
    };
    session.opponents.push(opponent);
    session.activeOpponentIndex = session.opponents.length - 1;
    return opponent;
  }

  function startNewGame() {
    const player1 = createPlayer1();
    const opponent = rerollActiveOpponent();
    state = createInitialState(player1, opponent);
    renderPlayer1Info();
    resetUI();
    state.statusMessage = `Make an opening offer to ${state.opponent.name} or walk away.`;
    state.statusIsError = false;
    updateUI();
  }

  function rerollActiveOpponent() {
    if (session.opponents.length === 0) {
      addOpponent();
    }
    if (session.activeOpponentIndex < 0 || session.activeOpponentIndex >= session.opponents.length) {
      session.activeOpponentIndex = 0;
    }
    const base = session.opponents[session.activeOpponentIndex];
    const values = generateValues();
    const outside = drawOutside(values);
    const opponent = {
      ...base,
      values,
      outside,
    };
    session.opponents[session.activeOpponentIndex] = opponent;
    return opponent;
  }

  function renderOpponentOptions() {
    if (session.opponents.length === 0) {
      opponentSelect.innerHTML = "";
      opponentSelect.disabled = true;
      return;
    }

    opponentSelect.disabled = false;
    opponentSelect.innerHTML = session.opponents
      .map((opponent, index) => `<option value="${index}">${opponent.name}</option>`)
      .join("");
    opponentSelect.value = String(session.activeOpponentIndex);
  }

  function resetUI() {
    historyListEl.innerHTML = "";
    summaryEl.innerHTML = "";
    currentOfferEl.innerHTML = "";
    player2Card.classList.add("hidden");
    acceptBtn.disabled = true;
    statusMessageEl.classList.remove("outcome-fail");
    offerInputs.forEach((input) => {
      input.value = "";
      input.disabled = false;
    });
    submitOfferBtn.disabled = false;
    walkAwayBtn.disabled = false;
  }

  function renderPlayer1Info() {
    player1ValuesEl.innerHTML = ITEMS.map(
      (item, idx) => `<li>${item.name}: <strong>${state.player1.values[idx]}</strong> value per unit</li>`
    ).join("");
    player1OutsideEl.textContent = state.player1.outside;
  }

  function updateUI() {
    roundEl.textContent = state.round;
    turnEl.textContent = state.turn === "P1" ? "Player 1" : state.opponent.name;
    statusMessageEl.textContent = state.statusMessage;
    statusMessageEl.classList.toggle("outcome-fail", Boolean(state.statusIsError));
    opponentLabelEl.textContent = state.opponent.name;
    activeOpponentNameEl.textContent = state.opponent.name;
    opponentInfoHeadingEl.textContent = `${state.opponent.name} Information`;
    opponentSelect.value = String(session.activeOpponentIndex);

    if (state.currentOffer) {
      const { from, quantities } = state.currentOffer;
      const heading = from === "P1" ? `Current Offer to ${state.opponent.name}` : "Current Offer to You";
      const details = formatQuantities(quantities);
      const offerValueP1 = computeValue(getShareFor("P1"), state.player1.values);
      const offerValueP2 = computeValue(getShareFor("P2"), state.opponent.values);

      currentOfferEl.innerHTML = `
        <h3>${heading}</h3>
        <p>${from === "P1" ? "You" : state.opponent.name} are offering ${details}.</p>
        <p>Player 1 value if accepted now: <strong>${offerValueP1.toFixed(2)}</strong></p>
        <p>${state.opponent.name} value if accepted now: <strong>${offerValueP2.toFixed(2)}</strong></p>
      `;
    } else {
      currentOfferEl.innerHTML = "";
    }

    acceptBtn.disabled =
      !state.currentOffer ||
      state.currentOffer.from !== "P2" ||
      state.finished ||
      state.turn !== "P1";

    if (state.finished) {
      player2Card.classList.remove("hidden");
      player2ValuesEl.innerHTML = ITEMS.map(
        (item, idx) => `<li>${item.name}: <strong>${state.opponent.values[idx]}</strong> value per unit</li>`
      ).join("");
      player2OutsideEl.textContent = state.opponent.outside;
    }
  }

  function getShareFor(player) {
    if (!state.currentOffer) return TOTAL_ITEM_COUNTS.slice();

    const offer = state.currentOffer.quantities;
    if (state.currentOffer.from === "P1") {
      if (player === "P1") {
        return ITEMS.map((item, idx) => item.total - offer[idx]);
      }
      return offer.slice();
    }

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
    state.statusIsError = isError;
    statusMessageEl.textContent = message;
    statusMessageEl.classList.toggle("outcome-fail", Boolean(isError));
  }

  function isValidOffer(offer) {
    return offer.every((value, idx) => {
      const quantity = Number.isFinite(value) ? value : -1;
      if (!Number.isInteger(quantity) || quantity < 0) {
        return false;
      }
      return quantity <= ITEMS[idx].total;
    });
  }

  function computeValue(quantities, values) {
    return quantities.reduce((sum, qty, idx) => sum + qty * values[idx], 0);
  }

  function formatQuantities(quantities) {
    return `${quantities[0]} × Item 1, ${quantities[1]} × Item 2, ${quantities[2]} × Item 3`;
  }

  function createInitialState(player1, opponent) {
    return {
      round: 1,
      turn: "P1",
      statusMessage: "",
      statusIsError: false,
      currentOffer: null,
      finished: false,
      outcome: null,
      player1,
      opponent,
    };
  }

  function concludeWithDeal(offer, round) {
    const discountFactor = Math.pow(DISCOUNT, round - 1);
    const player1Share = getShareFor("P1");
    const opponentShare = getShareFor("P2");
    const player1Value = computeValue(player1Share, state.player1.values);
    const opponentValue = computeValue(opponentShare, state.opponent.values);

    const player1Discounted = player1Value * discountFactor;
    const opponentDiscounted = opponentValue * discountFactor;

    state.finished = true;
    state.outcome = {
      type: "deal",
      round,
      offer,
      player1Value,
      opponentValue,
      player1Discounted,
      opponentDiscounted,
    };

    logHistory(`Deal reached with ${state.opponent.name} in round ${round}.`);
    showStatus("Deal reached!", false);
    renderSummary();
    disableInputs();
    updateUI();
  }

  function concludeWithWalk(player) {
    const round = state.round;
    const discountFactor = Math.pow(DISCOUNT, round - 1);
    const player1Discounted = state.player1.outside * discountFactor;
    const opponentDiscounted = state.opponent.outside * discountFactor;

    state.finished = true;
    state.outcome = {
      type: "walk",
      by: player,
      round,
      player1Discounted,
      opponentDiscounted,
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
      const opponentShare = getShareFor("P2");
      summaryEl.innerHTML = `
        <h2>Outcome</h2>
        <p class="outcome-success">Deal reached in round ${round} (discount factor ${discountFactor}).</p>
        <table class="summary-table">
          <thead>
            <tr>
              <th></th>
              <th>Player 1</th>
              <th>${state.opponent.name}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>Units received</th>
              <td>${formatQuantities(player1Share)}</td>
              <td>${formatQuantities(opponentShare)}</td>
            </tr>
            <tr>
              <th>Undiscounted value</th>
              <td>${state.outcome.player1Value.toFixed(2)}</td>
              <td>${state.outcome.opponentValue.toFixed(2)}</td>
            </tr>
            <tr>
              <th>Discounted payoff</th>
              <td>${state.outcome.player1Discounted.toFixed(2)}</td>
              <td>${state.outcome.opponentDiscounted.toFixed(2)}</td>
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
          <li>${state.opponent.name}: ${state.outcome.opponentDiscounted.toFixed(2)} (outside offer)</li>
        </ul>
      `;
    }
  }

  function opponentResponse() {
    if (state.finished || state.turn !== "P2") return;

    if (!state.currentOffer || state.currentOffer.from !== "P1") {
      state.turn = "P1";
      showStatus("It's your turn.");
      updateUI();
      return;
    }

    const offer = state.currentOffer.quantities;
    const opponentValue = computeValue(offer, state.opponent.values);
    const discountedOfferValue = opponentValue * Math.pow(DISCOUNT, state.round - 1);
    const discountedOutside = state.opponent.outside * Math.pow(DISCOUNT, state.round - 1);

    if (discountedOfferValue >= discountedOutside) {
      logHistory(`${state.opponent.name} accepts your offer.`);
      concludeWithDeal(state.currentOffer, state.round);
      return;
    }

    if (state.round === TOTAL_ROUNDS) {
      concludeWithWalk(state.opponent.name);
      return;
    }

    const counter = computeOpponentCounterOffer();
    if (counter) {
      const opponentShare = ITEMS.map((item, idx) => item.total - counter[idx]);
      const counterValue = computeValue(opponentShare, state.opponent.values);
      const discountedCounterValue = counterValue * Math.pow(DISCOUNT, state.round - 1);
      if (discountedCounterValue < discountedOutside) {
        concludeWithWalk(state.opponent.name);
        return;
      }

      state.currentOffer = {
        from: "P2",
        to: "P1",
        quantities: counter,
      };
      logHistory(`${state.opponent.name} counters by offering you ${formatQuantities(counter)}.`);
      state.turn = "P1";
      showStatus(`${state.opponent.name} made a counteroffer. You may accept, counter, or walk away.`);
      advanceRound();
      updateUI();
    } else {
      concludeWithWalk(state.opponent.name);
    }
  }

  function advanceRound() {
    if (state.round < TOTAL_ROUNDS) {
      state.round += 1;
    }
  }

  function computeOpponentCounterOffer() {
    const threshold = state.player1.outside;
    let bestOffer = null;
    let bestOpponentValue = -Infinity;

    for (let item1 = 0; item1 <= ITEMS[0].total; item1 += 1) {
      for (let item2 = 0; item2 <= ITEMS[1].total; item2 += 1) {
        for (let item3 = 0; item3 <= ITEMS[2].total; item3 += 1) {
          const offer = [item1, item2, item3];
          const player1Value = computeValue(offer, state.player1.values);
          if (player1Value < threshold * 0.85) {
            continue;
          }
          const opponentShare = ITEMS.map((item, idx) => item.total - offer[idx]);
          const opponentValue = computeValue(opponentShare, state.opponent.values);
          if (opponentValue > bestOpponentValue) {
            bestOpponentValue = opponentValue;
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
            const opponentShare = ITEMS.map((item, idx) => item.total - offer[idx]);
            const opponentValue = computeValue(opponentShare, state.opponent.values);
            if (opponentValue > bestOpponentValue) {
              bestOpponentValue = opponentValue;
              bestOffer = offer;
            }
          }
        }
      }
    }

    return bestOffer;
  }

  function randomInt(min, max) {
    const low = Math.ceil(min);
    const high = Math.floor(max);
    return Math.floor(Math.random() * (high - low + 1)) + low;
  }

  function generateValues() {
    return ITEMS.map(() => randomInt(VALUE_RANGE.min, VALUE_RANGE.max));
  }

  function drawOutside(values) {
    const totalValue = computeValue(TOTAL_ITEM_COUNTS, values);
    return randomInt(1, Math.max(1, Math.round(totalValue)));
  }

  function createPlayer1() {
    const values = generateValues();
    return {
      name: "Player 1",
      values,
      outside: drawOutside(values),
    };
  }
});
