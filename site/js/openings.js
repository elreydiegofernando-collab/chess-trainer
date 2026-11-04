// Common openings by SAN move sequence. The Play view shows the name of the
// longest sequence that matches the moves played so far. Offline, no ECO db.
export const OPENINGS = [
  // 1.e4 e5
  { name: 'Ruy López, Morphy Defense', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'] },
  { name: 'Ruy López (Spanish)', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'] },
  { name: 'Giuoco Piano', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'] },
  { name: 'Two Knights Defense', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6'] },
  { name: 'Italian Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'] },
  { name: 'Scotch Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4'] },
  { name: 'Petrov (Russian) Defense', moves: ['e4', 'e5', 'Nf3', 'Nf6'] },
  { name: 'Philidor Defense', moves: ['e4', 'e5', 'Nf3', 'd6'] },
  { name: "King's Knight Opening", moves: ['e4', 'e5', 'Nf3'] },
  { name: 'Vienna Game', moves: ['e4', 'e5', 'Nc3'] },
  { name: "King's Gambit", moves: ['e4', 'e5', 'f4'] },
  { name: "Bishop's Opening", moves: ['e4', 'e5', 'Bc4'] },
  { name: 'Open Game (1.e4 e5)', moves: ['e4', 'e5'] },
  // Sicilian
  { name: 'Sicilian, Najdorf Variation', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'] },
  { name: 'Sicilian, Open (...d6)', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4'] },
  { name: 'Sicilian Defense, ...Nc6', moves: ['e4', 'c5', 'Nf3', 'Nc6'] },
  { name: 'Sicilian Defense, ...e6', moves: ['e4', 'c5', 'Nf3', 'e6'] },
  { name: 'Sicilian, Closed', moves: ['e4', 'c5', 'Nc3'] },
  { name: 'Sicilian Defense', moves: ['e4', 'c5'] },
  // Other 1.e4
  { name: 'French Defense', moves: ['e4', 'e6'] },
  { name: 'Caro-Kann Defense', moves: ['e4', 'c6'] },
  { name: 'Pirc Defense', moves: ['e4', 'd6'] },
  { name: 'Modern Defense', moves: ['e4', 'g6'] },
  { name: 'Scandinavian Defense', moves: ['e4', 'd5'] },
  { name: "Alekhine's Defense", moves: ['e4', 'Nf6'] },
  // 1.d4
  { name: 'Queen’s Gambit Declined', moves: ['d4', 'd5', 'c4', 'e6'] },
  { name: 'Queen’s Gambit Accepted', moves: ['d4', 'd5', 'c4', 'dxc4'] },
  { name: 'Slav Defense', moves: ['d4', 'd5', 'c4', 'c6'] },
  { name: "Queen's Gambit", moves: ['d4', 'd5', 'c4'] },
  { name: 'London System', moves: ['d4', 'd5', 'Bf4'] },
  { name: 'Nimzo-Indian Defense', moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'] },
  { name: 'Queen’s Indian Defense', moves: ['d4', 'Nf6', 'c4', 'e6', 'Nf3', 'b6'] },
  { name: 'Catalan Opening', moves: ['d4', 'Nf6', 'c4', 'e6', 'g3'] },
  { name: 'Grünfeld Defense', moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'd5'] },
  { name: "King's Indian Defense", moves: ['d4', 'Nf6', 'c4', 'g6'] },
  { name: 'Benoni Defense', moves: ['d4', 'Nf6', 'c4', 'c5'] },
  { name: 'Indian Game', moves: ['d4', 'Nf6'] },
  { name: 'Dutch Defense', moves: ['d4', 'f5'] },
  { name: "Queen's Pawn Game", moves: ['d4', 'd5'] },
  // Flank
  { name: 'English Opening', moves: ['c4'] },
  { name: 'Réti Opening', moves: ['Nf3'] },
  { name: "King's Fianchetto Opening", moves: ['g3'] },
  { name: 'Nimzo-Larsen Attack', moves: ['b3'] },
  { name: "Bird's Opening", moves: ['f4'] },
];

export function matchOpening(sanList) {
  let best = null;
  for (const o of OPENINGS) {
    if (o.moves.length > sanList.length) continue;
    let ok = true;
    for (let i = 0; i < o.moves.length; i++) {
      if (o.moves[i] !== sanList[i]) { ok = false; break; }
    }
    if (ok && (!best || o.moves.length > best.moves.length)) best = o;
  }
  return best ? best.name : '';
}
