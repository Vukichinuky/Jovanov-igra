/* Hex map for The Quiet Wood.
   - 20 cols x 20 rows = 400 tiles. Each tile is numbered 0..399.
   - Odd-r offset coordinates (pointy-top hexes, odd rows shifted right).
   - Tiles are pre-seeded at game start: most are forest, a few are
     "landmark" tiles holding specific cards (artefacts, ruins, chests,
     hidden caches, snakes, wolves, whispers, etc.).
   - A tile's content is consumed the first time a player resolves it. */

const Grid = (() => {
  const COLS = 20;
  const ROWS = 20;
  const TOTAL = COLS * ROWS;

  function idAt(col, row) { return row * COLS + col; }
  function colOf(id)      { return id % COLS; }
  function rowOf(id)      { return Math.floor(id / COLS); }

  // Odd-r offset neighbors.
  function neighbors(id) {
    const c = colOf(id), r = rowOf(id);
    const odd = r & 1;
    const deltas = odd
      ? [[+1, 0], [-1, 0], [0, -1], [+1, -1], [0, +1], [+1, +1]]
      : [[+1, 0], [-1, 0], [-1, -1], [0, -1], [-1, +1], [0, +1]];
    const out = [];
    for (const [dc, dr] of deltas) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
      out.push(idAt(nc, nr));
    }
    return out;
  }

  // Convert odd-r offset to cube for distance math.
  function toCube(id) {
    const col = colOf(id), row = rowOf(id);
    const x = col - (row - (row & 1)) / 2;
    const z = row;
    const y = -x - z;
    return { x, y, z };
  }

  function distance(a, b) {
    const ca = toCube(a), cb = toCube(b);
    return Math.max(Math.abs(ca.x - cb.x), Math.abs(ca.y - cb.y), Math.abs(ca.z - cb.z));
  }

  // Find a tile far from a set of existing tiles (>= minDist).
  function findFarTile(taken, minDist) {
    // Try random until we find one; fallback to best-effort.
    let best = null, bestScore = -1;
    for (let attempt = 0; attempt < 200; attempt++) {
      const cand = RNG.int(TOTAL);
      if (taken.has(cand)) continue;
      let minSeen = Infinity;
      for (const t of taken) {
        const d = distance(cand, t);
        if (d < minSeen) minSeen = d;
      }
      if (minSeen >= minDist) return cand;
      if (minSeen > bestScore) { bestScore = minSeen; best = cand; }
    }
    return best != null ? best : RNG.int(TOTAL);
  }

  /* Build the map. Returns { tiles: [...], playerStarts: [tileIds...] } */
  function build(numPlayers) {
    const tiles = [];
    for (let i = 0; i < TOTAL; i++) {
      tiles.push({
        id: i,
        col: colOf(i),
        row: rowOf(i),
        cardId: null,       // filled below
        consumed: false,    // becomes true after first resolution
        revealedBy: new Set(),
      });
    }

    // Pick landmark tile counts.
    const landmarkPlan = [
      { cardId: "artefact_fragment", n: 3, minSpread: 8 },  // race to find these
      { cardId: "ruins_npc",         n: 2, minSpread: 6 },
      { cardId: "chest",             n: 5, minSpread: 4 },
      { cardId: "hidden_cache",      n: 4, minSpread: 4 },
      { cardId: "wild_boar",         n: 4, minSpread: 3 },
      { cardId: "wolves",            n: 3, minSpread: 4 },
      { cardId: "snake",             n: 5, minSpread: 3 },
      { cardId: "whisper",           n: 4, minSpread: 3 },
      { cardId: "shape_at_treeline", n: 4, minSpread: 3 },
      { cardId: "lost_trail",        n: 3, minSpread: 4 },
      { cardId: "ghost_sighting",    n: 3, minSpread: 4 },
      { cardId: "still_water",       n: 6, minSpread: 3 },
    ];

    const placed = new Set();
    for (const plan of landmarkPlan) {
      for (let i = 0; i < plan.n; i++) {
        const t = findFarTile(placed, plan.minSpread);
        tiles[t].cardId = plan.cardId;
        placed.add(t);
      }
    }

    // Everything else: "old_path" or "empty_clearing" — quiet tiles.
    for (const tile of tiles) {
      if (!tile.cardId) {
        tile.cardId = RNG.chance(0.4) ? "old_path" : "empty_clearing";
      }
    }

    // Player starting tiles — spread across the map. Corners-ish.
    const corners = [
      idAt(2, 2),
      idAt(COLS - 3, ROWS - 3),
      idAt(COLS - 3, 2),
      idAt(2, ROWS - 3),
    ];
    const playerStarts = corners.slice(0, numPlayers).map((startId) => {
      // make sure the start tile is empty (no monster on spawn)
      tiles[startId].cardId = "empty_clearing";
      tiles[startId].consumed = true; // start tile is "known"
      return startId;
    });

    return { tiles, playerStarts, cols: COLS, rows: ROWS, total: TOTAL };
  }

  return { build, neighbors, distance, COLS, ROWS, TOTAL, idAt, colOf, rowOf };
})();
