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
  LogOut,
  Key,
  Link as LinkIcon,
  Settings
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

  // --- Real On-Chain execution additions ---
  const [dashboardMode, setDashboardMode] = useState('simulation'); // 'simulation' or 'live'
  const [executionWallets, setExecutionWallets] = useState([]);
  const [selectedExecWallet, setSelectedExecWallet] = useState(null);
  const [copySettings, setCopySettings] = useState([]);

  // Import Execution Wallet inputs
  const [newExecName, setNewExecName] = useState('');
  const [newExecPrivateKey, setNewExecPrivateKey] = useState('');
  const [importExecLoading, setImportExecLoading] = useState(false);

  // PumpDev API key
  const [pumpDevKey, setPumpDevKey] = useState('');
  const [pumpDevKeyConfigured, setPumpDevKeyConfigured] = useState(false);
  const [pumpDevKeyLoading, setPumpDevKeyLoading] = useState(false);

  // Copy Settings Mapping inputs
  const [mappingTarget, setMappingTarget] = useState('');
  const [mappingExec, setMappingExec] = useState('');
  const [mappingSize, setMappingSize] = useState('0.05');
  const [mappingSlippage, setMappingSlippage] = useState('1000');
  const [saveMappingLoading, setSaveMappingLoading] = useState(false);

  // Live real portfolio state
  const [realBalance, setRealBalance] = useState(0.0);
  const [realHoldings, setRealHoldings] = useState([]);
  const [realTrades, setRealTrades] = useState([]);
  const [realLoading, setRealLoading] = useState(false);
  const [realRefreshing, setRealRefreshing] = useState(false);

  // Load wallets, execution wallets, and copy settings on mount
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

        // Fetch execution wallets
        const execRes = await fetch('/api/execution-wallets');
        const execData = await execRes.json();
        if (execData.success) {
          setExecutionWallets(execData.wallets);
          if (execData.wallets.length > 0) {
            setSelectedExecWallet(execData.wallets[0]);
          }
        }

        // Check if PumpDev API key is already saved
        const pdRes = await fetch('/api/app-settings?key=pumpdev_api_key');
        const pdData = await pdRes.json();
        if (pdData.success) setPumpDevKeyConfigured(pdData.configured);

        // Fetch settings mappings
        const settingsRes = await fetch('/api/copy-settings');
        const settingsData = await settingsRes.json();
        if (settingsData.success) {
          setCopySettings(settingsData.settings);
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

  async function loadRealPortfolio(showLoadingIndicator = true) {
    if (!selectedExecWallet) return;
    if (showLoadingIndicator) {
      setRealLoading(true);
    } else {
      setRealRefreshing(true);
    }
    setError(null);
    try {
      const res = await fetch(`/api/real-portfolio?wallet=${selectedExecWallet.address}`);
      const data = await res.json();
      if (data.success) {
        setRealBalance(data.balance);
        setRealHoldings(data.holdings);
        setRealTrades(data.trades);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setRealLoading(false);
      setRealRefreshing(false);
    }
  }

  // Fetch simulated portfolio details when active target wallet changes
  useEffect(() => {
    loadData(true);
  }, [selectedWallet]);

  // Fetch real portfolio details when active execution wallet changes or dashboardMode flips to live
  useEffect(() => {
    if (dashboardMode === 'live' && selectedExecWallet) {
      loadRealPortfolio(true);
    }
  }, [selectedExecWallet, dashboardMode]);

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

  // --- Real On-Chain execution action handlers ---
  async function handleImportExecWallet(e) {
    e.preventDefault();
    if (!newExecName || !newExecPrivateKey) return;
    setImportExecLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/execution-wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ privateKey: newExecPrivateKey, name: newExecName })
      });
      const data = await res.json();
      if (data.success) {
        const updatedRes = await fetch('/api/execution-wallets');
        const updatedData = await updatedRes.json();
        if (updatedData.success) {
          setExecutionWallets(updatedData.wallets);
          const added = updatedData.wallets.find(w => w.address === data.wallet.address);
          if (added) setSelectedExecWallet(added);
        }
        setNewExecName('');
        setNewExecPrivateKey('');
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setImportExecLoading(false);
    }
  }

  async function handleSavePumpDevKey(e) {
    e.preventDefault();
    if (!pumpDevKey) return;
    setPumpDevKeyLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/app-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'pumpdev_api_key', value: pumpDevKey })
      });
      const data = await res.json();
      if (data.success) {
        setPumpDevKeyConfigured(true);
        setPumpDevKey('');
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setPumpDevKeyLoading(false);
    }
  }

  async function handleDeleteExecWallet(address) {
    if (!confirm('Are you sure you want to delete this execution wallet? This will stop all copy settings mapped to it.')) return;
    setRealLoading(true);
    try {
      const res = await fetch(`/api/execution-wallets?address=${address}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        const updated = executionWallets.filter(w => w.address !== address);
        setExecutionWallets(updated);
        if (updated.length > 0) {
          setSelectedExecWallet(updated[0]);
        } else {
          setSelectedExecWallet(null);
          setRealBalance(0.0);
          setRealHoldings([]);
          setRealTrades([]);
        }
        
        // Refresh copy settings mapping list since DB cascades delete
        const settingsRes = await fetch('/api/copy-settings');
        const settingsData = await settingsRes.json();
        if (settingsData.success) {
          setCopySettings(settingsData.settings);
        }
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setRealLoading(false);
    }
  }

  async function handleAddMapping(e) {
    e.preventDefault();
    if (!mappingTarget || !mappingExec || !mappingSize) return;
    setSaveMappingLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/copy-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetWallet: mappingTarget,
          executionWallet: mappingExec,
          copySize: mappingSize,
          slippageBps: mappingSlippage
        })
      });
      const data = await res.json();
      if (data.success) {
        const settingsRes = await fetch('/api/copy-settings');
        const settingsData = await settingsRes.json();
        if (settingsData.success) {
          setCopySettings(settingsData.settings);
        }
        setMappingTarget('');
        setMappingExec('');
        setMappingSize('0.05');
        setMappingSlippage('1000');
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaveMappingLoading(false);
    }
  }

  async function handleDeleteMapping(targetWallet, executionWallet) {
    if (!confirm('Are you sure you want to remove this copy relation?')) return;
    try {
      const res = await fetch(`/api/copy-settings?targetWallet=${targetWallet}&executionWallet=${executionWallet}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        setCopySettings(prev => prev.filter(s => !(s.targetWallet === targetWallet && s.executionWallet === executionWallet)));
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
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

  // Real stats calculations
  const realWins = realTrades.filter(t => t.netPnL > 0).length;
  const realLosses = realTrades.filter(t => t.status === 'COMPLETED' && t.netPnL <= 0).length;
  const realWinRate = (realWins + realLosses) > 0 ? (realWins / (realWins + realLosses)) * 100 : 0;
  const totalRealPnLSOL = realTrades.reduce((acc, t) => acc + (t.netPnL || 0), 0);
  const totalRealInvested = realTrades.reduce((acc, t) => acc + (t.solInvested || 0), 0);
  const totalRealPnLPercent = totalRealInvested > 0 ? (totalRealPnLSOL / totalRealInvested) * 105 : 0;

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

          {/* Mode Switch Toggle */}
          <div className="flex bg-slate-950 border border-slate-850 rounded-xl p-0.5 shrink-0">
            <button
              onClick={() => {
                setDashboardMode('simulation');
                setActiveTab('positions');
              }}
              className={`px-3.5 py-1 rounded-lg text-xs font-bold transition-all ${
                dashboardMode === 'simulation' 
                  ? 'bg-green-500 text-slate-950 shadow-md shadow-green-500/10' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Paper
            </button>
            <button
              onClick={() => {
                setDashboardMode('live');
                setActiveTab('positions');
              }}
              className={`px-3.5 py-1 rounded-lg text-xs font-bold transition-all ${
                dashboardMode === 'live' 
                  ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/10' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Live
            </button>
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

      {/* Main Body Grid */}
      <div className="flex-1 flex flex-col md:flex-row">
        
        {/* Sidebar Wallet Manager */}
        <aside className="w-full md:w-80 border-r border-slate-850 bg-slate-900/30 p-6 flex flex-col space-y-6 overflow-y-auto max-h-[calc(100vh-80px)]">
          {dashboardMode === 'simulation' ? (
            <>
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

              {/* Tracked Target Wallets list */}
              <div className="flex-1 flex flex-col min-h-[250px]">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center space-x-1.5">
                  <Wallet className="h-3.5 w-3.5 text-green-450" />
                  <span>Tracked Targets ({wallets.length})</span>
                </h2>
                <div className="space-y-2.5 overflow-y-auto max-h-[350px] pr-1">
                  {wallets.length === 0 ? (
                    <p className="text-xs text-slate-500 italic p-3 text-center">No targets added yet.</p>
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
            </>
          ) : (
            <>
              {/* Import Execution Wallet Form */}
              <div className="glass-panel rounded-xl p-4">
                <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-3 flex items-center space-x-2">
                  <Key className="h-4 w-4 text-cyan-400" />
                  <span>Import Exec Wallet</span>
                </h2>
                <form onSubmit={handleImportExecWallet} className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Nickname</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Active Trading"
                      value={newExecName}
                      onChange={(e) => setNewExecName(e.target.value)}
                      className="w-full bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-cyan-500 text-slate-100 placeholder-slate-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1 font-semibold">Private Key (Base58)</label>
                    <input
                      type="password"
                      required
                      placeholder="Solana Private Key"
                      value={newExecPrivateKey}
                      onChange={(e) => setNewExecPrivateKey(e.target.value)}
                      className="w-full bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-cyan-500 text-slate-100 placeholder-slate-500 font-mono"
                    />
                    <span className="text-[10px] text-slate-500 block mt-1 leading-normal italic">
                      Encrypted securely with AES-256-GCM under your secret password vault.
                    </span>
                  </div>
                  <button
                    type="submit"
                    disabled={importExecLoading}
                    className="w-full bg-gradient-to-r from-cyan-500 to-indigo-500 hover:from-cyan-600 hover:to-indigo-600 text-slate-950 font-bold py-2 rounded-lg transition-all text-xs flex items-center justify-center space-x-1.5 shadow-lg shadow-cyan-500/10"
                  >
                    {importExecLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin text-slate-950" />
                    ) : (
                      <>
                        <Plus className="h-3.5 w-3.5 text-slate-950" />
                        <span>Import Wallet</span>
                      </>
                    )}
                  </button>
                </form>
              </div>

              {/* PumpDev API Key */}
              <div className="glass-panel rounded-xl p-4">
                <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-3 flex items-center space-x-2">
                  <Key className="h-4 w-4 text-indigo-400" />
                  <span>PumpDev API Key</span>
                  {pumpDevKeyConfigured && (
                    <span className="ml-auto text-[10px] font-semibold text-emerald-400 bg-emerald-950/40 border border-emerald-800/50 px-2 py-0.5 rounded-full">Configured</span>
                  )}
                </h2>
                <form onSubmit={handleSavePumpDevKey} className="space-y-3">
                  <div>
                    <input
                      type="password"
                      placeholder={pumpDevKeyConfigured ? '••••••••••••• (update key)' : 'Paste your PumpDev API key'}
                      value={pumpDevKey}
                      onChange={(e) => setPumpDevKey(e.target.value)}
                      className="w-full bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-500 text-slate-100 placeholder-slate-500 font-mono"
                    />
                    <span className="text-[10px] text-slate-500 block mt-1 leading-normal italic">
                      Used as fallback for bonding curve tokens Jupiter can&apos;t trade. Encrypted with AES-256-GCM.
                    </span>
                  </div>
                  <button
                    type="submit"
                    disabled={pumpDevKeyLoading || !pumpDevKey}
                    className="w-full bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-slate-950 font-bold py-2 rounded-lg transition-all text-xs flex items-center justify-center space-x-1.5 shadow-lg shadow-indigo-500/10 disabled:opacity-40"
                  >
                    {pumpDevKeyLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin text-slate-950" />
                    ) : (
                      <span>{pumpDevKeyConfigured ? 'Update Key' : 'Save Key'}</span>
                    )}
                  </button>
                </form>
              </div>

              {/* Execution Wallets List */}
              <div className="flex flex-col">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center space-x-1.5">
                  <Coins className="h-3.5 w-3.5 text-cyan-455" />
                  <span>Execution Wallets ({executionWallets.length})</span>
                </h2>
                <div className="space-y-2.5 overflow-y-auto max-h-[150px] pr-1">
                  {executionWallets.length === 0 ? (
                    <p className="text-xs text-slate-500 italic p-3 text-center">No wallets imported yet.</p>
                  ) : (
                    executionWallets.map((w) => {
                      const isSelected = selectedExecWallet?.address === w.address;
                      return (
                        <div
                          key={w.address}
                          onClick={() => setSelectedExecWallet(w)}
                          className={`cursor-pointer rounded-xl p-3 transition-all relative flex flex-col justify-between border ${
                            isSelected 
                              ? 'border-cyan-500/80 bg-cyan-950/25 text-slate-100 glow-cyan' 
                              : 'border-slate-800 hover:border-slate-700 bg-slate-900/40 text-slate-300'
                          }`}
                        >
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-bold text-xs tracking-tight">{w.name}</p>
                              <p className="font-mono text-[9px] text-slate-500 mt-0.5">
                                {w.address.slice(0, 6)}...{w.address.slice(-6)}
                              </p>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteExecWallet(w.address);
                              }}
                              className="text-slate-500 hover:text-red-400 transition-colors p-1 rounded-lg hover:bg-slate-950/30"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Set Up Mapping form */}
              <div className="glass-panel rounded-xl p-3.5 bg-slate-900/40 border border-slate-850">
                <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center space-x-1.5">
                  <LinkIcon className="h-3.5 w-3.5 text-cyan-400" />
                  <span>Configure Follow Link</span>
                </h2>
                <form onSubmit={handleAddMapping} className="space-y-2.5">
                  <div>
                    <label className="block text-[10px] text-slate-450 uppercase tracking-wider font-semibold mb-0.5">Tracked Target</label>
                    <select
                      required
                      value={mappingTarget}
                      onChange={(e) => setMappingTarget(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-none"
                    >
                      <option value="">-- Select Target --</option>
                      {wallets.map(w => (
                        <option key={w.address} value={w.address}>{w.name} ({w.address.slice(0,6)})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-450 uppercase tracking-wider font-semibold mb-0.5">Execution Wallet</label>
                    <select
                      required
                      value={mappingExec}
                      onChange={(e) => setMappingExec(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-none"
                    >
                      <option value="">-- Select Exec Wallet --</option>
                      {executionWallets.map(w => (
                        <option key={w.address} value={w.address}>{w.name} ({w.address.slice(0,6)})</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-450 mb-0.5 uppercase tracking-wider font-semibold">Size (SOL)</label>
                      <input
                        type="number"
                        step="0.001"
                        required
                        value={mappingSize}
                        onChange={(e) => setMappingSize(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-100 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-450 mb-0.5 uppercase tracking-wider font-semibold">Slippage</label>
                      <select
                        value={mappingSlippage}
                        onChange={(e) => setMappingSlippage(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-100 focus:outline-none"
                      >
                        <option value="500">5%</option>
                        <option value="1000">10%</option>
                        <option value="1500">15%</option>
                        <option value="2000">20%</option>
                        <option value="2500">25%</option>
                        <option value="3000">30%</option>
                        <option value="4000">40%</option>
                        <option value="5000">50%</option>
                        <option value="6000">60%</option>
                        <option value="7000">70%</option>
                        <option value="8000">80%</option>
                        <option value="9000">90%</option>
                        <option value="9900">99%</option>
                        <option value="10000">100%</option>
                      </select>
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={saveMappingLoading}
                    className="w-full bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-600 hover:to-emerald-600 text-slate-950 font-bold py-1.5 rounded-lg transition-all text-xs flex items-center justify-center space-x-1 shadow-lg"
                  >
                    {saveMappingLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin text-slate-950" />
                    ) : (
                      <span>Save Relation</span>
                    )}
                  </button>
                </form>
              </div>
            </>
          )}
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

          {dashboardMode === 'simulation' ? (
            // SIMULATION (PAPER TRADING) DASHBOARD
            !selectedWallet ? (
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
                      <p className="text-xs text-slate-405 mt-0.5">
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
                                      <span className="text-cyan-400 font-mono">{h.symbol || h.mint.slice(0, 6).toUpperCase()}</span>
                                      {h.name && <span className="text-xs text-slate-400 font-normal">({h.name})</span>}
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
                            <tr className="bg-slate-900/60 border-b border-slate-800 text-xs font-bold text-slate-455 uppercase tracking-wider">
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
                                        <span className="text-cyan-400 font-mono">{t.symbol || t.tokenMint.slice(0, 6).toUpperCase()}</span>
                                        {t.name && <span className="text-xs text-slate-500 font-normal">({t.name})</span>}
                                      </span>
                                      <span className="font-mono text-[10px] text-slate-500">
                                        {t.tokenMint.slice(0, 8)}...{t.tokenMint.slice(-4)}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 text-center text-slate-300 font-semibold">
                                    {t.solInvested.toFixed(4)} SOL
                                  </td>
                                  <td className="px-6 py-4 text-center text-slate-300 font-semibold">
                                    {t.solReceived.toFixed(4)} SOL
                                  </td>
                                  <td className={`px-6 py-4 text-center font-bold ${isWin ? 'text-green-400' : 'text-red-400'}`}>
                                    {isWin ? '+' : ''}{t.netPnL.toFixed(4)} SOL
                                  </td>
                                  <td className={`px-6 py-4 text-center font-bold ${isWin ? 'text-green-400' : 'text-red-400'}`}>
                                    {isWin ? '+' : ''}{t.pnlPercent.toFixed(2)}%
                                  </td>
                                  <td className="px-6 py-4 text-center text-slate-450 font-medium">
                                    100%
                                  </td>
                                  <td className="px-6 py-4 text-center text-xs text-slate-400">
                                    {new Date(t.sellTime).toLocaleString()}
                                  </td>
                                  <td className="px-6 py-4 text-right space-x-2">
                                    {t.buyHash && t.buyHash !== 'N/A' && (
                                      <a
                                        href={`https://solscan.io/tx/${t.buyHash}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs text-slate-500 hover:text-green-400 mr-2"
                                      >
                                        Buy Tx
                                      </a>
                                    )}
                                    {t.sellHash && t.sellHash !== 'N/A' && (
                                      <a
                                        href={`https://solscan.io/tx/${t.sellHash}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center space-x-1 text-xs font-bold text-slate-400 hover:text-green-400 bg-slate-950/40 px-2.5 py-1 rounded-md border border-slate-800"
                                      >
                                        <span>View Sell</span>
                                        <ExternalLink className="h-3 w-3" />
                                      </a>
                                    )}
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
                      
                      {/* Backtest config inputs */}
                      <div className="glass-panel rounded-2xl p-6 border border-slate-800 flex flex-col md:flex-row md:items-end justify-between gap-6">
                        <div className="flex-1 space-y-4">
                          <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center space-x-2">
                            <Play className="h-4 w-4 text-cyan-400" />
                            <span>Run Strategy Backtest Sandbox</span>
                          </h3>
                          <p className="text-xs text-slate-400">
                            Fetches the last N swap signatures of <span className="font-mono text-cyan-300">{selectedWallet.address}</span> directly from Solana, parses details, and runs strategy variants side-by-side.
                          </p>
                        </div>
                        <div className="flex items-center space-x-4 shrink-0">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Limit Transactions</label>
                            <select
                              value={backtestLimit}
                              onChange={(e) => setBacktestLimit(parseInt(e.target.value, 10))}
                              className="bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-sm text-slate-100 focus:outline-none"
                            >
                              <option value="50">Last 50 Tx</option>
                              <option value="100">Last 100 Tx</option>
                              <option value="200">Last 200 Tx</option>
                            </select>
                          </div>
                          <button
                            onClick={handleRunBacktest}
                            disabled={backtestLoading}
                            className="bg-gradient-to-r from-cyan-500 to-indigo-500 hover:from-cyan-600 hover:to-indigo-600 text-slate-950 font-bold px-6 py-2.5 rounded-lg transition-all text-xs flex items-center justify-center space-x-2 shadow-lg shadow-cyan-500/10 h-10 mt-5"
                          >
                            {backtestLoading ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin text-slate-950" />
                                <span>Running...</span>
                              </>
                            ) : (
                              <>
                                <Play className="h-4 w-4 text-slate-950" />
                                <span>Execute Sandbox</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Backtest Error log */}
                      {backtestError && (
                        <div className="bg-red-950/30 border border-red-800/80 text-red-300 p-4 rounded-xl text-sm flex items-start space-x-2">
                          <ShieldAlert className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                          <span>{backtestError}</span>
                        </div>
                      )}

                      {/* Backtest Results Dashboard */}
                      {backtestResults && (
                        <div className="space-y-6">
                          
                          {/* Sizing comparative table */}
                          <div className="glass-panel rounded-2xl overflow-hidden border border-slate-800">
                            <table className="w-full text-left border-collapse">
                              <thead>
                                <tr className="bg-slate-900/60 border-b border-slate-800 text-xs font-bold text-slate-450 uppercase tracking-wider">
                                  <th className="px-6 py-4">StrategySizing Option</th>
                                  <th className="px-6 py-4 text-center">Initial capital</th>
                                  <th className="px-6 py-4 text-center">Final Portfolio Value</th>
                                  <th className="px-6 py-4 text-center">Net Profit/Loss</th>
                                  <th className="px-6 py-4 text-center">Wins / Losses</th>
                                  <th className="px-6 py-4 text-center">Win Rate</th>
                                  <th className="px-6 py-4 text-right">Priority Fees Paid</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-850 text-sm">
                                
                                {/* Fixed 0.05 SOL */}
                                <tr className="hover:bg-slate-900/20">
                                  <td className="px-6 py-4 font-bold text-slate-200">Fixed 0.05 SOL</td>
                                  <td className="px-6 py-4 text-center text-slate-400">1.0000 SOL</td>
                                  <td className="px-6 py-4 text-center text-slate-200 font-semibold">{backtestResults.fixed05.finalValue.toFixed(4)} SOL</td>
                                  <td className={`px-6 py-4 text-center font-bold ${backtestResults.fixed05.netProfitSOL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    {backtestResults.fixed05.netProfitSOL >= 0 ? '+' : ''}{backtestResults.fixed05.netProfitSOL.toFixed(4)} SOL ({backtestResults.fixed05.netProfitPercent.toFixed(1)}%)
                                  </td>
                                  <td className="px-6 py-4 text-center text-slate-400">{backtestResults.fixed05.wins}W - {backtestResults.fixed05.losses}L</td>
                                  <td className="px-6 py-4 text-center text-slate-250 font-semibold">{backtestResults.fixed05.winRate.toFixed(1)}%</td>
                                  <td className="px-6 py-4 text-right text-xs text-slate-500 font-mono">{backtestResults.fixed05.totalFees.toFixed(4)} SOL</td>
                                </tr>

                                {/* Fixed 0.10 SOL */}
                                <tr className="hover:bg-slate-900/20">
                                  <td className="px-6 py-4 font-bold text-slate-200">Fixed 0.10 SOL</td>
                                  <td className="px-6 py-4 text-center text-slate-400">1.0000 SOL</td>
                                  <td className="px-6 py-4 text-center text-slate-200 font-semibold">{backtestResults.fixed10.finalValue.toFixed(4)} SOL</td>
                                  <td className={`px-6 py-4 text-center font-bold ${backtestResults.fixed10.netProfitSOL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    {backtestResults.fixed10.netProfitSOL >= 0 ? '+' : ''}{backtestResults.fixed10.netProfitSOL.toFixed(4)} SOL ({backtestResults.fixed10.netProfitPercent.toFixed(1)}%)
                                  </td>
                                  <td className="px-6 py-4 text-center text-slate-400">{backtestResults.fixed10.wins}W - {backtestResults.fixed10.losses}L</td>
                                  <td className="px-6 py-4 text-center text-slate-250 font-semibold">{backtestResults.fixed10.winRate.toFixed(1)}%</td>
                                  <td className="px-6 py-4 text-right text-xs text-slate-500 font-mono">{backtestResults.fixed10.totalFees.toFixed(4)} SOL</td>
                                </tr>

                                {/* Risk-Scaled Sizing */}
                                <tr className="bg-cyan-950/10 border-cyan-800/20 hover:bg-cyan-950/20">
                                  <td className="px-6 py-4 font-bold text-cyan-400 flex items-center space-x-1.5">
                                    <span>🌟 Risk-Scaled Copy</span>
                                  </td>
                                  <td className="px-6 py-4 text-center text-slate-400 font-medium">1.0000 SOL</td>
                                  <td className="px-6 py-4 text-center text-cyan-300 font-bold">{backtestResults.riskScaled.finalValue.toFixed(4)} SOL</td>
                                  <td className={`px-6 py-4 text-center font-black ${backtestResults.riskScaled.netProfitSOL >= 0 ? 'text-green-400 glow-text-green' : 'text-red-400'}`}>
                                    {backtestResults.riskScaled.netProfitSOL >= 0 ? '+' : ''}{backtestResults.riskScaled.netProfitSOL.toFixed(4)} SOL ({backtestResults.riskScaled.netProfitPercent.toFixed(1)}%)
                                  </td>
                                  <td className="px-6 py-4 text-center text-slate-350 font-semibold">{backtestResults.riskScaled.wins}W - {backtestResults.riskScaled.losses}L</td>
                                  <td className="px-6 py-4 text-center text-cyan-400 font-black">{backtestResults.riskScaled.winRate.toFixed(1)}%</td>
                                  <td className="px-6 py-4 text-right text-xs text-slate-500 font-mono">{backtestResults.riskScaled.totalFees.toFixed(4)} SOL</td>
                                </tr>

                              </tbody>
                            </table>
                          </div>

                          {/* Best/Worst Trades row */}
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
                                  <tr className="bg-slate-955/20 border-b border-slate-850 text-xs text-slate-450">
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
            )
          ) : (
            // LIVE EXECUTION MODE VIEW
            !selectedExecWallet ? (
              <div className="glass-panel rounded-2xl p-12 text-center flex flex-col items-center justify-center min-h-[400px]">
                <Key className="h-12 w-12 text-slate-600 mb-4 animate-bounce" />
                <h3 className="text-lg font-bold text-slate-300">No Execution Wallet Imported</h3>
                <p className="text-sm text-slate-500 mt-2 max-w-md">
                  Please import your Solana private key in the sidebar. This key will be encrypted and used to sign trade executions in real-time.
                </p>
              </div>
            ) : realLoading ? (
              <div className="flex flex-col items-center justify-center min-h-[400px] space-y-3">
                <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
                <span className="text-sm text-slate-400 font-medium">Fetching real portfolio metrics...</span>
              </div>
            ) : (
              <>
                {/* Header Profile Title */}
                <div className="flex flex-row items-center justify-between border-b border-slate-850 pb-4">
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center space-x-2">
                      <span>{selectedExecWallet.name}</span>
                      <span className="text-xs font-semibold bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-md font-mono text-slate-400 hidden sm:inline-block">
                        {selectedExecWallet.address}
                      </span>
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">
                      Live executed copy portfolio tracking on-chain transactions.
                    </p>
                  </div>
                  <button
                    onClick={() => loadRealPortfolio(false)}
                    disabled={realRefreshing}
                    className="bg-slate-900 hover:bg-slate-855 text-slate-300 hover:text-slate-100 border border-slate-800 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 shadow-lg shrink-0"
                  >
                    <RotateCw className={`h-3.5 w-3.5 ${realRefreshing ? 'animate-spin text-cyan-400' : 'text-slate-400'}`} />
                    <span>{realRefreshing ? 'Refreshing...' : 'Refresh'}</span>
                  </button>
                </div>

                {/* KPI Cards Row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  
                  {/* Real PnL Card */}
                  <div className="glass-panel rounded-2xl p-5 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">On-Chain Net PnL</span>
                      {totalRealPnLSOL >= 0 ? (
                        <TrendingUp className="h-5 w-5 text-green-400" />
                      ) : (
                        <TrendingDown className="h-5 w-5 text-red-400" />
                      )}
                    </div>
                    <div className="mt-4">
                      <p className={`text-2xl font-bold tracking-tight ${totalRealPnLSOL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {totalRealPnLSOL >= 0 ? '+' : ''}{totalRealPnLSOL.toFixed(4)} SOL
                      </p>
                      <p className={`text-sm font-semibold mt-0.5 ${totalRealPnLSOL >= 0 ? 'text-green-400/80' : 'text-red-400/80'}`}>
                        {totalRealPnLSOL >= 0 ? '+' : ''}{totalRealPnLPercent.toFixed(2)}%
                      </p>
                    </div>
                  </div>

                  {/* On-Chain SOL Balance */}
                  <div className="glass-panel rounded-2xl p-5 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Live Wallet Balance</span>
                      <Coins className="h-5 w-5 text-cyan-400" />
                    </div>
                    <div className="mt-4">
                      <p className="text-2xl font-bold tracking-tight text-slate-100">
                        {realBalance.toFixed(4)} SOL
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Actual SOL holding on-chain
                      </p>
                    </div>
                  </div>

                  {/* Real Win Rate */}
                  <div className="glass-panel rounded-2xl p-5 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Real Win Rate</span>
                      <Percent className="h-5 w-5 text-indigo-400" />
                    </div>
                    <div className="mt-4">
                      <p className="text-2xl font-bold tracking-tight text-slate-100">
                        {realWinRate.toFixed(1)}%
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {realWins} Wins / {realLosses} Losses ({realTrades.filter(t => t.status === 'COMPLETED').length} Closed)
                      </p>
                    </div>
                  </div>

                  {/* Real Open Positions */}
                  <div className="glass-panel rounded-2xl p-5 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Open Positions</span>
                      <Activity className="h-5 w-5 text-amber-400" />
                    </div>
                    <div className="mt-4">
                      <p className="text-2xl font-bold tracking-tight text-slate-100">
                        {realHoldings.length} Assets
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Allocated: {realHoldings.reduce((acc, h) => acc + h.solSpent, 0).toFixed(4)} SOL
                      </p>
                    </div>
                  </div>

                </div>

                {/* Tabs */}
                <div className="flex border-b border-slate-800">
                  <button
                    onClick={() => setActiveTab('positions')}
                    className={`px-5 py-3 font-semibold text-sm transition-colors border-b-2 ${
                      activeTab === 'positions' 
                        ? 'border-cyan-400 text-cyan-400 bg-cyan-950/5' 
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Real Positions ({realHoldings.length})
                  </button>
                  <button
                    onClick={() => setActiveTab('trades')}
                    className={`px-5 py-3 font-semibold text-sm transition-colors border-b-2 ${
                      activeTab === 'trades' 
                        ? 'border-cyan-400 text-cyan-400 bg-cyan-950/5' 
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Real Trade History ({realTrades.length})
                  </button>
                  <button
                    onClick={() => setActiveTab('sandbox')}
                    className={`px-5 py-3 font-semibold text-sm transition-colors border-b-2 ${
                      activeTab === 'sandbox' 
                        ? 'border-cyan-400 text-cyan-400 bg-cyan-950/5' 
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Active Mappings ({copySettings.filter(s => s.executionWallet === selectedExecWallet.address).length})
                  </button>
                </div>

                <div className="mt-4">
                  {/* Tab 1: Real Positions */}
                  {activeTab === 'positions' && (
                    <div className="glass-panel rounded-2xl overflow-hidden border border-slate-800">
                      {realHoldings.length === 0 ? (
                        <div className="p-12 text-center text-slate-500 text-sm italic">
                          No active on-chain token holdings found for this wallet.
                        </div>
                      ) : (
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-900/60 border-b border-slate-800 text-xs font-bold text-slate-400 uppercase tracking-wider">
                              <th className="px-6 py-4">Token Mint</th>
                              <th className="px-6 py-4 text-center">Amount Held</th>
                              <th className="px-6 py-4 text-center">SOL Cost Basis</th>
                              <th className="px-6 py-4 text-center">Avg Entry Price (SOL)</th>
                              <th className="px-6 py-4 text-center">Buy Date</th>
                              <th className="px-6 py-4 text-right">Links</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-850 text-sm">
                            {realHoldings.map((h) => (
                              <tr key={h.mint} className="hover:bg-slate-900/20">
                                <td className="px-6 py-4">
                                  <div className="flex flex-col">
                                    <span className="font-bold text-slate-100 flex items-center space-x-1.5">
                                      <span className="text-cyan-400 font-mono">{h.symbol || h.mint.slice(0, 6).toUpperCase()}</span>
                                      {h.name && <span className="text-xs text-slate-400 font-normal">({h.name})</span>}
                                    </span>
                                    <span className="font-mono text-[10px] text-slate-500">
                                      {h.mint}
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
                                    className="inline-flex items-center space-x-1 text-xs font-bold text-slate-400 hover:text-cyan-400 transition-colors bg-slate-950/40 px-2.5 py-1 rounded-md border border-slate-800"
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

                  {/* Tab 2: Real completed trades */}
                  {activeTab === 'trades' && (
                    <div className="glass-panel rounded-2xl overflow-hidden border border-slate-800">
                      {realTrades.length === 0 ? (
                        <div className="p-12 text-center text-slate-500 text-sm italic">
                          No real-world completed trades logged yet.
                        </div>
                      ) : (
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-900/60 border-b border-slate-800 text-xs font-bold text-slate-400 uppercase tracking-wider">
                              <th className="px-6 py-4">Token</th>
                              <th className="px-6 py-4 text-center">Target Wallet</th>
                              <th className="px-6 py-4 text-center">SOL Invested</th>
                              <th className="px-6 py-4 text-center">SOL Received</th>
                              <th className="px-6 py-4 text-center">PnL (SOL)</th>
                              <th className="px-6 py-4 text-center">PnL (%)</th>
                              <th className="px-6 py-4 text-center">Status</th>
                              <th className="px-6 py-4 text-right">Links</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-850 text-sm">
                            {realTrades.map((t) => {
                              const isWin = t.netPnL >= 0;
                              return (
                                <tr key={t.id} className="hover:bg-slate-900/20">
                                  <td className="px-6 py-4">
                                    <div className="flex flex-col">
                                      <span className="font-bold text-slate-200 flex items-center space-x-1.5">
                                        <span className="text-cyan-400 font-mono">{t.symbol || t.tokenMint.slice(0, 6).toUpperCase()}</span>
                                        {t.name && <span className="text-xs text-slate-500 font-normal">({t.name})</span>}
                                      </span>
                                      <span className="font-mono text-[10px] text-slate-500">
                                        {t.tokenMint.slice(0, 8)}...{t.tokenMint.slice(-4)}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 text-center text-xs text-slate-400 font-mono">
                                    {t.targetWallet ? `${t.targetWallet.slice(0, 4)}...${t.targetWallet.slice(-4)}` : 'N/A'}
                                  </td>
                                  <td className="px-6 py-4 text-center text-slate-300 font-medium">
                                    {t.solInvested ? `${t.solInvested.toFixed(4)} SOL` : 'N/A'}
                                  </td>
                                  <td className="px-6 py-4 text-center text-slate-300 font-medium">
                                    {t.solReceived ? `${t.solReceived.toFixed(4)} SOL` : 'N/A'}
                                  </td>
                                  <td className={`px-6 py-4 text-center font-bold ${isWin ? 'text-green-400' : 'text-red-400'}`}>
                                    {t.netPnL !== null ? `${isWin ? '+' : ''}${t.netPnL.toFixed(4)}` : 'N/A'}
                                  </td>
                                  <td className={`px-6 py-4 text-center font-bold ${isWin ? 'text-green-400' : 'text-red-400'}`}>
                                    {t.pnlPercent !== null ? `${isWin ? '+' : ''}${t.pnlPercent.toFixed(1)}%` : 'N/A'}
                                  </td>
                                  <td className="px-6 py-4 text-center">
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase ${
                                      t.status === 'COMPLETED' 
                                        ? 'bg-green-950/20 border-green-800/80 text-green-400' 
                                        : t.status === 'FAILED'
                                          ? 'bg-red-950/20 border-red-800/80 text-red-400'
                                          : 'bg-yellow-950/20 border-yellow-800/80 text-yellow-400'
                                    }`}>
                                      {t.status}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4 text-right space-x-2">
                                    {t.buyHash && (
                                      <a
                                        href={`https://solscan.io/tx/${t.buyHash}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center text-[11px] font-bold text-slate-400 hover:text-cyan-400"
                                      >
                                        Buy Tx
                                      </a>
                                    )}
                                    {t.sellHash && (
                                      <a
                                        href={`https://solscan.io/tx/${t.sellHash}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center text-[11px] font-bold text-slate-400 hover:text-cyan-400 ml-2"
                                      >
                                        Sell Tx
                                      </a>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}

                  {/* Tab 3: Active Mappings configurations */}
                  {activeTab === 'sandbox' && (
                    <div className="glass-panel rounded-2xl overflow-hidden border border-slate-800 p-6">
                      <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-4">
                        Copy Relations for {selectedExecWallet.name}
                      </h3>
                      {copySettings.filter(s => s.executionWallet === selectedExecWallet.address).length === 0 ? (
                        <div className="text-center text-slate-500 text-sm italic py-6">
                          No active copy targets linked to this execution wallet. Add one in the sidebar follow settings!
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {copySettings
                            .filter(s => s.executionWallet === selectedExecWallet.address)
                            .map((mapping) => {
                              const target = wallets.find(w => w.address === mapping.targetWallet);
                              return (
                                <div key={mapping.id} className="bg-slate-950/60 border border-slate-850 rounded-xl p-4 flex justify-between items-center">
                                  <div>
                                    <h4 className="font-bold text-sm text-slate-200">
                                      {target ? target.name : 'Unknown Target'}
                                    </h4>
                                    <p className="text-xs text-slate-500 font-mono mt-0.5">
                                      {mapping.targetWallet}
                                    </p>
                                    <div className="mt-3 flex space-x-4 text-xs text-slate-400">
                                      <span>Size: <strong className="text-cyan-400">{mapping.copySize} SOL</strong></span>
                                      <span>Slippage: <strong className="text-cyan-400">{mapping.slippageBps / 100}%</strong></span>
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => handleDeleteMapping(mapping.targetWallet, mapping.executionWallet)}
                                    className="text-slate-500 hover:text-red-400 hover:bg-slate-900 p-2 rounded-xl transition-all border border-transparent hover:border-red-900/30"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  )}

                </div>
              </>
            )
          )}

        </main>

      </div>
    </div>
  );
}
