#!/bin/bash
set -e
echo "=== Setting up React frontend for latencyLogger ==="

cd /opt/latencylogger

# Ensure node/npm available
node -v
npm -v

# --- Create React app scaffold ---
mkdir -p client
cd client
npm init -y >/dev/null
npm install react react-dom react-scripts >/dev/null

mkdir -p src public
cat > src/index.jsx <<'EOF'
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

function App() {
  const [tests, setTests] = useState([]);
  const [form, setForm] = useState({ device: "", format: "", latency_ms: "", converter: "" });

  const fetchTests = async () => {
    const res = await fetch("/api/tests");
    setTests(await res.json());
  };
  useEffect(() => { fetchTests(); }, []);

  const addTest = async (e) => {
    e.preventDefault();
    await fetch("/api/tests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setForm({ device: "", format: "", latency_ms: "", converter: "" });
    fetchTests();
  };

  const del = async (id) => {
    await fetch("/api/tests/" + id, { method: "DELETE" });
    fetchTests();
  };

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem", maxWidth: "600px", margin: "auto" }}>
      <h2>Latency Logger</h2>
      <form onSubmit={addTest} style={{ display: "grid", gap: "0.5rem" }}>
        <input placeholder="Device" value={form.device}
          onChange={e => setForm({ ...form, device: e.target.value })}/>
        <input placeholder="Format" value={form.format}
          onChange={e => setForm({ ...form, format: e.target.value })}/>
        <input placeholder="Latency (ms)" type="number" value={form.latency_ms}
          onChange={e => setForm({ ...form, latency_ms: e.target.value })}/>
        <input placeholder="Converter" value={form.converter}
          onChange={e => setForm({ ...form, converter: e.target.value })}/>
        <button type="submit">Add Entry</button>
      </form>
      <hr/>
      <table border="1" cellPadding="4" style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr><th>ID</th><th>Device</th><th>Format</th><th>Latency</th><th>Converter</th><th>Date</th><th></th></tr>
        </thead>
        <tbody>
          {tests.map(t => (
            <tr key={t.id}>
              <td>{t.id}</td>
              <td>{t.device}</td>
              <td>{t.format}</td>
              <td>{t.latency_ms}</td>
              <td>{t.converter}</td>
              <td>{new Date(t.date).toLocaleString()}</td>
              <td><button onClick={() => del(t.id)}>✖</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
EOF

cat > public/index.html <<'EOF'
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Latency Logger</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
EOF

# --- Build step ---
echo "=== Building React frontend ==="
npx react-scripts build >/dev/null

echo "=== Build complete ==="
echo "React app output in /opt/latencylogger/client/build"
echo "Restarting service..."
systemctl restart latencylogger
systemctl status latencylogger --no-pager
echo "Visit http://10.0.23.7:3000"
