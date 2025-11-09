import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

function App() {
  // ---------- State ----------
  const [devices, setDevices] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [deviceForm, setDeviceForm] = useState({
    name: "",
    category: "display",
    input_carrier: "",
    output_carrier: "",
    genlockable: false,
    notes: "",
  });
  const [measurements, setMeasurements] = useState([]);
  const [chain, setChain] = useState([]);
  const [chainConfig, setChainConfig] = useState([]);
  const [chainComplete, setChainComplete] = useState(false);
  const [readyToValidate, setReadyToValidate] = useState(false);
  const [dutIndex, setDutIndex] = useState(null);
  const [signalFormat, setSignalFormat] = useState("");
  const [rate, setRate] = useState("");
  const [tests, setTests] = useState({ t1: "", t2: "", t3: "" });
  const [mean, setMean] = useState("");
  const [validationResult, setValidationResult] = useState(null);
  const [validationMsg, setValidationMsg] = useState("");
  const [availableModes, setAvailableModes] = useState(() => {
    const stored = localStorage.getItem("modes");
    return stored ? JSON.parse(stored) : ["AUX", "Destination", "Full Speed", "Other"];
  });

  // Modal + table toggles
const [showAddModal, setShowAddModal] = useState(false);
const [showDevicesTable, setShowDevicesTable] = useState(false);

const openAddModal = () => {
  setEditingId(null);
  setDeviceForm({
    name: "",
    category: "display",
    input_carrier: "",
    output_carrier: "",
    genlockable: false,
    notes: "",
  });
  setShowAddModal(true);
};

const closeAddModal = () => {
  setShowAddModal(false);
};

  // ---------- Fetch ----------
  const fetchDevices = async () => {
    const res = await fetch("/api/devices");
    setDevices(await res.json());
  };
  const fetchMeasurements = async () => {
    const res = await fetch("/api/measurements");
    setMeasurements(await res.json());
  };
  useEffect(() => { fetchDevices(); fetchMeasurements(); }, []);

  // ---------- Device CRUD ----------
  const handleAddOrUpdateDevice = async (e) => {
    e.preventDefault();
    const method = editingId ? "PUT" : "POST";
    const url = editingId ? `/api/devices/${editingId}` : "/api/devices";
    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(deviceForm),
    });
    setDeviceForm({
      name: "",
      category: "display",
      input_carrier: "",
      output_carrier: "",
      genlockable: false,
      notes: "",
    });
    setEditingId(null);
    fetchDevices();
  };

  const startEdit = (d) => { setEditingId(d.id); setDeviceForm({ ...d }); };
  const cancelEdit = () => {
    setEditingId(null);
    setDeviceForm({
      name: "",
      category: "display",
      input_carrier: "",
      output_carrier: "",
      genlockable: false,
      notes: "",
    });
  };

  // ---------- Chain builder ----------
  const startNewTest = () => {
    const tester = devices.find(d => d.category === "tester");
    if (!tester) return alert("No tester device found.");
    setChain([tester]);
    setChainComplete(false);
  };

  const addDeviceToChain = (id) => {
    const next = devices.find(d => d.id === Number(id));
    if (!next) return;
    const completed = [...chain, next];
    setChain(completed);
    if (next.category === "display") {
      setChainComplete(true);
      const defaults = completed.map(d => ({
        device_id: d.id,
        input_carrier: (d.input_carrier || "").split(",")[0] || "",
        output_carrier: (d.output_carrier || "").split(",")[0] || "",
        mode: "",
        genlock_used: false,
        is_dut: false
      }));
      setChainConfig(defaults);
      const lastNonDisplayIdx = [...completed].reverse().findIndex(d => d.category !== "display");
      const idx = lastNonDisplayIdx >= 0 ? (completed.length - 1 - lastNonDisplayIdx) : (completed.length - 1);
      setDutIndex(idx);
    }
  };

  // ---------- Auto mean ----------
  useEffect(() => {
    const vals = Object.values(tests).map(parseFloat).filter(v => !isNaN(v));
    if (vals.length === 3) setMean((vals.reduce((a, b) => a + b, 0) / 3).toFixed(1));
  }, [tests]);

  // ---------- Auto validation ----------
  useEffect(() => {
  if (!chainComplete || !readyToValidate) return;
  if (!signalFormat || !rate || dutIndex == null) return;

  // derive is_dut from dutIndex every time
  const payload = {
    chain_devices: chain.map((d, i) => ({
      ...(chainConfig[i] || {}),
      device_id: d.id,
      is_dut: i === dutIndex,
    })),
    signal_format: signalFormat,
    rate,
  };

  fetch("/api/chain-validate-structured", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then((r) => r.json())
    .then((data) => {
  setValidationResult(data);
  if (data.valid) {
    const inC  = data.dut_config?.input_carrier  ?? "—";
    const outC = data.dut_config?.output_carrier ?? "—";
    const known = (data.known_total_ms ?? null) != null ? Number(data.known_total_ms).toFixed(1) : "—";
    const chainMean = (data.chain_mean_ms ?? null) != null ? Number(data.chain_mean_ms).toFixed(1) : (mean || "—");
    const pred = (data.inferred_per_device ?? null) != null ? Number(data.inferred_per_device).toFixed(1) : "—";

    const dutRow = chainConfig[dutIndex] || {};
setValidationMsg(
  data.valid
    ? `✅ Chain valid — DUT ${data.dut?.name || ""} ready. ` +
      `Chain mean: ${mean ?? "?"} ms / Known total: ${data.known_total_ms ?? "?"} ms / ` +
      `Predicted DUT: ${data.inferred_per_device ?? "?"} ms ` +
      `(I/O: ${dutRow.input_carrier || "—"} → ${dutRow.output_carrier || "—"})`
    : `❌ ${data.reason}`
);
  } else {
    setValidationMsg(`❌ ${data.reason}`);
  }
})
    .catch((err) => setValidationMsg("⚠️ Validation error: " + err.message));
}, [chainConfig, signalFormat, rate, dutIndex, chainComplete, readyToValidate]);

  // ---------- Save handler ----------
const handleSaveMeasurement = async () => {
  if (!validationResult?.valid) return alert("Validation failed.");
  if (!mean) return alert("No mean calculated.");

  // derive is_dut from dutIndex at the moment of save
  const payload = {
    chain_devices: chain.map((d, i) => ({
      ...(chainConfig[i] || {}),
      device_id: d.id,
      is_dut: i === dutIndex,
    })),
  signal_format: signalFormat,
  rate: parseFloat(rate),
  chain_mean_ms: parseFloat(mean),
  };

  const res = await fetch("/api/chain-validate-structured", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.valid) return alert(`❌ ${data.reason}`);
const inC  = data.dut_config?.input_carrier  ?? "—";
const outC = data.dut_config?.output_carrier ?? "—";
alert(`💾 DUT ${data.dut.name} (${inC}→${outC}) saved @ ${data.inferred_per_device} ms`);
fetchMeasurements();
};
 

  // ---------- UI ----------
  return (
    <div style={{ fontFamily: "system-ui", padding: 16, maxWidth: 1100, margin: "auto" }}>
      <h2>Latency Logger</h2>

    {/* --- Devices --- */}
<h3>Devices</h3>

<div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
  <button onClick={openAddModal}>➕ Add Device</button>
  <button
    onClick={() => setShowDevicesTable(v => !v)}
    style={{ background: "#eee" }}
    title="Toggle devices list"
  >
    {showDevicesTable ? "Hide Devices" : "Show Devices"}
  </button>
</div>

{/* On-demand devices table */}
{showDevicesTable && (
  <table border="1" cellPadding="6" style={{ borderCollapse: "collapse", width: "100%", marginBottom: 20 }}>
    <thead style={{ background: "#eee" }}>
      <tr>
        <th>ID</th><th>Name</th><th>Category</th><th>Input</th><th>Output</th>
        <th>Genlock</th><th>Notes</th><th>Edit</th>
      </tr>
    </thead>
    <tbody>
      {devices.map(d => (
        <tr key={d.id}>
          <td>{d.id}</td>
          <td>{d.name}</td>
          <td>{d.category}</td>
          <td>{d.input_carrier || ""}</td>
          <td>{d.output_carrier || ""}</td>
          <td>{d.genlockable ? "Yes" : "No"}</td>
          <td>{d.notes}</td>
          <td>
            <button
              onClick={() => {
                startEdit(d);
                setShowAddModal(true);
              }}
            >
              Edit
            </button>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
)}

{/* Add/Edit Device Modal */}
{showAddModal && (
  <div
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.4)",
      display: "grid",
      placeItems: "center",
      zIndex: 1000,
    }}
    role="dialog"
    aria-modal="true"
  >
    <div
      style={{
        width: "min(800px, 92vw)",
        background: "#fff",
        borderRadius: 10,
        boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
        padding: 16,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h4 style={{ margin: 0 }}>{editingId ? "Edit Device" : "Add New Device"}</h4>
        <button onClick={closeAddModal} style={{ background: "#eee" }}>✕</button>
      </div>

      <form
        onSubmit={async (e) => {
          await handleAddOrUpdateDevice(e);
          closeAddModal();
        }}
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}
      >
        <input
          required
          placeholder="Device name"
          value={deviceForm.name}
          onChange={e => setDeviceForm({ ...deviceForm, name: e.target.value })}
        />

        <select
          value={deviceForm.category}
          onChange={e => setDeviceForm({ ...deviceForm, category: e.target.value })}
        >
          <option value="tester">Tester</option>
          <option value="converter">Converter</option>
          <option value="processor">Processor</option>
          <option value="display">Display</option>
          <option value="media server">Media Server</option>
          <option value="other">Other</option>
        </select>

        <input
          placeholder="Input carrier (comma-separated)"
          value={deviceForm.input_carrier}
          onChange={e => setDeviceForm({ ...deviceForm, input_carrier: e.target.value })}
        />
        <input
          placeholder="Output carrier (comma-separated)"
          value={deviceForm.output_carrier}
          onChange={e => setDeviceForm({ ...deviceForm, output_carrier: e.target.value })}
        />

        <input
          placeholder="Notes"
          value={deviceForm.notes}
          onChange={e => setDeviceForm({ ...deviceForm, notes: e.target.value })}
        />

        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={deviceForm.genlockable}
            onChange={e => setDeviceForm({ ...deviceForm, genlockable: e.target.checked })}
          />
          Genlockable
        </label>

        <div style={{ display: "flex", gap: 8, gridColumn: "1 / -1" }}>
          <button type="submit">
            {editingId ? "Update Device" : "Add Device"}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={() => {
                cancelEdit();
                closeAddModal();
              }}
              style={{ background: "#eee" }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  </div>
)}

      {/* --- Chain Builder --- */}
      <h3>New Test (Guided Chain)</h3>
      {!chainComplete ? (
        <>
          <button onClick={startNewTest}>Start New Test</button>
          {chain.length > 0 && (
            <select onChange={e => addDeviceToChain(e.target.value)} style={{ marginLeft: 8 }}>
              <option value="">Add next device…</option>
              {devices.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          )}
          <p>{chain.map(d => d.name).join(" → ")}</p>
        </>
      ) : (
        <>
          <p><strong>Chain complete:</strong> {chain.map(d => d.name).join(" → ")}</p>

          {/* Device config */}
          <table border="1" cellPadding="6" style={{ borderCollapse: "collapse", width: "100%", marginBottom: 12 }}>
            <thead style={{ background: "#eee" }}>
              <tr><th>#</th><th>Device</th><th>Input</th><th>Output</th><th>Mode</th><th>Genlock</th><th>DUT</th></tr>
            </thead>
            <tbody>
              {chain.map((d, i) => {
                const ins = (d.input_carrier || "").split(",").map(s => s.trim()).filter(Boolean);
                const outs = (d.output_carrier || "").split(",").map(s => s.trim()).filter(Boolean);
                const row = chainConfig[i] || {};
                return (
                  <tr key={d.id}>
                    <td>{i + 1}</td><td>{d.name}</td>
                    <td><select value={row.input_carrier}
                      onChange={e => {
                        const cc = [...chainConfig]; cc[i] = { ...row, input_carrier: e.target.value }; setChainConfig(cc);
                      }}>{["", ...ins].map(v => <option key={v} value={v}>{v || "(none)"}</option>)}</select></td>
                    <td><select value={row.output_carrier}
                      onChange={e => {
                        const cc = [...chainConfig]; cc[i] = { ...row, output_carrier: e.target.value }; setChainConfig(cc);
                      }}>{["", ...outs].map(v => <option key={v} value={v}>{v || "(none)"}</option>)}</select></td>
                    <td><select value={row.mode || ""} onChange={e => {
                      if (e.target.value === "__add__") {
                        const newMode = prompt("Enter new mode:");
                        if (newMode) {
                          const clean = newMode.trim();
                          const updated = [...new Set([...availableModes, clean])];
                          setAvailableModes(updated);
                          localStorage.setItem("modes", JSON.stringify(updated));
                          const cc = [...chainConfig]; cc[i] = { ...row, mode: clean }; setChainConfig(cc);
                        }
                      } else {
                        const cc = [...chainConfig]; cc[i] = { ...row, mode: e.target.value }; setChainConfig(cc);
                      }
                    }}>
                      <option value="">(none)</option>
                      {availableModes.map(m => <option key={m} value={m}>{m}</option>)}
                      <option value="__add__">➕ Add new…</option>
                    </select></td>
                    <td style={{ textAlign: "center" }}><input type="checkbox" checked={!!row.genlock_used}
                      onChange={e => {
                        const cc = [...chainConfig]; cc[i] = { ...row, genlock_used: e.target.checked }; setChainConfig(cc);
                      }} /></td>
                    <td style={{ textAlign: "center" }}>
  <input
    type="radio"
    name="dut"
    checked={dutIndex === i}
    onChange={() => {
      setDutIndex(i);
      const cc = [...chainConfig].map((cfg, idx) => ({
        ...cfg,
        is_dut: idx === i
      }));
      setChainConfig(cc);
    }}
    title="Set as DUT"
  />
  {/* near the DUT radio */}
<small style={{opacity:.7}}>
  {dutIndex === i ? "DUT" : ""}
</small>
</td>
</tr>
                );
              })}
            </tbody>
          </table>
          <button onClick={() => setReadyToValidate(true)}>Continue → Validation</button>
        </>
      )}

      {/* --- Validation + Test Entry --- */}
      {readyToValidate && (
        <div style={{ border: "1px solid #ccc", borderRadius: 8, padding: 12, marginTop: 16 }}>
          <h4>Validate / Infer Latency</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
            <input placeholder="Signal format" value={signalFormat} onChange={e => setSignalFormat(e.target.value)} />
            <select value={rate} onChange={e => setRate(e.target.value)}>
              <option value="">Rate (Hz)</option>
              {[23.98, 24, 25, 29.97, 50, 59.94, 60].map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            {["t1", "t2", "t3"].map(k => (
              <input key={k} type="number" step="0.1" placeholder={`${k.toUpperCase()} (ms)`} value={tests[k]} onChange={e => setTests({ ...tests, [k]: e.target.value })} />
            ))}
          </div>

          {mean && <p>🧮 Mean = {mean} ms (not yet saved)</p>}
          {validationMsg && <p>{validationMsg}</p>}

          <button disabled={!validationResult?.valid || !mean} onClick={handleSaveMeasurement} style={{ marginTop: 8 }}>
            💾 Save DUT Result
          </button>
        </div>
      )}

      {/* --- Measurements --- */}
      <h3 style={{ marginTop: 24 }}>Measurements</h3>
      <table border="1" cellPadding="6" style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead style={{ background: "#eee" }}>
          <tr>
  <th>ID</th><th>Device</th><th>Format</th><th>Rate</th>
  <th>IN</th><th>OUT</th>
  <th>Mode</th><th>Genlock</th><th>T1</th><th>T2</th><th>T3</th><th>Mean (ms)</th><th>Date</th>
</tr>
</thead>
        <tbody>
          {measurements.map(m => (
            <tr key={m.id}>
  <td>{m.id}</td>
  <td>{m.device_name}</td>
  <td>{m.signal_format}</td>
  <td>{m.rate}</td>
  <td>{m.input_carrier || ""}</td>
  <td>{m.output_carrier || ""}</td>
  <td>{m.mode}</td>
  <td>{m.ref === "Genlock" ? "Yes" : "No"}</td>
  <td>{m.test1}</td>
  <td>{m.test2}</td>
  <td>{m.test3}</td>
  <td>{m.mean_raw_ms < 0.1 ? "<0.1" : Number(m.mean_raw_ms).toFixed(1)}</td>
  <td>{new Date(m.date).toLocaleString()}</td>
</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
