import express from "express";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// ---------- DB ----------
const db = await open({
  filename: "/opt/latencylogger/db.sqlite3",
  driver: sqlite3.Database,
});

// Ensure measurements table schema is always valid
await db.exec(`
  CREATE TABLE IF NOT EXISTS measurements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER,
    signal_format TEXT,
    rate REAL,
    test1 REAL,
    test2 REAL,
    test3 REAL,
    mean_raw_ms REAL,
    ref TEXT,
    mode TEXT,
    date TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES devices(id)
  );
`);

// --- One-time safe migrations for new columns ---
const cols = await db.all(`PRAGMA table_info('measurements')`);
const hasInputCarrier = cols.some((c) => c.name === "input_carrier");
const hasOutputCarrier = cols.some((c) => c.name === "output_carrier");
if (!hasInputCarrier) {
  await db.exec(`ALTER TABLE measurements ADD COLUMN input_carrier TEXT;`);
}
if (!hasOutputCarrier) {
  await db.exec(`ALTER TABLE measurements ADD COLUMN output_carrier TEXT;`);
}

// ---------- DEVICES ----------
app.get("/api/devices", async (_req, res) => {
  const rows = await db.all("SELECT * FROM devices ORDER BY name;");
  res.json(rows);
});

app.post("/api/devices", async (req, res) => {
  try {
    const {
      name,
      category,
      input_carrier,
      output_carrier,
      role,
      genlockable,
      notes,
    } = req.body;

    const result = await db.run(
      `INSERT INTO devices (name, category, input_carrier, output_carrier, role, genlockable, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        category,
        input_carrier,
        output_carrier,
        role ?? null,
        genlockable ? 1 : 0,
        notes ?? null,
      ]
    );

    res.json({ id: result.lastID });
  } catch (err) {
    console.error("❌ /api/devices insert failed:", err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/devices/:id", async (req, res) => {
  const {
    name,
    category,
    input_carrier,
    output_carrier,
    role,
    genlockable,
    notes,
  } = req.body;
  await db.run(
    `UPDATE devices
       SET name=?, category=?, input_carrier=?, output_carrier=?, role=?, genlockable=?, notes=?
     WHERE id=?`,
    [
      name,
      category,
      input_carrier,
      output_carrier,
      role ?? null,
      genlockable ? 1 : 0,
      notes ?? null,
      req.params.id,
    ]
  );
  res.json({ updated: true });
});

// ---------- MEASUREMENTS ----------
app.get("/api/measurements", async (_req, res) => {
  const rows = await db.all(`
    SELECT m.*, d.name AS device_name
    FROM measurements m
    JOIN devices d ON m.device_id = d.id
    ORDER BY m.date DESC;
  `);
  res.json(rows);
});

app.post("/api/measurements", async (req, res) => {
  try {
    const {
      device_id,
      signal_format,
      rate,
      test1,
      test2,
      test3,
      ref,
      mode,
      input_carrier,
      output_carrier,
    } = req.body;

    const tests = [test1, test2, test3].map(Number).filter((n) => !isNaN(n));
    const mean_raw_ms = tests.length
      ? parseFloat((tests.reduce((a, b) => a + b, 0) / tests.length).toFixed(1))
      : 0.0;

    // Dedupe considers I/O carriers
    const existing = await db.get(
      `SELECT id, mean_raw_ms FROM measurements
       WHERE device_id=? AND signal_format=? AND ABS(rate - ?) < 0.01
         AND mode=?
         AND ifnull(input_carrier,'') = ifnull(?, '')
         AND ifnull(output_carrier,'') = ifnull(?, '')`,
      [
        device_id,
        signal_format,
        rate,
        mode || "Inferred",
        input_carrier || null,
        output_carrier || null,
      ]
    );
    if (existing && Math.abs(existing.mean_raw_ms - mean_raw_ms) < 0.05) {
      return res.json({
        inserted: false,
        duplicate: true,
        id: existing.id,
        mean_raw_ms: existing.mean_raw_ms,
      });
    }

    const result = await db.run(
      `INSERT INTO measurements
         (device_id, signal_format, rate,
          test1, test2, test3, mean_raw_ms,
          ref, mode, input_carrier, output_carrier, date)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
      [
        device_id,
        signal_format,
        rate,
        test1 ?? null,
        test2 ?? null,
        test3 ?? null,
        mean_raw_ms,
        ref || null,
        mode || "Manual",
        input_carrier || null,
        output_carrier || null,
      ]
    );

    res.json({
      inserted: true,
      duplicate: false,
      id: result.lastID,
      mean_raw_ms,
    });
  } catch (err) {
    console.error("!! ERROR in /api/measurements:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- CHAINS ----------
app.post("/api/chains", async (req, res) => {
  const { name, device_ids } = req.body;
  if (!device_ids?.length)
    return res.status(400).json({ error: "device_ids array required" });

  let total = 0;
  for (const id of device_ids) {
    const row = await db.get(
      `SELECT mean_raw_ms
         FROM measurements
        WHERE device_id = ?
        ORDER BY date DESC
        LIMIT 1;`,
      [id]
    );
    if (row?.mean_raw_ms) total += row.mean_raw_ms;
  }

  const result = await db.run(
    `INSERT INTO chains (name, device_ids, calculated_latency_ms)
     VALUES (?,?,?)`,
    [name, JSON.stringify(device_ids), total]
  );

  res.json({ id: result.lastID, calculated_latency_ms: total });
});

// ---------- CHAIN VALIDATION (structured unified) ----------
app.post("/api/chain-validate-structured", async (req, res) => {
  try {
    const { chain_devices, signal_format, rate, chain_mean_ms } = req.body;

    if (!Array.isArray(chain_devices) || chain_devices.length === 0) {
      return res.json({ valid: false, reason: "No devices in chain" });
    }

    const parsedDevices = chain_devices.map((d) => ({
      ...d,
      is_dut: d.is_dut === true || d.is_dut === "true" || d.is_dut === 1,
    }));

    const dut = parsedDevices.find((d) => d.is_dut);
    if (!dut) {
      console.error("❌ structured-validate: no DUT in", parsedDevices);
      return res.json({ valid: false, reason: "No DUT specified" });
    }

    const device_ids = parsedDevices.map((d) => d.device_id);
    const placeholders = device_ids.map(() => "?").join(",");

    const allDevices = await db.all(
      `SELECT id, name, category FROM devices WHERE id IN (${placeholders})`,
      device_ids
    );
    const metaById = Object.fromEntries(allDevices.map((d) => [d.id, d]));

    const sink = [...device_ids]
      .reverse()
      .map((id) => metaById[id])
      .find((d) => d && d.category === "display");

    console.log("CHAIN VALIDATION DEBUG →");
    console.log("ordered ids:", device_ids);
    console.log("sink:", sink);
    console.log("dut:", dut);

    if (!sink) {
      return res.json({
        valid: false,
        reason: "Chain must include a display (sink)",
      });
    }

    const sinkKnown = await db.get(
      `SELECT AVG(mean_raw_ms) AS mean
         FROM measurements
        WHERE device_id=? AND signal_format=? AND ABS(rate - ?) < 0.01`,
      [sink.id, signal_format, rate]
    );

    const sinkBootstrap = !sinkKnown?.mean && dut.device_id === sink.id;
    if (!sinkKnown?.mean && !sinkBootstrap) {
      return res.json({
        valid: false,
        reason: `Display ${sink.name} has no known measurement for ${signal_format}@${rate}`,
      });
    }

    const knownMap = {};

    const testerRows = await db.all(
      `SELECT id FROM devices WHERE id IN (${placeholders}) AND category='tester'`,
      device_ids
    );
    testerRows.forEach((t) => (knownMap[t.id] = 0));

    if (sinkKnown?.mean != null) {
      knownMap[sink.id] = sinkKnown.mean;
    }

    const knownRows = await db.all(
      `SELECT device_id, AVG(mean_raw_ms) AS mean
         FROM measurements
        WHERE device_id IN (${placeholders})
          AND signal_format=? AND ABS(rate - ?) < 0.01
        GROUP BY device_id`,
      [...device_ids, signal_format, rate]
    );
    for (const r of knownRows) {
      if (
        r.device_id !== dut.device_id &&
        !(r.device_id in knownMap) &&
        r.mean != null
      ) {
        knownMap[r.device_id] = r.mean;
      }
    }

    const knownTotal = Object.values(knownMap).reduce((a, b) => a + b, 0);
    const unknownIds = device_ids.filter((id) => !(id in knownMap));

    console.log("knownMap:", knownMap);
    console.log("knownTotal:", knownTotal);
    console.log("unknownIds:", unknownIds);

    const hasMean = Number.isFinite(parseFloat(chain_mean_ms));
    if (!hasMean) {
      return res.json({
        valid: true,
        message: "Chain valid (validation-only)",
        dut: metaById[dut.device_id],
        known_total_ms: knownTotal,
        sink_device: {
          id: sink.id,
          name: sink.name,
          mean: sinkKnown?.mean ?? null,
        },
        inferred_per_device: null,
        chain_mean_ms: null,
      });
    }

    const chainMean = parseFloat(Number(chain_mean_ms).toFixed(1));
    const divisor = Math.max(1, unknownIds.length);
    const inferred = (chainMean - knownTotal) / divisor;
    const inferredRounded =
      inferred <= 0 ? 0.1 : parseFloat(inferred.toFixed(1));

    console.log(`→ chain_mean_ms: ${chainMean}`);
    console.log(`→ knownTotal: ${knownTotal}`);
    console.log(`→ inferredRounded: ${inferredRounded}`);

    // Dedupe exact (same mode/rate/format + I/O carriers)
    const existing = await db.get(
      `SELECT id FROM measurements
         WHERE device_id=? AND signal_format=? AND ABS(rate - ?) < 0.01
           AND mode=? AND input_carrier IS ? AND output_carrier IS ?`,
      [
        dut.device_id,
        signal_format,
        rate,
        dut.mode || "Inferred",
        dut.input_carrier || null,
        dut.output_carrier || null,
      ]
    );
    if (existing) {
      return res.json({
        valid: true,
        message: "Duplicate measurement ignored",
        dut: metaById[dut.device_id],
        dut_config: {
          input_carrier: dut.input_carrier || null,
          output_carrier: dut.output_carrier || null,
          mode: dut.mode || "Inferred",
          genlock_used: !!dut.genlock_used,
        },
        chain_mean_ms: chainMean,
        known_total_ms: knownTotal,
        inferred_per_device: inferredRounded,
      });
    }

    // Insert DUT with I/O carriers
    const insert = await db.run(
      `INSERT INTO measurements
         (device_id, signal_format, rate,
          test1, test2, test3, mean_raw_ms,
          ref, mode, input_carrier, output_carrier, date)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
      [
        dut.device_id,
        signal_format,
        rate,
        inferredRounded,
        inferredRounded,
        inferredRounded,
        inferredRounded,
        dut.genlock_used ? "Genlock" : "N/A",
        dut.mode || "Inferred",
        dut.input_carrier || null,
        dut.output_carrier || null,
      ]
    );

    console.log(`✅ DUT ${dut.device_id} inserted with mean ${inferredRounded} ms`);

    return res.json({
      valid: true,
      message: "Chain validated and DUT measurement saved",
      dut: metaById[dut.device_id],
      dut_config: {
        input_carrier: dut.input_carrier || null,
        output_carrier: dut.output_carrier || null,
        mode: dut.mode || "Inferred",
        genlock_used: !!dut.genlock_used,
      },
      chain_mean_ms: chainMean,
      known_total_ms: knownTotal,
      inferred_per_device: inferredRounded,
      id: insert.lastID,
    });
  } catch (err) {
    console.error("!! ERROR in /api/chain-validate-structured:", err);
    return res.status(500).json({ valid: false, reason: err.message });
  }
});

// ---------- SERVE REACT FRONTEND ----------
const clientPath = path.join(__dirname, "client", "build");
app.use(express.static(clientPath));
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(clientPath, "index.html"));
});

// ---------- START ----------
const PORT = 3000;
app.listen(PORT, "0.0.0.0", () =>
  console.log(`LatencyLogger API & UI on http://0.0.0.0:${PORT}`)
);