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

  /* Build the map. Returns { tiles, playerStarts, ... } */
  function build(numPlayers) {
    const tiles = [];
    for (let i = 0; i < TOTAL; i++) {
      tiles.push({
        id: i,
        col: colOf(i),
        row: rowOf(i),
        cardId: null,
        biome: "wood",   // wood | mountain | river | clearing
        consumed: false,
        trap: null,      // { plantedBy: playerId } if a trap has been laid here
        revealedBy: new Set(),
      });
    }

    // ---- Biomes ----
    // Mountain range: pick 2-3 seeds, grow each into a cluster of 6-10 tiles.
    const mountainSeeds = 2 + RNG.int(2);
    for (let s = 0; s < mountainSeeds; s++) {
      const seed = RNG.int(TOTAL);
      const wantSize = 6 + RNG.int(5);
      const visited = new Set([seed]);
      let frontier = [seed];
      while (visited.size < wantSize && frontier.length) {
        const next = [];
        for (const t of frontier) {
          tiles[t].biome = "mountain";
          for (const n of neighbors(t)) {
            if (visited.size >= wantSize) break;
            if (visited.has(n)) continue;
            if (RNG.chance(0.55)) {
              visited.add(n);
              next.push(n);
            }
          }
        }
        frontier = next;
      }
    }

    // River: pick top-edge tile, drift to a bottom-edge tile via random walk.
    {
      let cur = idAt(RNG.range(2, COLS - 3), 0);
      const seen = new Set([cur]);
      tiles[cur].biome = "river";
      for (let step = 0; step < ROWS * 2 + 5; step++) {
        const nbrs = neighbors(cur).filter(n => !seen.has(n));
        if (nbrs.length === 0) break;
        // Prefer southward drift
        nbrs.sort((a, b) => (rowOf(b) - rowOf(a)) + (RNG.next() - 0.5) * 1.4);
        cur = nbrs[0];
        seen.add(cur);
        // Don't overwrite mountains; rivers cut around them.
        if (tiles[cur].biome !== "mountain") tiles[cur].biome = "river";
        if (rowOf(cur) === ROWS - 1) break;
      }
    }

    // Pick landmark tile counts.
    const landmarkPlan = [
      { cardId: "artefact_fragment", n: 3, minSpread: 8 },
      { cardId: "ruins_npc",         n: 3, minSpread: 5 },
      { cardId: "chest",             n: 6, minSpread: 3 },
      { cardId: "hidden_cache",      n: 4, minSpread: 4 },
      // Boons (permanent stat changes / one-shot help)
      { cardId: "shrine",            n: 2, minSpread: 6 },
      { cardId: "cursed_altar",      n: 2, minSpread: 6 },
      { cardId: "wishing_well",      n: 3, minSpread: 5 },
      { cardId: "stone_marker",      n: 2, minSpread: 6 },
      { cardId: "salt_circle",       n: 2, minSpread: 5 },
      // Threats & eerie
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

    // Player starting tiles — closer together so they actually meet during
    // a 15-round game. Outer ring will close in further as rounds pass.
    const corners = [
      idAt(7, 7),
      idAt(COLS - 8, ROWS - 8),
      idAt(COLS - 8, 7),
      idAt(7, ROWS - 8),
    ];
    const playerStarts = corners.slice(0, numPlayers).map((startId) => {
      tiles[startId].cardId = "empty_clearing";
      tiles[startId].consumed = true;
      return startId;
    });

    return { tiles, playerStarts, cols: COLS, rows: ROWS, total: TOTAL };
  }

  /* Is this tile inside the "dark" outer ring of N tiles? */
  function isDark(tileId, darkRings) {
    if (!darkRings || darkRings <= 0) return false;
    const c = colOf(tileId), r = rowOf(tileId);
    return c < darkRings || c >= COLS - darkRings ||
           r < darkRings || r >= ROWS - darkRings;
  }

  /* Pick a safe interior tile, used to relocate things from the dark ring. */
  function randomInteriorTile(darkRings) {
    const margin = darkRings + 1;
    const c = margin + RNG.int(COLS - 2 * margin);
    const r = margin + RNG.int(ROWS - 2 * margin);
    return idAt(c, r);
  }

  /* Sleep cost to move ONTO a tile, per class. */
  function moveCost(tile, classId) {
    if (!tile) return 1;
    if (tile.biome === "mountain") {
      return classId === "dwarf" ? 1 : 2;
    }
    if (tile.biome === "river") {
      return 1; // rivers are slow but the cost is in sleep elsewhere; treat as 1
    }
    return 1;
  }

  return {
    build, neighbors, distance,
    COLS, ROWS, TOTAL,
    idAt, colOf, rowOf,
    isDark, randomInteriorTile,
    moveCost,
  };
})();
