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
  document.getElementById("tricks0").textContent = state.tricks[0];
  document.getElementById("tricks1").textContent = state.tricks[1];
  document.getElementById("message").textContent = state.phaseMessage;
  document.getElementById("dealer").textContent = seatName(state.dealer);
  document.getElementById("upcard").textContent = state.upcard
    ? cardText(state.upcard)
    : "-";
  document.getElementById("trump").textContent = state.trump || "-";

  renderPlayers();
  renderTrick();
  renderHand();
  renderActions();
}

function renderPlayers() {
  const playersElement = document.getElementById("players");
  playersElement.innerHTML = "";

  for (const player of state.players) {
    const playerElement = document.createElement("div");
    playerElement.className = "player";

    if (player.seat === state.currentTurn) {
      playerElement.classList.add("turn");
    }

    if (player.seat === state.viewerSeat) {
      playerElement.classList.add("you");
    }

    playerElement.innerHTML = `
      <strong>${player.name}</strong>
      <span>Seat ${player.seat + 1}</span>
      <span>${player.cardCount} cards</span>
      <span>${player.bot ? "Bot" : "Human"}</span>
    `;

    playersElement.appendChild(playerElement);
  }
}

function renderTrick() {
  const trickElement = document.getElementById("trick");
  trickElement.innerHTML = "<h2>Current Trick</h2>";

  if (!state.trick.length) {
    const empty = document.createElement("p");
    empty.textContent = "No cards played yet.";
    trickElement.appendChild(empty);
    return;
  }

  const cardsRow = document.createElement("div");
  cardsRow.className = "cards";

  for (const play of state.trick) {
    const cardElement = document.createElement("div");
    cardElement.className = `card ${colorClass(play.card.suit)}`;
    cardElement.innerHTML = `<small>${seatName(play.seat)}</small><br>${cardText(play.card)}`;
    cardsRow.appendChild(cardElement);
  }

  trickElement.appendChild(cardsRow);
}

function renderHand() {
  const handElement = document.getElementById("hand");
  handElement.innerHTML = "";

  for (const card of state.hand) {
    const cardButton = document.createElement("button");
    cardButton.className = `card ${colorClass(card.suit)}`;
    cardButton.textContent = cardText(card);

    if (state.phase === "playing") {
      const valid = state.validCards.includes(card.id);
      cardButton.disabled = !valid;
      cardButton.onclick = () => {
        socket.emit("playCard", {
          cardId: card.id
        });
      };
    } else if (state.phase === "dealerDiscard") {
      cardButton.onclick = () => {
        socket.emit("dealerDiscard", {
          cardId: card.id
        });
      };
    } else if (state.phase === "bottomsDiscard") {
      cardButton.onclick = () => {
        toggleDiscard(card.id, cardButton);
      };
    } else {
      cardButton.disabled = true;
    }

    handElement.appendChild(cardButton);
  }
}

function renderActions() {
  const actionsElement = document.getElementById("actions");
  actionsElement.innerHTML = "";

  const isMyTurn = state.viewerSeat === state.currentTurn;

  if (state.phase === "lobby") {
    const info = document.createElement("p");
    info.textContent = "Share the room code with friends. Add bots to empty seats if needed.";
    actionsElement.appendChild(info);

    const botsButton = document.createElement("button");
    botsButton.textContent = "Fill Empty Seats With Bots";
    botsButton.onclick = () => {
      socket.emit("addBots");
    };
    actionsElement.appendChild(botsButton);

    const startButton = document.createElement("button");
    startButton.textContent = "Start Game";
    startButton.onclick = () => {
      socket.emit("startGame");
    };
    actionsElement.appendChild(startButton);

    return;
  }

  if (state.phase === "bidding" && isMyTurn) {
    const passButton = document.createElement("button");
    passButton.textContent = "Pass";
    passButton.onclick = () => {
      socket.emit("pass");
    };
    actionsElement.appendChild(passButton);

    if (state.canBottoms) {
      const bottomsButton = document.createElement("button");
      bottomsButton.textContent = "Bottoms";
      bottomsButton.className = "special";
      bottomsButton.onclick = () => {
        socket.emit("bottoms");
      };
      actionsElement.appendChild(bottomsButton);
    }

    const aloneLabel = document.createElement("label");
    aloneLabel.className = "alone";
    aloneLabel.innerHTML = `<input id="aloneCheck" type="checkbox" /> Go alone`;
    actionsElement.appendChild(aloneLabel);

    if (state.biddingRound === 1) {
      const orderButton = document.createElement("button");
      orderButton.textContent = `Order Up ${state.upcard.suit}`;
      orderButton.onclick = () => {
        socket.emit("orderUp", {
          alone: document.getElementById("aloneCheck").checked
        });
      };
      actionsElement.appendChild(orderButton);
    }

    if (state.biddingRound === 2) {
      for (const suit of ["S", "H", "D", "C"]) {
        if (suit === state.upcard.suit) continue;

        const suitButton = document.createElement("button");
        suitButton.textContent = `Make ${suit}`;
        suitButton.onclick = () => {
          socket.emit("makeTrump", {
            suit,
            alone: document.getElementById("aloneCheck").checked
          });
        };

        actionsElement.appendChild(suitButton);
      }
    }
  }

  if (state.phase === "bottomsDiscard" && isMyTurn) {
    const instruction = document.createElement("p");
    instruction.textContent = "Choose 3 cards to discard after using Bottoms.";
    actionsElement.appendChild(instruction);

    const doneButton = document.createElement("button");
    doneButton.textContent = "Discard Selected";
    doneButton.onclick = () => {
      if (selectedDiscards.length !== 3) {
        alert("Select exactly 3 cards.");
        return;
      }

      socket.emit("finishBottoms", {
        cardIds: selectedDiscards
      });
    };

    actionsElement.appendChild(doneButton);
  }
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

function cardText(card) {
  const suits = {
    S: "♠",
    H: "♥",
    D: "♦",
    C: "♣"
  };

  return `${card.rank}${suits[card.suit]}`;
}

function colorClass(suit) {
  return suit === "H" || suit === "D" ? "red" : "black";
}
