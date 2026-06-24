const socket = io();

let state = null;
let selectedDiscards = [];

const lobby = document.getElementById("lobby");
const game = document.getElementById("game");

document.getElementById("single").onclick = () => {
  socket.emit("createRoom", {
    name: getName(),
    singlePlayer: true
  });
};

document.getElementById("create").onclick = () => {
  socket.emit("createRoom", {
    name: getName(),
    singlePlayer: false
  });
};

document.getElementById("join").onclick = () => {
  socket.emit("joinRoom", {
    name: getName(),
    roomId: document.getElementById("roomCode").value.trim()
  });
};

document.getElementById("copyRoom").onclick = async () => {
  if (!state) return;

  await navigator.clipboard.writeText(state.id);
  alert("Room code copied: " + state.id);
};

function getName() {
  return document.getElementById("name").value.trim() || "Player";
}

socket.on("roomCreated", ({ roomId }) => {
  document.getElementById("roomCode").value = roomId;
});

socket.on("errorMessage", message => {
  alert(message);
});

socket.on("state", nextState => {
  state = nextState;
  selectedDiscards = [];
  render();
});

function render() {
  lobby.classList.add("hidden");
  game.classList.remove("hidden");

  document.getElementById("room").textContent = state.id;
  document.getElementById("score0").textContent = state.score[0];
  document.getElementById("score1").textContent = state.score[1];
  document.getElementById("message").textContent = state.phaseMessage;

  document.getElementById("dealer").textContent = seatName(state.dealer);
  document.getElementById("upcard").innerHTML = state.upcard
    ? cardHtml(state.upcard)
    : "-";
  document.getElementById("trump").textContent = state.trump
    ? suitSymbol(state.trump)
    : "-";
  document.getElementById("tricks").textContent = `Team 1 ${state.tricks[0]} - Team 2 ${state.tricks[1]}`;

  renderSeats();
  renderUpcardPile();
  renderBidLog();
  renderTrick();
  renderHand();
  renderActions();
}

function renderSeats() {
  const viewerSeat = state.viewerSeat ?? 0;

  const positions = {
    bottom: viewerSeat,
    left: (viewerSeat + 1) % 4,
    top: (viewerSeat + 2) % 4,
    right: (viewerSeat + 3) % 4
  };

  renderSeat("playerBottom", positions.bottom, "You");
  renderSeat("playerLeft", positions.left, "Opponent");
  renderSeat("playerTop", positions.top, "Partner");
  renderSeat("playerRight", positions.right, "Opponent");
}

function renderSeat(elementId, seat, label) {
  const player = state.players.find(p => p.seat === seat);
  const element = document.getElementById(elementId);

  if (!player) {
    element.innerHTML = "";
    return;
  }

  element.className = "seat";

  if (elementId === "playerTop") element.classList.add("seat-top");
  if (elementId === "playerLeft") element.classList.add("seat-left");
  if (elementId === "playerRight") element.classList.add("seat-right");
  if (elementId === "playerBottom") element.classList.add("seat-bottom");

  if (seat === state.currentTurn) {
    element.classList.add("active-seat");
  }

  if (seat === state.dealer) {
    element.classList.add("dealer-seat");
  }

  const backs = Array.from({ length: player.cardCount })
    .map(() => `<span class="card-back"></span>`)
    .join("");

  const trumpBadge = player.calledSuit
    ? `<div class="trump-badge">Called ${suitSymbol(player.calledSuit)}</div>`
    : "";

  element.innerHTML = `
    <div class="seat-name">${player.name}</div>
    <div class="seat-label">${label}${player.bot ? " · Bot" : ""}</div>
    ${trumpBadge}
    <div class="mini-cards">${backs}</div>
    ${seat === state.dealer ? `<div class="dealer-chip">D</div>` : ""}
  `;
}

function renderUpcardPile() {
  let pile = document.getElementById("upcardPile");

  if (!pile) {
    pile = document.createElement("div");
    pile.id = "upcardPile";
    pile.className = "upcard-pile";

    const center = document.querySelector(".center-area");
    center.insertBefore(pile, document.getElementById("trick"));
  }

  if (state.phase === "bidding" && state.upcard) {
    pile.innerHTML = `
      <div class="upcard-title">Upcard</div>
      <div class="card upcard ${colorClass(state.upcard.suit)}">${cardHtml(state.upcard)}</div>
    `;
    pile.style.display = "grid";
  } else {
    pile.style.display = "none";
  }
}

function renderBidLog() {
  let log = document.getElementById("bidLog");

  if (!log) {
    log = document.createElement("div");
    log.id = "bidLog";
    log.className = "bid-log";

    const center = document.querySelector(".center-area");
    center.appendChild(log);
  }

  if (!state.bidLog || !state.bidLog.length) {
    log.innerHTML = "";
    return;
  }

  log.innerHTML = state.bidLog
    .slice(-4)
    .map(item => `<div>${item}</div>`)
    .join("");
}

function renderTrick() {
  const trick = document.getElementById("trick");
  trick.innerHTML = "";

  if (!state.trick.length) {
    trick.innerHTML = `<div class="empty-trick">Waiting for cards...</div>`;
    return;
  }

  for (const play of state.trick) {
    const div = document.createElement("div");
    div.className = "played-card-wrap";
    div.innerHTML = `
      <div class="played-by">${seatName(play.seat)}</div>
      <div class="card ${colorClass(play.card.suit)}">${cardHtml(play.card)}</div>
    `;
    trick.appendChild(div);
  }
}

function renderHand() {
  const hand = document.getElementById("hand");
  hand.innerHTML = "";

  for (const card of state.hand) {
    const button = document.createElement("button");
    button.className = `card hand-card ${colorClass(card.suit)}`;
    button.innerHTML = cardHtml(card);

    if (state.phase === "playing") {
      const valid = state.validCards.includes(card.id);
      button.disabled = !valid;
      button.onclick = () => socket.emit("playCard", { cardId: card.id });
    } else if (state.phase === "dealerDiscard") {
      button.onclick = () => socket.emit("dealerDiscard", { cardId: card.id });
    } else if (state.phase === "bottomsDiscard") {
      button.onclick = () => toggleDiscard(card.id, button);
    } else {
      button.disabled = true;
    }

    hand.appendChild(button);
  }
}

function renderActions() {
  const actions = document.getElementById("actions");
  actions.innerHTML = "";

  const isMyTurn = state.viewerSeat === state.currentTurn;

  if (state.phase === "lobby") {
    actions.innerHTML = `
      <p>Share the room code with friends.</p>
      <button id="fillBots">Fill Empty Seats With Bots</button>
      <button id="startGame">Start Game</button>
    `;

    document.getElementById("fillBots").onclick = () => socket.emit("addBots");
    document.getElementById("startGame").onclick = () => socket.emit("startGame");
    return;
  }

  if (!isMyTurn) {
    return;
  }

  if (state.phase === "bidding") {
    const pass = makeButton("Pass", () => socket.emit("pass"));
    actions.appendChild(pass);

    if (state.canBottoms) {
      const bottoms = makeButton("Bottoms", () => socket.emit("bottoms"));
      bottoms.classList.add("bottoms-button");
      actions.appendChild(bottoms);
    }

    const alone = document.createElement("label");
    alone.className = "alone-check";
    alone.innerHTML = `<input id="aloneCheck" type="checkbox" /> Go alone`;
    actions.appendChild(alone);

    if (state.biddingRound === 1) {
      actions.appendChild(
        makeButton(`Order Up ${suitSymbol(state.upcard.suit)}`, () => {
          socket.emit("orderUp", {
            alone: document.getElementById("aloneCheck").checked
          });
        })
      );
    }

    if (state.biddingRound === 2) {
      for (const suit of ["S", "H", "D", "C"]) {
        actions.appendChild(
          makeButton(`Call ${suitSymbol(suit)}`, () => {
            socket.emit("makeTrump", {
              suit,
              alone: document.getElementById("aloneCheck").checked
            });
          })
        );
      }
    }
  }

  if (state.phase === "bottomsDiscard") {
    const instruction = document.createElement("p");
    instruction.textContent = "Bottoms: choose 3 cards to discard.";
    actions.appendChild(instruction);

    actions.appendChild(
      makeButton("Discard Selected", () => {
        if (selectedDiscards.length !== 3) {
          alert("Select exactly 3 cards.");
          return;
        }

        socket.emit("finishBottoms", {
          cardIds: selectedDiscards
        });
      })
    );
  }
}

function makeButton(text, onClick) {
  const button = document.createElement("button");
  button.textContent = text;
  button.onclick = onClick;
  return button;
}

function toggleDiscard(cardId, button) {
  if (selectedDiscards.includes(cardId)) {
    selectedDiscards = selectedDiscards.filter(id => id !== cardId);
    button.classList.remove("selected");
    return;
  }

  if (selectedDiscards.length >= 3) {
    alert("You can only discard 3 cards.");
    return;
  }

  selectedDiscards.push(cardId);
  button.classList.add("selected");
}

function seatName(seat) {
  const player = state.players.find(p => p.seat === seat);
  return player ? player.name : `Seat ${seat + 1}`;
}

function cardHtml(card) {
  return `
    <span class="rank">${card.rank}</span>
    <span class="suit">${suitSymbol(card.suit)}</span>
  `;
}

function suitSymbol(suit) {
  return {
    S: "♠",
    H: "♥",
    D: "♦",
    C: "♣"
  }[suit];
}

function colorClass(suit) {
  return suit === "H" || suit === "D" ? "red" : "black";
}
