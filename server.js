const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

const SUITS = ["S", "H", "D", "C"];
const RANKS = ["9", "10", "J", "Q", "K", "A"];

const rooms = new Map();

function shuffle(cards) {
  const deck = [...cards];

  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

function makeDeck() {
  const deck = [];

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        id: `${rank}${suit}`,
        rank,
        suit
      });
    }
  }

  return shuffle(deck);
}

function sameColorSuit(suit) {
  if (suit === "S") return "C";
  if (suit === "C") return "S";
  if (suit === "H") return "D";
  return "H";
}

function effectiveSuit(card, trump) {
  if (trump && card.rank === "J" && card.suit === sameColorSuit(trump)) {
    return trump;
  }

  return card.suit;
}

function cardPower(card, trump, leadSuit) {
  const eff = effectiveSuit(card, trump);

  if (card.rank === "J" && card.suit === trump) return 200;
  if (card.rank === "J" && card.suit === sameColorSuit(trump)) return 199;

  if (eff === trump) {
    const values = {
      A: 198,
      K: 197,
      Q: 196,
      "10": 195,
      "9": 194
    };

    return values[card.rank] || 0;
  }

  if (eff === leadSuit) {
    const values = {
      A: 100,
      K: 99,
      Q: 98,
      J: 97,
      "10": 96,
      "9": 95
    };

    return values[card.rank] || 0;
  }

  return 0;
}

function canPlayCard(hand, card, leadSuit, trump) {
  if (!leadSuit) return true;

  const hasLeadSuit = hand.some(c => effectiveSuit(c, trump) === leadSuit);

  if (!hasLeadSuit) return true;

  return effectiveSuit(card, trump) === leadSuit;
}

function hasBottoms(hand) {
  const nines = hand.filter(card => card.rank === "9").length;
  const tens = hand.filter(card => card.rank === "10").length;

  return nines === 3 || tens === 3;
}

function teamOfSeat(seat) {
  return seat % 2;
}

function teamSeats(team) {
  return team === 0 ? [0, 2] : [1, 3];
}

function suitSymbol(suit) {
  return {
    S: "♠",
    H: "♥",
    D: "♦",
    C: "♣"
  }[suit] || suit;
}

function teamLabel(room, team) {
  const [a, b] = teamSeats(team);
  const aName = room.players[a].name || `Seat ${a + 1}`;
  const bName = room.players[b].name || `Seat ${b + 1}`;
  return `${aName} & ${bName}`;
}

function createRoom(roomId) {
  const room = {
    id: roomId,
    players: [
      { seat: 0, name: null, socketId: null, bot: false, hand: [] },
      { seat: 1, name: null, socketId: null, bot: false, hand: [] },
      { seat: 2, name: null, socketId: null, bot: false, hand: [] },
      { seat: 3, name: null, socketId: null, bot: false, hand: [] }
    ],
    dealer: 0,
    score: [0, 0],
    handNumber: 0,
    phase: "lobby",
    deck: [],
    kitty: [],
    upcard: null,
    trump: null,
    maker: null,
    alone: false,
    alonePartnerSeat: null,
    currentTurn: 0,
    biddingRound: 1,
    passed: [],
    trick: [],
    leadSuit: null,
    tricks: [0, 0],
    bidLog: [],
    pickedUpSeat: null,
    message: "Waiting for players."
  };

  rooms.set(roomId, room);
  return room;
}

function addBidLog(room, text) {
  room.bidLog.push(text);

  if (room.bidLog.length > 12) {
    room.bidLog.shift();
  }
}

function publicState(room, socketId) {
  const viewer = room.players.find(player => player.socketId === socketId);

  return {
    id: room.id,
    viewerSeat: viewer ? viewer.seat : null,
    phase: room.phase,
    players: room.players.map(player => {
      const teamIndex = teamOfSeat(player.seat);

      return {
        seat: player.seat,
        name: player.name || `Seat ${player.seat + 1}`,
        bot: player.bot,
        connected: Boolean(player.socketId) || player.bot,
        cardCount: player.hand.length,
        calledSuit: room.maker === player.seat ? room.trump : null,
        pickedUpSuit: room.pickedUpSeat === player.seat ? room.trump : null,
        isMaker: room.maker === player.seat,
        teamIndex,
        teamTricks: room.tricks[teamIndex],
        teamScore: room.score[teamIndex]
      };
    }),
    dealer: room.dealer,
    score: room.score,
    scoreboard: [
      {
        team: 0,
        label: teamLabel(room, 0),
        score: room.score[0],
        tricks: room.tricks[0]
      },
      {
        team: 1,
        label: teamLabel(room, 1),
        score: room.score[1],
        tricks: room.tricks[1]
      }
    ],
    handNumber: room.handNumber,
    upcard: room.upcard,
    trump: room.trump,
    maker: room.maker,
    alone: room.alone,
    alonePartnerSeat: room.alonePartnerSeat,
    currentTurn: room.currentTurn,
    biddingRound: room.biddingRound,
    phaseMessage: room.message,
    hand: viewer ? viewer.hand : [],
    kittyCount: room.kitty.length,
    trick: room.trick,
    leadSuit: room.leadSuit,
    tricks: room.tricks,
    bidLog: room.bidLog,
    canBottoms:
      viewer &&
      room.phase === "bidding" &&
      viewer.seat === room.currentTurn &&
      hasBottoms(viewer.hand),
    validCards:
      viewer &&
      room.phase === "playing" &&
      viewer.seat === room.currentTurn
        ? viewer.hand
            .filter(card => canPlayCard(viewer.hand, card, room.leadSuit, room.trump))
            .map(card => card.id)
        : []
  };
}

function emitRoom(room) {
  for (const player of room.players) {
    if (player.socketId) {
      io.to(player.socketId).emit("state", publicState(room, player.socketId));
    }
  }
}

function joinSeat(room, socket, name, requestedSeat = null) {
  let seat = requestedSeat;

  if (
    seat === null ||
    seat < 0 ||
    seat > 3 ||
    room.players[seat].socketId
  ) {
    seat = room.players.findIndex(player => !player.socketId && !player.bot);
  }

  if (seat === -1) {
    seat = room.players.findIndex(player => player.bot);

    if (seat !== -1) {
      room.players[seat].bot = false;
    }
  }

  if (seat === -1) {
    throw new Error("Room is full.");
  }

  room.players[seat].name = name || `Player ${seat + 1}`;
  room.players[seat].socketId = socket.id;
  room.players[seat].bot = false;

  socket.join(room.id);
  socket.data.roomId = room.id;
  socket.data.seat = seat;
}

function fillBots(room) {
  for (const player of room.players) {
    if (!player.socketId) {
      player.name = `Bot ${player.seat + 1}`;
      player.bot = true;
    }
  }
}

function startHand(room) {
  room.handNumber += 1;
  room.phase = "bidding";
  room.deck = makeDeck();
  room.kitty = [];
  room.trump = null;
  room.maker = null;
  room.alone = false;
  room.alonePartnerSeat = null;
  room.currentTurn = 0;
  room.biddingRound = 1;
  room.passed = [];
  room.trick = [];
  room.leadSuit = null;
  room.tricks = [0, 0];
  room.bidLog = [];
  room.pickedUpSeat = null;

  for (const player of room.players) {
    player.hand = [];
  }

  for (let i = 0; i < 5; i++) {
    for (let s = 1; s <= 4; s++) {
      const seat = (room.dealer + s) % 4;
      room.players[seat].hand.push(room.deck.pop());
    }
  }

  room.kitty = [
    room.deck.pop(),
    room.deck.pop(),
    room.deck.pop(),
    room.deck.pop()
  ];

  room.upcard = room.kitty[0];
  room.currentTurn = (room.dealer + 1) % 4;
  room.message = `${room.players[room.currentTurn].name}: pass, order up ${suitSymbol(room.upcard.suit)}, or use Bottoms.`;

  addBidLog(room, `Upcard is ${room.upcard.rank}${suitSymbol(room.upcard.suit)}.`);

  emitRoom(room);
  botMaybeAct(room);
}

function nextBidTurn(room) {
  room.passed.push(room.currentTurn);

  if (room.passed.length >= 4 && room.biddingRound === 1) {
    room.biddingRound = 2;
    room.passed = [];
    room.currentTurn = (room.dealer + 1) % 4;
    room.message = `Everyone passed the upcard. ${room.players[room.currentTurn].name}: choose any suit, pass, or use Bottoms.`;

    addBidLog(room, "Everyone passed the upcard. Round 2 begins.");

    emitRoom(room);
    botMaybeAct(room);
    return;
  }

  if (room.passed.length >= 4 && room.biddingRound === 2) {
    room.message = "Everyone passed both rounds. New hand.";
    addBidLog(room, "Everyone passed. Redealing.");

    room.dealer = (room.dealer + 1) % 4;

    emitRoom(room);

    setTimeout(() => {
      startHand(room);
    }, 1400);

    return;
  }

  room.currentTurn = (room.currentTurn + 1) % 4;

  if (room.biddingRound === 1) {
    room.message = `${room.players[room.currentTurn].name}: pass, order up ${suitSymbol(room.upcard.suit)}, or use Bottoms.`;
  } else {
    room.message = `${room.players[room.currentTurn].name}: choose any suit, pass, or use Bottoms.`;
  }

  emitRoom(room);
  botMaybeAct(room);
}

function playerPass(room, seat) {
  if (room.phase !== "bidding") return;
  if (seat !== room.currentTurn) return;

  addBidLog(room, `${room.players[seat].name} passed.`);
  nextBidTurn(room);
}

function orderUp(room, seat, alone) {
  if (room.phase !== "bidding") return;
  if (room.biddingRound !== 1) return;
  if (seat !== room.currentTurn) return;

  const trump = room.upcard.suit;

  room.trump = trump;
  room.maker = seat;
  room.alone = Boolean(alone);
  room.alonePartnerSeat = room.alone ? (seat + 2) % 4 : null;
  room.pickedUpSeat = room.dealer;

  const dealer = room.players[room.dealer];

  dealer.hand.push(room.upcard);
  room.kitty = room.kitty.filter(card => card.id !== room.upcard.id);

  addBidLog(
    room,
    `${room.players[seat].name} ordered up ${suitSymbol(trump)}${room.alone ? " and is going alone" : ""}.`
  );
  addBidLog(room, `${dealer.name} picked up the upcard.`);

  room.phase = "dealerDiscard";
  room.currentTurn = room.dealer;
  room.message = `${dealer.name} must discard one card. Trump is ${suitSymbol(trump)}.`;

  emitRoom(room);

  if (dealer.bot) {
    setTimeout(() => {
      const discard = chooseBotDiscard(dealer.hand, trump);
      discardDealer(room, room.dealer, discard.id);
    }, 700);
  }
}

function makeTrump(room, seat, suit, alone) {
  if (room.phase !== "bidding") return;
  if (room.biddingRound !== 2) return;
  if (seat !== room.currentTurn) return;
  if (!SUITS.includes(suit)) return;

  room.trump = suit;
  room.maker = seat;
  room.alone = Boolean(alone);
  room.alonePartnerSeat = room.alone ? (seat + 2) % 4 : null;
  room.pickedUpSeat = null;

  addBidLog(
    room,
    `${room.players[seat].name} called ${suitSymbol(suit)}${room.alone ? " and is going alone" : ""}.`
  );

  beginPlay(room);
}

function discardDealer(room, seat, cardId) {
  if (room.phase !== "dealerDiscard") return;
  if (seat !== room.dealer) return;

  const player = room.players[seat];
  const index = player.hand.findIndex(card => card.id === cardId);

  if (index === -1) return;

  const discarded = player.hand[index];
  player.hand.splice(index, 1);

  addBidLog(room, `${player.name} discarded ${discarded.rank}${suitSymbol(discarded.suit)}.`);

  beginPlay(room);
}

function beginPlay(room) {
  room.phase = "playing";
  room.currentTurn = (room.dealer + 1) % 4;

  if (room.alonePartnerSeat === room.currentTurn) {
    room.currentTurn = (room.currentTurn + 1) % 4;
  }

  room.message = `Trump is ${suitSymbol(room.trump)}. ${room.players[room.currentTurn].name} leads.`;

  emitRoom(room);
  botMaybeAct(room);
}

function playCard(room, seat, cardId) {
  if (room.phase !== "playing") return;
  if (seat !== room.currentTurn) return;
  if (seat === room.alonePartnerSeat) return;

  const player = room.players[seat];
  const index = player.hand.findIndex(card => card.id === cardId);

  if (index === -1) return;

  const card = player.hand[index];

  if (!canPlayCard(player.hand, card, room.leadSuit, room.trump)) {
    return;
  }

  player.hand.splice(index, 1);

  if (!room.leadSuit) {
    room.leadSuit = effectiveSuit(card, room.trump);
  }

  room.trick.push({
    seat,
    card
  });

  const activeSeats = [0, 1, 2, 3].filter(seatNumber => {
    return seatNumber !== room.alonePartnerSeat;
  });

  if (room.trick.length === activeSeats.length) {
    finishTrick(room);
    return;
  }

  do {
    room.currentTurn = (room.currentTurn + 1) % 4;
  } while (room.currentTurn === room.alonePartnerSeat);

  room.message = `${room.players[room.currentTurn].name}'s play.`;

  emitRoom(room);
  botMaybeAct(room);
}

function finishTrick(room) {
  let winningPlay = room.trick[0];

  for (const play of room.trick.slice(1)) {
    const playPower = cardPower(play.card, room.trump, room.leadSuit);
    const winningPower = cardPower(winningPlay.card, room.trump, room.leadSuit);

    if (playPower > winningPower) {
      winningPlay = play;
    }
  }

  const winningTeam = teamOfSeat(winningPlay.seat);

  room.tricks[winningTeam] += 1;
  room.trick = [];
  room.leadSuit = null;

  const totalTricks = room.tricks[0] + room.tricks[1];

  if (totalTricks >= 5) {
    finishHand(room);
    return;
  }

  room.currentTurn = winningPlay.seat;

  if (room.currentTurn === room.alonePartnerSeat) {
    room.currentTurn = (room.currentTurn + 1) % 4;
  }

  room.message = `${room.players[winningPlay.seat].name} won the trick.`;

  emitRoom(room);
  botMaybeAct(room);
}

function finishHand(room) {
  const makerTeam = teamOfSeat(room.maker);
  const defenderTeam = 1 - makerTeam;
  const makerTricks = room.tricks[makerTeam];

  let points = 0;
  let winnerTeam = makerTeam;
  let summary = "";

  if (makerTricks >= 3) {
    if (makerTricks === 5 && room.alone) {
      points = 4;
      summary = `${teamLabel(room, makerTeam)} made trump alone and swept all 5 tricks for 4 points.`;
    } else if (makerTricks === 5) {
      points = 2;
      summary = `${teamLabel(room, makerTeam)} made trump and swept all 5 tricks for 2 points.`;
    } else {
      points = 1;
      summary = `${teamLabel(room, makerTeam)} made trump and took 3 or more tricks for 1 point.`;
    }
  } else {
    winnerTeam = defenderTeam;
    points = 2;
    summary = `${teamLabel(room, defenderTeam)} euchred the makers for 2 points.`;
  }

  room.score[winnerTeam] += points;
  room.phase = "handOver";
  room.message = summary;

  emitRoom(room);

  if (room.score[0] >= 10 || room.score[1] >= 10) {
    room.phase = "gameOver";
    room.message = `${teamLabel(room, winnerTeam)} win the game.`;
    emitRoom(room);
    return;
  }

  room.dealer = (room.dealer + 1) % 4;

  setTimeout(() => {
    startHand(room);
  }, 2500);
}

function useBottoms(room, seat) {
  if (room.phase !== "bidding") return;
  if (seat !== room.currentTurn) return;

  const player = room.players[seat];

  if (!hasBottoms(player.hand)) return;

  const bottomThree = room.kitty.slice(1, 4);

  player.hand.push(...bottomThree);
  room.kitty = [room.upcard];

  room.phase = "bottomsDiscard";

  addBidLog(room, `${player.name} used Bottoms. This counts as a pass.`);

  room.message = `${player.name} used Bottoms and must discard 3 cards.`;

  emitRoom(room);

  if (player.bot) {
    setTimeout(() => {
      const discards = chooseBotBottomsDiscards(player.hand);
      finishBottoms(room, seat, discards.map(card => card.id));
    }, 800);
  }
}

function finishBottoms(room, seat, cardIds) {
  if (room.phase !== "bottomsDiscard") return;
  if (seat !== room.currentTurn) return;
  if (!Array.isArray(cardIds)) return;
  if (cardIds.length !== 3) return;

  const player = room.players[seat];

  for (const id of cardIds) {
    const index = player.hand.findIndex(card => card.id === id);

    if (index === -1) {
      return;
    }
  }

  for (const id of cardIds) {
    const index = player.hand.findIndex(card => card.id === id);
    player.hand.splice(index, 1);
  }

  room.phase = "bidding";
  nextBidTurn(room);
}

function chooseBotDiscard(hand, trump) {
  return [...hand].sort((a, b) => {
    const aPower = cardPower(a, trump, effectiveSuit(a, trump));
    const bPower = cardPower(b, trump, effectiveSuit(b, trump));

    return aPower - bPower;
  })[0];
}

function chooseBotBottomsDiscards(hand) {
  const rankValue = {
    "9": 1,
    "10": 2,
    J: 3,
    Q: 4,
    K: 5,
    A: 6
  };

  return [...hand]
    .sort((a, b) => rankValue[a.rank] - rankValue[b.rank])
    .slice(0, 3);
}

function botShouldCall(room, seat, suit) {
  const hand = room.players[seat].hand;
  let strength = 0;

  for (const card of hand) {
    const eff = effectiveSuit(card, suit);

    if (eff === suit) strength += 1;

    if (card.rank === "A" && eff !== suit) {
      strength += 0.5;
    }

    if (
      card.rank === "J" &&
      (card.suit === suit || card.suit === sameColorSuit(suit))
    ) {
      strength += 1;
    }
  }

  return strength >= 3;
}

function chooseBotCard(room, seat) {
  const player = room.players[seat];

  const validCards = player.hand.filter(card => {
    return canPlayCard(player.hand, card, room.leadSuit, room.trump);
  });

  if (!room.leadSuit) {
    return [...validCards].sort((a, b) => {
      const aPower = cardPower(a, room.trump, effectiveSuit(a, room.trump));
      const bPower = cardPower(b, room.trump, effectiveSuit(b, room.trump));

      return bPower - aPower;
    })[0];
  }

  return [...validCards].sort((a, b) => {
    const aPower = cardPower(a, room.trump, room.leadSuit);
    const bPower = cardPower(b, room.trump, room.leadSuit);

    return aPower - bPower;
  })[0];
}

function botMaybeAct(room) {
  const player = room.players[room.currentTurn];

  if (!player || !player.bot) return;

  setTimeout(() => {
    if (room.phase === "bidding") {
      if (hasBottoms(player.hand) && Math.random() < 0.35) {
        useBottoms(room, player.seat);
        return;
      }

      if (room.biddingRound === 1) {
        const shouldCall = botShouldCall(room, player.seat, room.upcard.suit);

        if (shouldCall) {
          orderUp(room, player.seat, Math.random() < 0.15);
        } else {
          playerPass(room, player.seat);
        }

        return;
      }

      if (room.biddingRound === 2) {
        const chosenSuit = SUITS.find(suit => {
          return botShouldCall(room, player.seat, suit);
        });

        if (chosenSuit) {
          makeTrump(room, player.seat, chosenSuit, Math.random() < 0.15);
        } else {
          playerPass(room, player.seat);
        }
      }
    }

    if (room.phase === "playing") {
      const card = chooseBotCard(room, player.seat);

      if (card) {
        playCard(room, player.seat, card.id);
      }
    }
  }, 700);
}

io.on("connection", socket => {
  socket.on("createRoom", ({ name, singlePlayer }) => {
    const roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
    const room = createRoom(roomId);

    joinSeat(room, socket, name || "Player 1", 0);

    if (singlePlayer) {
      fillBots(room);
      startHand(room);
    } else {
      room.message = `Room ${roomId} created. Share this room code with friends.`;
      emitRoom(room);
    }

    socket.emit("roomCreated", { roomId });
    emitRoom(room);
  });

  socket.on("joinRoom", ({ roomId, name }) => {
    const normalizedRoomId = String(roomId || "").toUpperCase();
    const room = rooms.get(normalizedRoomId);

    if (!room) {
      socket.emit("errorMessage", "Room not found.");
      return;
    }

    try {
      joinSeat(room, socket, name || "Player", null);
      room.message = `${name || "Player"} joined.`;
      emitRoom(room);
    } catch (error) {
      socket.emit("errorMessage", error.message);
    }
  });

  socket.on("addBots", () => {
    const room = rooms.get(socket.data.roomId);

    if (!room) return;

    fillBots(room);
    room.message = "Bots filled empty seats.";

    emitRoom(room);
  });

  socket.on("startGame", () => {
    const room = rooms.get(socket.data.roomId);

    if (!room) return;

    const ready = room.players.every(player => {
      return player.socketId || player.bot;
    });

    if (!ready) {
      socket.emit("errorMessage", "Need 4 players or fill empty seats with bots.");
      return;
    }

    startHand(room);
  });

  socket.on("pass", () => {
    const room = rooms.get(socket.data.roomId);

    if (!room) return;

    playerPass(room, socket.data.seat);
  });

  socket.on("bottoms", () => {
    const room = rooms.get(socket.data.roomId);

    if (!room) return;

    useBottoms(room, socket.data.seat);
  });

  socket.on("finishBottoms", ({ cardIds }) => {
    const room = rooms.get(socket.data.roomId);

    if (!room) return;

    finishBottoms(room, socket.data.seat, cardIds);
  });

  socket.on("orderUp", ({ alone }) => {
    const room = rooms.get(socket.data.roomId);

    if (!room) return;

    orderUp(room, socket.data.seat, alone);
  });

  socket.on("makeTrump", ({ suit, alone }) => {
    const room = rooms.get(socket.data.roomId);

    if (!room) return;

    makeTrump(room, socket.data.seat, suit, alone);
  });

  socket.on("dealerDiscard", ({ cardId }) => {
    const room = rooms.get(socket.data.roomId);

    if (!room) return;

    discardDealer(room, socket.data.seat, cardId);
  });

  socket.on("playCard", ({ cardId }) => {
    const room = rooms.get(socket.data.roomId);

    if (!room) return;

    playCard(room, socket.data.seat, cardId);
  });

  socket.on("disconnect", () => {
    const room = rooms.get(socket.data.roomId);

    if (!room) return;

    const player = room.players.find(p => p.socketId === socket.id);

    if (player) {
      player.socketId = null;
      player.bot = true;
      player.name = `Bot ${player.seat + 1}`;
      room.message = "A player disconnected and was replaced by a bot.";

      emitRoom(room);
      botMaybeAct(room);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Collin Euchre running on port ${PORT}`);
});
