# Solana Copy Trading Simulator & Monitor

A command-line interface (CLI) tool written in Node.js (ES Module) to track and simulate copy trading on Solana for a specific wallet address. It processes swap transactions (swaps of SOL/WSOL for other SPL tokens) and simulates trade copies based on customized risk parameters.

---

## Features

- **Double-Mode Operation**:
  - **Backtest**: Fetches and parses historical transactions, executes copy-trading simulation side-by-side using three position-sizing strategies, and prints performance reports.
  - **Live Monitor**: Listens to transaction logs in real-time via WebSockets and reports copy actions instantly (both entry buys and exit sells).
- **Fractional Exits (Partial Sells)**: Mirrors partial sells proportionally. If the target sells 20% of their holdings, you copy-sell 20% of yours.
- **Robust RPC Fetching**: Implements automatic exponential backoff retry cycles on rate-limited public RPC endpoints (429 HTTP status).
- **Supports WSOL & SOL**: Accurately sums native SOL and Wrapped SOL (WSOL) adjustments to track exact transaction entry and exit values.

---

## Copy Sizing Strategy: Risk-Scaled Sizing

The script evaluates the target's risk relative to their balance to determine copy size:
1. **Target Risk Ratio ($R_{target}$)**: Calculated as $\frac{\text{Target SOL Spent}}{\text{Target SOL Balance Before Trade}}$.
2. **Raw Copy Size**: Calculated as $R_{target} \times \text{User Starting Capital}$.
3. **Boundaries**: Clamped to the range $[0.05 \text{ SOL}, 0.10 \text{ SOL}]$.

If the target risks 10% of their wallet, the copy sizes to 10% of your capital ($0.10$ SOL). If they risk 2%, it sizes to 2% ($0.02$ SOL), clamped to the $0.05$ SOL minimum.

---

## Installation & Setup

1. Make sure **Node.js** (v20+ recommended) is installed.
2. In this folder, install the necessary dependencies:
   ```bash
   npm install
   ```
3. Set up your environment variables. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
4. Adjust settings inside `.env`:
   - `RPC_URL`: Replace with a custom node (e.g. from Helius, QuickNode, or Alchemy) for speed and rate-limit exemption.
   - `TARGET_WALLET`: Wallet address to copy-trade (`3BLjRcxWGtR7WRshJ3hL25U3RjWr5Ud98wMcczQqk4Ei`).
   - `START_CAPITAL`: Initial simulated balance in SOL (default: `1.0`).
   - `MIN_COPY_SIZE`: Minimum copy trade size in SOL (default: `0.05`).
   - `MAX_COPY_SIZE`: Maximum copy trade size in SOL (default: `0.10`).

---

## Usage

### 1. Run Historical Backtest
Analyzes the last `N` transactions (e.g. `100`), executes simulations, and displays reports comparing Fixed 0.05 SOL, Fixed 0.10 SOL, and Risk-Scaled strategies:
```bash
node index.js backtest 100
```

### 2. Live Monitoring Mode
Listens to real-time blockchain logs. When the target wallet performs a buy (> 0.9 SOL) or any sell, the console prints an action guide and updates your simulated live portfolio:
```bash
node index.js monitor
```

---

## Project Structure

- `package.json`: Configures scripts and ESM packages.
- `config.js`: Parses and validates configuration values.
- `utils.js`: Helpers for math, console formatting, and block-time conversions.
- `parser.js`: Connects to RPC nodes, fetches transactions, and decodes token swaps.
- `simulator.js`: Engine that runs the chronological copy-trading simulation.
- `monitor.js`: Subscribes to RPC WebSockets for live logging.
- `index.js`: Main CLI router and reporting template.
