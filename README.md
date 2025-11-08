# 🎛️ Latency Logger

A self-hosted web app for measuring and logging video processing latency across chained devices (e.g. testers, converters, processors, and displays).

Built with:
- **Node.js + Express** backend (SQLite3 storage)
- **React** frontend (client/build)
- Designed for small embedded hosts (Raspberry Pi / LXC)

---

## 🧠 Overview

Latency Logger maintains a database of:
- **Devices** (with category, I/O carriers, notes, genlock flag)
- **Measurements** (signal format, rate, test samples, computed mean)
- **Chains** (ordered device paths for inference and validation)

It can infer per-device latency by comparing known measurements in a chain against a new *Device Under Test (DUT)*.

---

## ⚙️ Setup

### 1. Install dependencies
```bash
cd /opt/latencylogger
npm install
cd client
npm install
npm run build
```

### 2. Run locally
```bash
node /opt/latencylogger/index.js
# or via systemd
sudo systemctl start latencylogger
```

### 3. Access the UI
Open your browser at:

http://<host>:3000

### 🧩 API Summary

| Endpoint | Method | Description |
|-----------|---------|-------------|
| `/api/devices` | GET / POST / PUT | List or manage devices |
| `/api/measurements` | GET / POST | Retrieve or insert measurements |
| `/api/chain-validate-structured` | POST | Validate chain and infer DUT latency |

### 📁 Directory Structure

/opt/latencylogger
├── client/                # React frontend
│   ├── src/               # Components
│   └── build/             # Compiled output (served by Express)
├── index.js               # Express API server
├── db.sqlite3             # Primary SQLite database
├── package.json
└── latencylogger.service  # Optional systemd unit

### 🧪 Example Chain

```Lag Tester → BMD BiDirectional 12G → Disguise vx4 → Dell U2415```

When validating:
	•	Known devices contribute to the known total latency.
	•	The DUT latency is inferred from the measured chain mean.

### 🧾 License

MIT © 2025 Dan Hall