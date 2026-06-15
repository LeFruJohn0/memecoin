"use client";

import { useState, useEffect } from 'react';
import { 
  Wallet, 
  Plus, 
  Trash2, 
  Play, 
  Loader2, 
  TrendingUp, 
  TrendingDown, 
  Info, 
  Percent, 
  Activity, 
  CheckCircle, 
  Coins, 
  ExternalLink,
  ShieldAlert,
  RotateCw,
  LogOut
} from 'lucide-react';

export default function Dashboard() {
  // Lists & active selection
  const [wallets, setWallets] = useState([]);
  const [selectedWallet, setSelectedWallet] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  
  // Scoped data
  const [portfolio, setPortfolio] = useState(null);
  const [holdings, setHoldings] = useState([]);
  const [trades, setTrades] = useState([]);
  
  // Page states
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('positions'); // positions, trades, sandbox

  // Add wallet inputs
  const [newWalletAddress, setNewWalletAddress] = useState('');
  const [newWalletName, setNewWalletName] = useState('');
  const [addWalletLoading, setAddWalletLoading] = useState(false);

  // Backtest inputs & results
  const [backtestLimit, setBacktestLimit] = useState(100);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestResults, setBacktestResults] = useState(null);
  const [backtestError, setBacktestError] = useState(null);

  // Load wallets list on mount
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/wallets');
        const data = await res.json();
        if (data.success) {
          setWallets(data.wallets);
          if (data.wallets.length > 0) {
            setSelectedWallet(data.wallets[0]);
          } else {
            setLoading(false);
          }
        } else {
          setError(data.error);
          setLoading(false);
        }
      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    }
    load();
  }, []);

  async function loadData(showLoadingIndicator = true) {
    if (!selectedWallet) return;
    if (showLoadingIndicator) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);
    setBacktestResults(null);
    setBacktestError(null);
    try {
      const res = await fetch(`/api/portfolio?wallet=${selectedWallet.address}`);
      const data = await res.json();
      if (data.success) {
        setPortfolio(data.portfolio);
        setHoldings(data.holdings);
        setTrades(data.trades);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  // Fetch portfolio details when active wallet changes
  useEffect(() => {
    loadData(true);
  }, [selectedWallet]);

  // Actions
  async function handleAddWallet(e) {
    e.preventDefault();
    if (!newWalletAddress || !newWalletName) return;
    setAddWalletLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: newWalletAddress, name: newWalletName })
      });
      const data = await res.json();
      if (data.success) {
        const updatedRes = await fetch('/api/wallets');
        const updatedData = await updatedRes.json();
        if (updatedData.success) {
          setWallets(updatedData.wallets);
          // Set selection to the newly created wallet
          const added = updatedData.wallets.find(w => w.address === newWalletAddress.trim());
          if (added) setSelectedWallet(added);
        }
        setNewWalletAddress('');
        setNewWalletName('');
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setAddWalletLoading(false);
    }
  }

  async function handleDeleteWallet(address) {
    if (!confirm('Are you sure you want to stop tracking this wallet and wipe its simulated history?')) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/wallets?address=${address}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        const updatedWallets = wallets.filter(w => w.address !== address);
        setWallets(updatedWallets);
        if (updatedWallets.length > 0) {
          setSelectedWallet(updatedWallets[0]);
        } else {
          setSelectedWallet(null);
          setPortfolio(null);
          setHoldings([]);
          setTrades([]);
          setLoading(false);
        }
      } else {
        setError(data.error);
        setLoading(false);
      }
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  async function handleRunBacktest() {
    if (!selectedWallet) return;
    setBacktestLoading(true);
    setBacktestError(null);
    setBacktestResults(null);

    try {
      const res = await fetch(`/api/backtest?wallet=${selectedWallet.address}&limit=${backtestLimit}`);
      const data = await res.json();
      if (data.success) {
        if (data.results) {
          setBacktestResults(data.results);
        } else {
          setBacktestError(data.message || 'No swap transactions processed.');
        }
      } else {
        setBacktestError(data.error);
      }
    } catch (err) {
      setBacktestError(err.message);
    } finally {
      setBacktestLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await fetch('/api/auth', { method: 'DELETE' });
      window.location.reload();
    } catch (err) {
      console.error('Logout failed:', err);
    }
  }

  // Helper selectors
  const totalOpenAssetValue = holdings.reduce((acc, h) => acc + h.solSpent, 0);
  const totalPortfolioValue = portfolio ? (portfolio.capital + totalOpenAssetValue) : 1.0;
  const netPnLSOL = portfolio ? (totalPortfolioValue - 1.0) : 0.0;
  const netPnLPercent = (netPnLSOL / 1.0) * 100;
  
  const wins = trades.filter(t => t.netPnL > 0).length;
  const losses = trades.length - wins;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Navigation */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md px-6 py-4 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center space-x-3">
          <Activity className="h-6 w-6 text-green-400 animate-pulse" />
          <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-green-400 to-cyan-400 bg-clip-text text-transparent">
            SOLANA COPY-TRADER PORTAL
          </h1>
        </div>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </span>
            <span className="text-xs font-semibold text-green-400 tracking-wider uppercase bg-green-950/40 border border-green-800/50 px-2.5 py-0.5 rounded-full hidden sm:inline-block">
              Helius Webhooks Connected
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center space-x-1.5 text-xs text-slate-400 hover:text-red-400 bg-slate-950 border border-slate-850 hover:border-red-900/40 px-3 py-1.5 rounded-xl transition-all shadow-md font-bold"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Lock Portal</span>
          </button>
        </div>
      </header>
          <span className="text-xs font-semibold text-green-400 tracking-wider uppercase bg-green-950/40 border border-green-800/50 px-2.5 py-0.5 rounded-full">
            Helius Webhooks Connected
          </span>
        </div>
      </header>

      {/* Main Body Grid */}
      <div className="flex-1 flex flex-col md:flex-row">
        
        {/* Sidebar Wallet Manager */}
        <aside className="w-full md:w-80 border-r border-slate-850 bg-slate-900/30 p-6 flex flex-col space-y-6">
          
          {/* Add Wallet Form */}
          <div className="glass-panel rounded-xl p-4">
            <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-3 flex items-center space-x-2">
              <Plus className="h-4 w-4 text-green-400" />
              <span>Track New Wallet</span>
            </h2>
            <form onSubmit={handleAddWallet} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Nickname</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Meme Whale"
                  value={newWalletName}
                  onChange={(e) => setNewWalletName(e.target.value)}
                  className="w-full bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-green-500 text-slate-100 placeholder-slate-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Solana PublicKey</label>
                <input
                  type="text"
                  required
                  placeholder="3BLjRc... or B32Qbb..."
                  value={newWalletAddress}
                  onChange={(e) => setNewWalletAddress(e.target.value)}
                  className="w-full bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-green-500 text-slate-100 placeholder-slate-500 font-mono"
                />
              </div>
              <button
                type="submit"
                disabled={addWalletLoading}
                className="w-full bg-gradient-to-r from-green-500 to-cyan-500 hover:from-green-600 hover:to-cyan-600 text-slate-950 font-bold py-2 rounded-lg transition-all text-xs flex items-center justify-center space-x-1.5 shadow-lg shadow-green-500/10"
              >
                {addWalletLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin text-slate-950" />
                ) : (
                  <>
                    <Plus className="h-3.5 w-3.5 text-slate-950" />
                    <span>Track Address</span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Wallets Selector List */}
          <div className="flex-1 flex flex-col min-h-[250px]">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center space-x-1.5">
              <Wallet className="h-3.5 w-3.5 text-cyan-400" />
              <span>Tracked Wallets ({wallets.length})</span>
            </h2>
            <div className="space-y-2.5 overflow-y-auto max-h-[400px] pr-1">
              {wallets.length === 0 ? (
                <p className="text-xs text-slate-500 italic p-3 text-center">No wallets added yet.</p>
              ) : (
                wallets.map((w) => {
                  const isSelected = selectedWallet?.address === w.address;
                  return (
                    <div
                      key={w.address}
                      onClick={() => setSelectedWallet(w)}
                      className={`cursor-pointer rounded-xl p-3.5 transition-all relative flex flex-col justify-between border ${
                        isSelected 
                          ? 'border-green-500/80 bg-green-950/20 text-slate-100 glow-green' 
                          : 'border-slate-800 hover:border-slate-700 bg-slate-900/40 text-slate-300'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-bold text-sm tracking-tight">{w.name}</p>
                          <p className="font-mono text-xs text-slate-500 mt-1">
                            {w.address.slice(0, 8)}...{w.address.slice(-8)}
                          </p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteWallet(w.address);
                          }}
                          className="text-slate-500 hover:text-red-400 transition-colors p-1 rounded-lg hover:bg-slate-950/30"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </aside>

        {/* Dashboard Panels */}
        <main className="flex-1 p-6 overflow-y-auto max-w-6xl mx-auto w-full space-y-6">
          
          {error && (
            <div className="bg-red-950/30 border border-red-800/80 text-red-300 p-4 rounded-xl flex items-start space-x-3">
              <ShieldAlert className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
              <div className="text-sm">
                <span className="font-bold">Error encountered:</span> {error}
              </div>
            </div>
          )}

          {!selectedWallet ? (
            <div className="glass-panel rounded-2xl p-12 text-center flex flex-col items-center justify-center min-h-[400px]">
              <Wallet className="h-12 w-12 text-slate-600 mb-4 animate-bounce" />
              <h3 className="text-lg font-bold text-slate-300">No Target Wallet Configured</h3>
              <p className="text-sm text-slate-500 mt-2 max-w-sm">
                Please type a Solana public address and a custom nickname in the sidebar to create your first isolated copy-trade portfolio.
              </p>
            </div>
          ) : loading ? (
            <div className="flex flex-col items-center justify-center min-h-[400px] space-y-3">
              <Loader2 className="h-8 w-8 animate-spin text-green-400" />
              <span className="text-sm text-slate-400 font-medium">Fetching portfolio metrics...</span>
            </div>
          ) : (
            <>
              {/* Header Profile Title */}
              <div className="flex flex-row items-center justify-between border-b border-slate-850 pb-4">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center space-x-2">
                    <span>{selectedWallet.name}</span>
                    <span className="text-xs font-semibold bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-md font-mono text-slate-400 hidden sm:inline-block">
                      {selectedWallet.address}
                    </span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Simulated portfolio executing trades since creation.
                  </p>
                  <p className="text-[10px] font-mono text-slate-500 mt-0.5 sm:hidden">
                    {selectedWallet.address}
                  </p>
                </div>
                <button
                  onClick={() => loadData(false)}
                  disabled={refreshing}
                  className="bg-slate-900 hover:bg-slate-850 text-slate-300 hover:text-slate-100 border border-slate-800 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 shadow-lg shrink-0"
                >
                  <RotateCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin text-green-400' : 'text-slate-400'}`} />
                  <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
                </button>
              </div>

              {/* KPI Cards Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                
                {/* Total Net PnL Card */}
                <div className="glass-panel rounded-2xl p-5 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Simulated Return</span>
                    {netPnLSOL >= 0 ? (
                      <TrendingUp className="h-5 w-5 text-green-400" />
                    ) : (
                      <TrendingDown className="h-5 w-5 text-red-400" />
                    )}
                  </div>
                  <div className="mt-4">
                    <p className={`text-2xl font-bold tracking-tight ${netPnLSOL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {netPnLSOL >= 0 ? '+' : ''}{netPnLSOL.toFixed(4)} SOL
                    </p>
                    <p className={`text-sm font-semibold mt-0.5 ${netPnLSOL >= 0 ? 'text-green-400/80' : 'text-red-400/80'}`}>
                      {netPnLSOL >= 0 ? '+' : ''}{netPnLPercent.toFixed(2)}%
                    </p>
                  </div>
                </div>

                {/* Capital Metrics Card */}
                <div className="glass-panel rounded-2xl p-5 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Estimated Balance</span>
                    <Coins className="h-5 w-5 text-cyan-400" />
                  </div>
                  <div className="mt-4">
                    <p className="text-2xl font-bold tracking-tight text-slate-100">
                      {totalPortfolioValue.toFixed(4)} SOL
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5 flex justify-between">
                      <span>Available: {portfolio?.capital.toFixed(4)} SOL</span>
                      <span>Assets: {totalOpenAssetValue.toFixed(4)} SOL</span>
                    </p>
                  </div>
                </div>

                {/* Win Rate Card */}
                <div className="glass-panel rounded-2xl p-5 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Win Rate</span>
                    <Percent className="h-5 w-5 text-indigo-400" />
                  </div>
                  <div className="mt-4">
                    <p className="text-2xl font-bold tracking-tight text-slate-100">
                      {winRate.toFixed(1)}%
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {wins} Wins / {losses} Losses ({trades.length} Trades)
                    </p>
                  </div>
                </div>

                {/* Simulated Fees Card */}
                <div className="glass-panel rounded-2xl p-5 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Fees Paid</span>
                    <Info className="h-5 w-5 text-amber-400" />
                  </div>
                  <div className="mt-4">
                    <p className="text-2xl font-bold tracking-tight text-slate-100">
                      {portfolio?.totalFees.toFixed(4)} SOL
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Avg priority fees simulated
                    </p>
                  </div>
                </div>

              </div>

              {/* Tabs Navigation */}
              <div className="flex border-b border-slate-800">
                <button
                  onClick={() => setActiveTab('positions')}
                  className={`px-5 py-3 font-semibold text-sm transition-colors border-b-2 ${
                    activeTab === 'positions' 
                      ? 'border-green-400 text-green-400 bg-green-950/5' 
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Active Positions ({holdings.length})
                </button>
                <button
                  onClick={() => setActiveTab('trades')}
                  className={`px-5 py-3 font-semibold text-sm transition-colors border-b-2 ${
                    activeTab === 'trades' 
                      ? 'border-green-400 text-green-400 bg-green-950/5' 
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Simulated Trade History ({trades.length})
                </button>
                <button
                  onClick={() => setActiveTab('sandbox')}
                  className={`px-5 py-3 font-semibold text-sm transition-colors border-b-2 ${
                    activeTab === 'sandbox' 
                      ? 'border-cyan-400 text-cyan-400 bg-cyan-950/5' 
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Backtest Sandbox
                </button>
              </div>

              {/* Tab Content Panels */}
              <div className="mt-4">
                
                {/* TAB 1: ACTIVE POSITIONS */}
                {activeTab === 'positions' && (
                  <div className="glass-panel rounded-2xl overflow-hidden border border-slate-800">
                    {holdings.length === 0 ? (
                      <div className="p-12 text-center text-slate-500 text-sm italic">
                        No active token holdings found for this wallet.
                      </div>
                    ) : (
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-900/60 border-b border-slate-800 text-xs font-bold text-slate-450 uppercase tracking-wider">
                            <th className="px-6 py-4">Token Mint</th>
                            <th className="px-6 py-4 text-center">Simulated Holding</th>
                            <th className="px-6 py-4 text-center">SOL Cost Basis</th>
                            <th className="px-6 py-4 text-center">Avg Entry Price (SOL)</th>
                            <th className="px-6 py-4 text-center">Entry Time</th>
                            <th className="px-6 py-4 text-right">Links</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-850 text-sm">
                          {holdings.map((h) => (
                            <tr key={h.mint} className="hover:bg-slate-900/20">
                              <td className="px-6 py-4">
                                <div className="flex flex-col">
                                  <span className="font-bold text-slate-100 flex items-center space-x-1.5">
                                    <span className="text-cyan-400 font-mono">{h.tokenSymbol || h.mint.slice(0, 6).toUpperCase()}</span>
                                    {h.tokenName && <span className="text-xs text-slate-400 font-normal">({h.tokenName})</span>}
                                  </span>
                                  <span className="font-mono text-[10px] text-slate-500">
                                    {h.mint.slice(0, 8)}...{h.mint.slice(-8)}
                                  </span>
                                </div>
                              </td>
                              <td className="px-6 py-4 text-center font-medium">
                                {h.amount.toLocaleString()}
                              </td>
                              <td className="px-6 py-4 text-center text-slate-300 font-semibold">
                                {h.solSpent.toFixed(4)} SOL
                              </td>
                              <td className="px-6 py-4 text-center font-mono text-slate-400">
                                {h.entryPrice.toFixed(8)}
                              </td>
                              <td className="px-6 py-4 text-center text-xs text-slate-400">
                                {new Date(h.entryTime).toLocaleString()}
                              </td>
                              <td className="px-6 py-4 text-right">
                                <a
                                  href={`https://solscan.io/token/${h.mint}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center space-x-1 text-xs font-bold text-slate-400 hover:text-green-400 transition-colors bg-slate-950/40 px-2.5 py-1 rounded-md border border-slate-800"
                                >
                                  <span>Solscan</span>
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                {/* TAB 2: COMPLETED TRADES */}
                {activeTab === 'trades' && (
                  <div className="glass-panel rounded-2xl overflow-hidden border border-slate-800">
                    {trades.length === 0 ? (
                      <div className="p-12 text-center text-slate-500 text-sm italic">
                        No completed trades logged yet.
                      </div>
                    ) : (
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-900/60 border-b border-slate-800 text-xs font-bold text-slate-450 uppercase tracking-wider">
                            <th className="px-6 py-4">Token Mint</th>
                            <th className="px-6 py-4 text-center">SOL Invested</th>
                            <th className="px-6 py-4 text-center">SOL Received</th>
                            <th className="px-6 py-4 text-center">PnL (SOL)</th>
                            <th className="px-6 py-4 text-center">PnL (%)</th>
                            <th className="px-6 py-4 text-center">Exit Size</th>
                            <th className="px-6 py-4 text-center">Exit Date</th>
                            <th className="px-6 py-4 text-right">Tx Link</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-850 text-sm">
                          {trades.map((t, idx) => {
                            const isWin = t.netPnL >= 0;
                            return (
                              <tr key={idx} className="hover:bg-slate-900/20">
                                <td className="px-6 py-4">
                                  <div className="flex flex-col">
                                    <span className="font-bold text-slate-300 flex items-center space-x-1.5">
                                      <span className="text-slate-200 font-mono">{t.tokenSymbol || t.tokenMint.slice(0, 6).toUpperCase()}</span>
                                      {t.tokenName && <span className="text-xs text-slate-450 font-normal">({t.tokenName})</span>}
                                    </span>
                                    <span className="font-mono text-[10px] text-slate-500">
                                      {t.tokenMint.slice(0, 8)}...{t.tokenMint.slice(-8)}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-6 py-4 text-center text-slate-400">
                                  {t.solInvested.toFixed(4)}
                                </td>
                                <td className="px-6 py-4 text-center text-slate-300">
                                  {t.solReceived.toFixed(4)}
                                </td>
                                <td className={`px-6 py-4 text-center font-bold ${isWin ? 'text-green-400' : 'text-red-400'}`}>
                                  {isWin ? '+' : ''}{t.netPnL.toFixed(4)}
                                </td>
                                <td className={`px-6 py-4 text-center font-bold ${isWin ? 'text-green-400' : 'text-red-400'}`}>
                                  {isWin ? '+' : ''}{t.pnlPercent.toFixed(2)}%
                                </td>
                                <td className="px-6 py-4 text-center text-xs text-slate-400 font-semibold">
                                  {((t.sellFraction || 1.0) * 100).toFixed(0)}%
                                </td>
                                <td className="px-6 py-4 text-center text-xs text-slate-400">
                                  {new Date(t.sellTime).toLocaleString()}
                                </td>
                                <td className="px-6 py-4 text-right">
                                  <a
                                    href={`https://solscan.io/tx/${t.sellHash}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center space-x-1 text-xs font-bold text-slate-400 hover:text-green-400 transition-colors bg-slate-950/40 px-2.5 py-1 rounded-md border border-slate-800"
                                  >
                                    <span>Tx</span>
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                {/* TAB 3: BACKTEST SANDBOX */}
                {activeTab === 'sandbox' && (
                  <div className="space-y-6">
                    {/* Sandbox Control Widget */}
                    <div className="glass-panel rounded-2xl p-5 border border-slate-850 flex flex-col sm:flex-row items-center justify-between gap-4">
                      <div>
                        <h3 className="text-sm font-bold text-slate-200">Dynamic Backtester Widget</h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Pull historical transactions from the Solana blockchain, isolate trade swaps, and simulate returns.
                        </p>
                      </div>
                      <div className="flex items-center space-x-3 w-full sm:w-auto">
                        <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 shrink-0">
                          <label className="text-xs text-slate-400 mr-2 uppercase font-bold tracking-wider">Limit</label>
                          <input
                            type="number"
                            value={backtestLimit}
                            onChange={(e) => setBacktestLimit(parseInt(e.target.value) || 50)}
                            className="bg-transparent text-slate-100 text-sm focus:outline-none w-16 text-center font-bold"
                          />
                        </div>
                        <button
                          onClick={handleRunBacktest}
                          disabled={backtestLoading}
                          className="flex-1 sm:flex-initial bg-gradient-to-r from-cyan-500 to-indigo-500 hover:from-cyan-600 hover:to-indigo-600 text-slate-950 font-bold py-2 px-5 rounded-lg text-xs transition-all flex items-center justify-center space-x-1.5"
                        >
                          {backtestLoading ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-950" />
                              <span>Backtesting...</span>
                            </>
                          ) : (
                            <>
                              <Play className="h-3.5 w-3.5 text-slate-950 fill-current" />
                              <span>Execute Backtest</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {backtestError && (
                      <div className="bg-amber-950/20 border border-amber-800/80 text-amber-300 p-4 rounded-xl text-sm flex items-start space-x-3">
                        <ShieldAlert className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold">Backtest Simulation Alert:</span> {backtestError}
                        </div>
                      </div>
                    )}

                    {/* Backtest Results Render */}
                    {backtestResults && (
                      <div className="space-y-6">
                        
                        {/* Comparative Results Table */}
                        <div className="glass-panel rounded-2xl overflow-hidden border border-slate-850">
                          <div className="p-4 bg-slate-900/60 border-b border-slate-800 flex justify-between items-center">
                            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Strategy Comparisons</span>
                            <span className="text-xs text-slate-400">Tested on {backtestResults.riskScaled.totalTradesCopied} copied swaps</span>
                          </div>
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-slate-950/40 border-b border-slate-850 text-xs font-semibold text-slate-400">
                                <th className="px-6 py-4">Strategy Mode</th>
                                <th className="px-6 py-4 text-center">Starting Capital</th>
                                <th className="px-6 py-4 text-center">Ending Value</th>
                                <th className="px-6 py-4 text-center">Net Profit/Loss</th>
                                <th className="px-6 py-4 text-center">PnL (%)</th>
                                <th className="px-6 py-4 text-center">Completed / Copied</th>
                                <th className="px-6 py-4 text-center">Win Rate (W-L)</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-850 text-sm">
                              {/* Fixed 0.05 SOL row */}
                              <tr className="hover:bg-slate-900/10">
                                <td className="px-6 py-4 font-bold text-slate-300">Fixed 0.05 SOL</td>
                                <td className="px-6 py-4 text-center text-slate-400">1.0000</td>
                                <td className="px-6 py-4 text-center text-slate-200">{backtestResults.fixed05.finalValue.toFixed(4)}</td>
                                <td className={`px-6 py-4 text-center font-bold ${backtestResults.fixed05.netProfitSOL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                  {backtestResults.fixed05.netProfitSOL >= 0 ? '+' : ''}{backtestResults.fixed05.netProfitSOL.toFixed(4)} SOL
                                </td>
                                <td className={`px-6 py-4 text-center font-bold ${backtestResults.fixed05.netProfitSOL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                  {backtestResults.fixed05.netProfitSOL >= 0 ? '+' : ''}{backtestResults.fixed05.netProfitPercent.toFixed(2)}%
                                </td>
                                <td className="px-6 py-4 text-center text-slate-400">
                                  {backtestResults.fixed05.completedTradesCount} / {backtestResults.fixed05.totalTradesCopied}
                                </td>
                                <td className="px-6 py-4 text-center text-slate-400">
                                  {backtestResults.fixed05.winRate.toFixed(1)}% ({backtestResults.fixed05.wins}W - {backtestResults.fixed05.losses}L)
                                </td>
                              </tr>

                              {/* Fixed 0.10 SOL row */}
                              <tr className="hover:bg-slate-900/10">
                                <td className="px-6 py-4 font-bold text-slate-300">Fixed 0.10 SOL</td>
                                <td className="px-6 py-4 text-center text-slate-400">1.0000</td>
                                <td className="px-6 py-4 text-center text-slate-200">{backtestResults.fixed10.finalValue.toFixed(4)}</td>
                                <td className={`px-6 py-4 text-center font-bold ${backtestResults.fixed10.netProfitSOL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                  {backtestResults.fixed10.netProfitSOL >= 0 ? '+' : ''}{backtestResults.fixed10.netProfitSOL.toFixed(4)} SOL
                                </td>
                                <td className={`px-6 py-4 text-center font-bold ${backtestResults.fixed10.netProfitSOL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                  {backtestResults.fixed10.netProfitSOL >= 0 ? '+' : ''}{backtestResults.fixed10.netProfitPercent.toFixed(2)}%
                                </td>
                                <td className="px-6 py-4 text-center text-slate-400">
                                  {backtestResults.fixed10.completedTradesCount} / {backtestResults.fixed10.totalTradesCopied}
                                </td>
                                <td className="px-6 py-4 text-center text-slate-400">
                                  {backtestResults.fixed10.winRate.toFixed(1)}% ({backtestResults.fixed10.wins}W - {backtestResults.fixed10.losses}L)
                                </td>
                              </tr>

                              {/* Risk Scaled row */}
                              <tr className="bg-green-950/10 border-y border-green-900/40">
                                <td className="px-6 py-4 font-bold text-green-400 flex items-center space-x-1.5">
                                  <span>🌟 Risk-Scaled (0.05 - 0.10)</span>
                                </td>
                                <td className="px-6 py-4 text-center text-slate-400">1.0000</td>
                                <td className="px-6 py-4 text-center text-slate-100 font-semibold">{backtestResults.riskScaled.finalValue.toFixed(4)}</td>
                                <td className={`px-6 py-4 text-center font-bold ${backtestResults.riskScaled.netProfitSOL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                  {backtestResults.riskScaled.netProfitSOL >= 0 ? '+' : ''}{backtestResults.riskScaled.netProfitSOL.toFixed(4)} SOL
                                </td>
                                <td className={`px-6 py-4 text-center font-bold ${backtestResults.riskScaled.netProfitSOL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                  {backtestResults.riskScaled.netProfitSOL >= 0 ? '+' : ''}{backtestResults.riskScaled.netProfitPercent.toFixed(2)}%
                                </td>
                                <td className="px-6 py-4 text-center text-slate-400 font-medium">
                                  {backtestResults.riskScaled.completedTradesCount} / {backtestResults.riskScaled.totalTradesCopied}
                                </td>
                                <td className="px-6 py-4 text-center text-green-400/80 font-medium">
                                  {backtestResults.riskScaled.winRate.toFixed(1)}% ({backtestResults.riskScaled.wins}W - {backtestResults.riskScaled.losses}L)
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>

                        {/* Best / Worst Outliers for Risk-Scaled */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {backtestResults.riskScaled.bestTrade && (
                            <div className="glass-panel rounded-2xl p-5 border border-green-900/30">
                              <h4 className="text-xs font-bold text-green-400 uppercase tracking-wider mb-2 flex items-center space-x-1.5">
                                <span>🏆 Best Simulated Trade</span>
                              </h4>
                              <p className="text-sm font-semibold">
                                Token: <span className="font-mono text-slate-300">
                                  {backtestResults.riskScaled.bestTrade.tokenSymbol || backtestResults.riskScaled.bestTrade.tokenMint.slice(0, 8)}
                                  {backtestResults.riskScaled.bestTrade.tokenName && ` (${backtestResults.riskScaled.bestTrade.tokenName})`}
                                </span>
                              </p>
                              <div className="mt-3 flex justify-between text-xs text-slate-400">
                                <span>Invested: {backtestResults.riskScaled.bestTrade.solInvested.toFixed(4)} SOL</span>
                                <span>Proceeds: {backtestResults.riskScaled.bestTrade.solReceived.toFixed(4)} SOL</span>
                                <span className="text-green-400 font-bold">+{backtestResults.riskScaled.bestTrade.pnlPercent.toFixed(2)}%</span>
                              </div>
                            </div>
                          )}

                          {backtestResults.riskScaled.worstTrade && (
                            <div className="glass-panel rounded-2xl p-5 border border-red-900/30">
                              <h4 className="text-xs font-bold text-red-400 uppercase tracking-wider mb-2 flex items-center space-x-1.5">
                                <span>💀 Worst Simulated Trade</span>
                              </h4>
                              <p className="text-sm font-semibold">
                                Token: <span className="font-mono text-slate-300">
                                  {backtestResults.riskScaled.worstTrade.tokenSymbol || backtestResults.riskScaled.worstTrade.tokenMint.slice(0, 8)}
                                  {backtestResults.riskScaled.worstTrade.tokenName && ` (${backtestResults.riskScaled.worstTrade.tokenName})`}
                                </span>
                              </p>
                              <div className="mt-3 flex justify-between text-xs text-slate-400">
                                <span>Invested: {backtestResults.riskScaled.worstTrade.solInvested.toFixed(4)} SOL</span>
                                <span>Proceeds: {backtestResults.riskScaled.worstTrade.solReceived.toFixed(4)} SOL</span>
                                <span className="text-red-400 font-bold">{backtestResults.riskScaled.worstTrade.pnlPercent.toFixed(2)}%</span>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Detailed Trade logs for backtested recommended strategy */}
                        <div className="glass-panel rounded-2xl overflow-hidden border border-slate-850">
                          <div className="p-4 bg-slate-900/40 border-b border-slate-800 text-xs font-bold text-slate-300 uppercase tracking-wider">
                            Risk-Scaled Backtest Trade Logs
                          </div>
                          {backtestResults.riskScaled.completedTrades.length === 0 ? (
                            <div className="p-8 text-center text-slate-500 text-sm italic">
                              No completed trades during backtest.
                            </div>
                          ) : (
                            <table className="w-full text-left border-collapse">
                              <thead>
                                <tr className="bg-slate-950/20 border-b border-slate-850 text-xs text-slate-400">
                                  <th className="px-6 py-3">Token</th>
                                  <th className="px-6 py-3 text-center">SOL Invested</th>
                                  <th className="px-6 py-3 text-center">SOL Received</th>
                                  <th className="px-6 py-3 text-center">PnL (SOL)</th>
                                  <th className="px-6 py-3 text-center">PnL (%)</th>
                                  <th className="px-6 py-3 text-center">Buy Time</th>
                                  <th className="px-6 py-3 text-center">Sell Time</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-850 text-xs">
                                {backtestResults.riskScaled.completedTrades.map((t, idx) => {
                                  const win = t.netPnL >= 0;
                                  return (
                                    <tr key={idx} className="hover:bg-slate-900/10">
                                      <td className="px-6 py-3 font-mono text-slate-300">
                                        <div className="flex flex-col">
                                          <span className="font-bold text-slate-200">
                                            {t.tokenSymbol || t.tokenMint.slice(0, 6).toUpperCase()}
                                          </span>
                                          <span className="text-[10px] text-slate-500 font-normal">
                                            {t.tokenMint.slice(0, 8)}...{t.tokenMint.slice(-4)}
                                          </span>
                                        </div>
                                      </td>
                                      <td className="px-6 py-3 text-center text-slate-400">{t.solInvested.toFixed(4)}</td>
                                      <td className="px-6 py-3 text-center text-slate-400">{t.solReceived.toFixed(4)}</td>
                                      <td className={`px-6 py-3 text-center font-bold ${win ? 'text-green-400' : 'text-red-400'}`}>
                                        {win ? '+' : ''}{t.netPnL.toFixed(4)}
                                      </td>
                                      <td className={`px-6 py-3 text-center font-bold ${win ? 'text-green-400' : 'text-red-400'}`}>
                                        {win ? '+' : ''}{t.pnlPercent.toFixed(1)}%
                                      </td>
                                      <td className="px-6 py-3 text-center text-slate-500">{new Date(t.buyTime).toLocaleTimeString()}</td>
                                      <td className="px-6 py-3 text-center text-slate-500">{new Date(t.sellTime).toLocaleTimeString()}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                        </div>

                      </div>
                    )}

                  </div>
                )}

              </div>
            </>
          )}

        </main>

      </div>
    </div>
  );
}
