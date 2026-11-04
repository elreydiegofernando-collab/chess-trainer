// Starter puzzle set — every position and solution is engine-verified.
// goal 'mate'  -> any move that delivers checkmate is accepted.
// goal 'best'  -> the listed solution move is required.
// `solution` is a UCI move used for the "show solution" reveal.
export const STARTER_PUZZLES = [
  {
    id: 'backrank-1', theme: 'Back-rank mate', level: 4, side: 'w', goal: 'mate',
    fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', solution: 'a1a8',
    prompt: 'White to move — checkmate in 1.',
    idea: "The black king is boxed in by its own pawns. A rook on the open back rank is mate. Lesson: give your own king an escape square ('luft') early so you never get mated like this.",
  },
  {
    id: 'backrank-2', theme: 'Back-rank mate', level: 4, side: 'w', goal: 'mate',
    fen: '7k/6pp/8/8/8/8/8/5R1K w - - 0 1', solution: 'f1f8',
    prompt: 'White to move — checkmate in 1.',
    idea: 'Same back-rank pattern from the f-file. Any major piece reaching the 8th rank with no escape squares is mate.',
  },
  {
    id: 'kq-mate-1', theme: 'King + Queen mate', level: 4, side: 'w', goal: 'mate',
    fen: '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1', solution: 'f7g7',
    prompt: 'White to move — checkmate in 1.',
    idea: 'The queen mates next to the enemy king when your own king guards the escape squares. Keep the enemy king on the edge and bring your king up to support — and avoid stalemate by leaving it a legal move until the mate lands.',
  },
  {
    id: 'kq-mate-2', theme: 'King + Queen mate', level: 4, side: 'w', goal: 'mate',
    fen: '5k2/8/5K2/7Q/8/8/8/8 w - - 0 1', solution: 'h5f7',
    prompt: 'White to move — checkmate in 1.',
    idea: 'Your king covers the dark escape squares; the queen swoops in to finish. (There is more than one mate here — any of them counts.)',
  },
  {
    id: 'kr-mate-1', theme: 'King + Rook mate', level: 4, side: 'w', goal: 'mate',
    fen: '6k1/R7/6K1/8/8/8/8/8 w - - 0 1', solution: 'a7a8',
    prompt: 'White to move — checkmate in 1.',
    idea: 'The rook mate: your king takes the opposition directly in front of the enemy king, and the rook checks along the back rank. This is the technique for King+Rook vs King.',
  },
  {
    id: 'win-queen', theme: 'Punish a hanging queen', level: 3, side: 'w', goal: 'best',
    fen: 'r4rk1/ppp2ppp/8/3q4/8/2N5/PPP2PPP/R4RK1 w - - 0 1', solution: 'c3d5',
    prompt: 'White to move — win material.',
    idea: "Black's queen on d5 is undefended ('en prise'). Your knight just takes it for free. This is the #1 habit: before every move scan for the opponent's undefended pieces — and check none of yours are hanging.",
  },
];
