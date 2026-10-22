let connectedWallet = null;
        let availableWallets = [];
        let userAccounts = [];
        let selectedAccountId = null;
        let activeAccount = null;
        let tvWidget = null;
        let activePromoCode = null;
        let plansData = [];
        let planLoadAttempts = 0;
        let livePriceInterval = null;
        let autoSyncInterval = null;
        let currentLivePrice = 0;
        let userHasEditedPrice = false;
        let availableCommissionBalance = 0;
        let currentLeaderboardMode = 'DAILY';
        let rawLeaderboardData = [];
        let currentUserProfile = null;
        let showActiveAccountsOnly = true;
        let walletSessionToken = null;
        let walletSessionOwner = null;
        let walletSessionExpiresAt = 0;
        let walletSessionPromise = null;
        let walletSessionGeneration = 0;
                let marketsData = [];
                const closingTradeIds = new Set();
        
        const TREASURY_WALLET = "0x8632fa855d5dc6b59a3cf892d72cf4a94f182aae";

        function escapeHTML(value) {
            return String(value ?? '').replace(/[&<>"']/g, character => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            })[character]);
        }

        function setTradeFeedback(message) {
            const feedback = document.getElementById('trade-feedback');
            if (feedback) feedback.textContent = message || '';
        }

        async function readAdminApiResponse(response, endpoint) {
            const body = await response.text();
            try {
                return JSON.parse(body);
            } catch {
                const detail = body.trimStart().startsWith('<')
                    ? 'The server returned an HTML page instead of API JSON. Restart/deploy the latest server code so the admin API routes are available.'
                    : 'The server returned an invalid API response.';
                throw new Error(`${endpoint} failed (HTTP ${response.status}). ${detail}`);
            }
        }

        const SUPPORTED_EVM_CHAINS = {
            1: { name: "Ethereum Mainnet", chainIdHex: "0x1", usdtAddress: "0xdac17f958d2ee523a2206206994597c13d831ec7" },
            8453: { name: "Base", chainIdHex: "0x2105", usdtAddress: "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2" },
            137: { name: "Polygon PoS", chainIdHex: "0x89", usdtAddress: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f" },
            43114: { name: "Avalanche C-Chain", chainIdHex: "0xa86a", usdtAddress: "0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7" },
            448000: {
                name: "NullNet Private EVM",
                chainIdHex: "0x6d600",
                rpcUrl: "https://rpc.lunul.org",
                nativeCurrency: { name: "LUN", symbol: "LUN", decimals: 18 },
                usdtAddress: "0x7ec3659A8225ED474D7c662126616aE08545C29b"
            }
        };

        async function ensurePaymentNetwork(provider, chainConfig) {
            const targetChainId = BigInt(chainConfig.chainIdHex);
            const currentChainId = BigInt(await provider.request({ method: 'eth_chainId' }));

            if (currentChainId !== targetChainId) {
                try {
                    await provider.request({
                        method: 'wallet_switchEthereumChain',
                        params: [{ chainId: chainConfig.chainIdHex }]
                    });
                } catch (switchError) {
                    if (switchError.code !== 4902 || !chainConfig.rpcUrl || !chainConfig.nativeCurrency) {
                        throw switchError;
                    }
                    await provider.request({
                        method: 'wallet_addEthereumChain',
                        params: [{
                            chainId: chainConfig.chainIdHex,
                            chainName: chainConfig.name,
                            rpcUrls: [chainConfig.rpcUrl],
                            nativeCurrency: chainConfig.nativeCurrency
                        }]
                    });
                    await provider.request({
                        method: 'wallet_switchEthereumChain',
                        params: [{ chainId: chainConfig.chainIdHex }]
                    });
                }
            }

            const activeChainId = BigInt(await provider.request({ method: 'eth_chainId' }));
            if (activeChainId !== targetChainId) {
                throw new Error(`Wallet is connected to chain ${activeChainId.toString()}, not ${targetChainId.toString()}.`);
            }
        }

        window.addEventListener('DOMContentLoaded', async () => {
            try {
                await loadMarketConfig();
            } catch (error) {
                console.error('Market configuration failed:', error);
                const select = document.getElementById('order-symbol');
                if (select) {
                    select.replaceChildren(new Option('Market configuration unavailable', ''));
                    select.disabled = true;
                }
            }
            loadPlans();
            loadLeaderboard(currentLeaderboardMode);

            autoSyncInterval = setInterval(() => {
                if (connectedWallet) silentSyncUserData(connectedWallet);
            }, 5000);

            const urlParams = new URLSearchParams(window.location.search);
            const refCode = urlParams.get('ref');
            if (refCode) {
                const promoInput = document.getElementById('applied-promo');
                if (promoInput) {
                    promoInput.value = refCode;
                    applyPromo();
                }
            }

            const provider = getProvider();
            if (provider?.on) {
                provider.on('accountsChanged', (accounts) => {
                    if (accounts && accounts.length > 0) {
                        availableWallets = accounts;
                        updateWalletDropdown();
                        onWalletSwitched(accounts[0]);
                    } else {
                        disconnectWallet();
                    }
                });
            }
        });

        async function loadMarketConfig() {
            const response = await fetch('/config/markets.json');
            if (!response.ok) throw new Error(`Market configuration request failed (${response.status}).`);
            marketsData = await response.json();
            if (!Array.isArray(marketsData) || marketsData.length === 0) {
                throw new Error('Market configuration is empty or invalid.');
            }

            const select = document.getElementById('order-symbol');
            select.replaceChildren();
            const groups = new Map();
            for (const market of marketsData) {
                if (market.enabled === false || !market.label || !market.symbol || !market.pair || !market.type) continue;
                const groupName = market.group || 'Markets';
                if (!groups.has(groupName)) {
                    const group = document.createElement('optgroup');
                    group.label = groupName;
                    groups.set(groupName, group);
                    select.append(group);
                }
                const option = document.createElement('option');
                option.value = market.symbol;
                option.textContent = market.label;
                option.dataset.pair = market.pair;
                option.dataset.type = market.type;
                option.dataset.source = market.source;
                groups.get(groupName).append(option);
            }

            select.disabled = false;
            const defaultMarket = marketsData.find(market => market.symbol === 'TVC:GOLD') || marketsData[0];
            select.value = defaultMarket.symbol;
            onSymbolChanged(defaultMarket.symbol);
        }

        function toggleMobileMenu(forceClose = false) {
            const nav = document.getElementById('nav-menu');
            const hamburger = document.getElementById('hamburger-icon');
            if (!nav) return;
            if (forceClose === true) {
                nav.classList.remove('mobile-open');
                if (hamburger) {
                    hamburger.classList.remove('menu-open');
                    hamburger.setAttribute('aria-label', 'Open navigation menu');
                    hamburger.setAttribute('aria-expanded', 'false');
                }
                return;
            }
            nav.classList.toggle('mobile-open');
            if (hamburger) {
                const isOpen = nav.classList.contains('mobile-open');
                hamburger.classList.toggle('menu-open', isOpen);
                hamburger.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
                hamburger.setAttribute('aria-expanded', String(isOpen));
            }
        }

        function initTradingViewWidget(symbol) {
            const container = document.getElementById('tradingview-widget-container');
            if (!container) return;
            container.innerHTML = '';
            tvWidget = new TradingView.widget({
                "autosize": true,
                "symbol": symbol,
                "interval": "D",
                "timezone": "Etc/UTC",
                "theme": "dark",
                "style": "1",
                "locale": "en",
                "toolbar_bg": "#090d13",
                "container_id": "tradingview-widget-container"
            });
        }

        function updateTradingViewSymbol(symbol) {
            if (tvWidget && tvWidget.chart) {
                try { tvWidget.chart().setSymbol(symbol); } catch(e) { initTradingViewWidget(symbol); }
            } else {
                initTradingViewWidget(symbol);
            }
        }

        function onSymbolChanged(tvSymbol) {
            userHasEditedPrice = false;
            updateTradingViewSymbol(tvSymbol);
            const select = document.getElementById('order-symbol');
            if (!select) return;
            const opt = select.querySelector(`option[value="${tvSymbol}"]`);
            if (opt) startPricePolling(opt.dataset.pair, opt.dataset.type, opt.dataset.source);
        }

        function startPricePolling(pair, type, source) {
            if (livePriceInterval) clearInterval(livePriceInterval);
            fetchPrice(pair, type, source);
            livePriceInterval = setInterval(() => fetchPrice(pair, type, source), 2000);
        }

        async function fetchPrice(pair, type, source) {
            try {
                if (source === 'BINANCE_PERP' || source === 'BINANCE_SPOT') {
                    const endpoint = source === 'BINANCE_PERP'
                        ? `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${pair}`
                        : `https://api.binance.com/api/v3/ticker/price?symbol=${pair}`;
                    const res = await fetch(endpoint);
                    const data = await res.json();
                    if (data && data.price) currentLivePrice = parseFloat(data.price);
                } else if (source === 'SIMULATED') {
                    const market = marketsData.find(item => item.pair === pair && item.type === type);
                    if (!market) return;
                    const wave = Math.sin(Date.now() / 2000) * market.amplitude;
                    currentLivePrice = Number((market.base + wave).toFixed(2));
                }

                const priceInput = document.getElementById('order-price');
                if (priceInput && currentLivePrice > 0 && !userHasEditedPrice) {
                    priceInput.value = currentLivePrice;
                    calculateMetrics();
                }
                monitorClientStops();
            } catch (err) { 
                console.warn("Price feed warning for", pair, err); 
            }
        }

        function onPriceInputChanged() {
            userHasEditedPrice = true;
            calculateMetrics();
        }

        function updateLeverageDisplay(val) {
            const lbl = document.getElementById('leverage-label');
            if (lbl) lbl.innerText = val == "1" ? "1x Spot Mode" : `${val}x Leverage Mode`;
            calculateMetrics();
        }

        function calculateMetrics() {
            const marginInput = parseFloat(document.getElementById('order-size-usd')?.value) || 0;
            const leverage = parseInt(document.getElementById('order-leverage')?.value) || 1;
            const notional = marginInput * leverage;
            const priceInputVal = parseFloat(document.getElementById('order-price')?.value) || currentLivePrice || 0;

            const notionalLabel = document.getElementById('notional-exposure-label');
            if (notionalLabel) notionalLabel.innerText = `$${notional.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            const marginLabel = document.getElementById('position-margin-label');
            if (marginLabel) marginLabel.innerText = `Margin: $${marginInput.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

            const liqLabel = document.getElementById('liquidation-price-label');
            if (liqLabel) {
                if (priceInputVal > 0 && marginInput > 0 && leverage > 1) {
                    const estLiqPriceLong = priceInputVal * (1 - (1 / leverage) * 0.9);
                    liqLabel.innerText = `$${estLiqPriceLong.toFixed(2)}`;
                } else {
                    liqLabel.innerText = 'Not applicable (1x spot)';
                }
            }
        }

        function switchView(viewId) {
            document.querySelectorAll('.view-panel').forEach(panel => panel.classList.remove('active'));
            document.querySelectorAll('.nav-tab').forEach(tab => tab.classList.remove('active'));
            
            const targetPanel = document.getElementById(viewId);
            if (targetPanel) targetPanel.classList.add('active');

            const activeTab = Array.from(document.querySelectorAll('.nav-tab')).find(t => t.getAttribute('onclick')?.includes(viewId));
            if (activeTab) activeTab.classList.add('active');

            toggleMobileMenu(true);

            if (viewId === 'adminView') {
                loadAdminWithdrawals();
                loadAdminAccounts();
            }
            else if (viewId === 'leaderboardView') loadLeaderboard(currentLeaderboardMode);
            else if (viewId === 'accountsView' && connectedWallet) loadUserAccounts(connectedWallet);
        }

        function switchLeaderboardMode(mode) {
            currentLeaderboardMode = mode;
            ['lb-btn-daily', 'lb-btn-monthly', 'lb-btn-payouts'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.remove('active');
            });

            const subtitle = document.getElementById('lb-mode-subtitle');
            const colHeader = document.getElementById('lb-metric-col-header');

            if (mode === 'DAILY') {
                document.getElementById('lb-btn-daily')?.classList.add('active');
                if (colHeader) colHeader.innerText = 'Daily Realized Profit (PnL)';
                if (subtitle) subtitle.innerText = 'Realized trading PnL from trades closed today.';
            } else if (mode === 'MONTHLY') {
                document.getElementById('lb-btn-monthly')?.classList.add('active');
                if (colHeader) colHeader.innerText = 'Monthly Realized Profit (PnL)';
                if (subtitle) subtitle.innerText = 'Realized trading PnL from trades closed during the current calendar month.';
            } else if (mode === 'PAYOUTS') {
                document.getElementById('lb-btn-payouts')?.classList.add('active');
                if (colHeader) colHeader.innerText = 'Total Lifetime Payouts';
                if (subtitle) subtitle.innerText = 'Cumulative total USDT withdrawals approved and paid out by admins.';
            }

            loadLeaderboard(mode);
        }

        async function loadLeaderboard(mode = 'DAILY') {
            try {
                const res = await fetch(`/api/leaderboard?mode=${mode}`);
                const data = await res.json();
                rawLeaderboardData = data.leaderboard || [];
                renderLeaderboardTable(rawLeaderboardData);
            } catch (err) { alert(err.message || 'Unable to execute trade.'); }
        }

        function renderLeaderboardTable(dataRows) {
            const tbody = document.getElementById('leaderboard-table-body');
            if (!tbody) return;
            tbody.innerHTML = '';
            const myRankLabel = document.getElementById('lb-my-rank-label');
            if (myRankLabel) myRankLabel.style.display = 'none';

            if (!dataRows || dataRows.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #6b7280; padding: 24px;">No records available for this leaderboard mode.</td></tr>';
                return;
            }

            let userFoundRank = null;

            dataRows.forEach((row, index) => {
                const isUser = currentUserProfile && row.wallet_address && row.wallet_address.toLowerCase() === currentUserProfile.wallet_address.toLowerCase();
                if (isUser) userFoundRank = index + 1;

                const metricColor = row.metric_value >= 0 ? '#34d399' : '#ef4444';
                const rankDisplay = `#${index + 1}`;
                const badgeText = currentLeaderboardMode === 'PAYOUTS' ? 'PAID' : 'PnL';

                tbody.innerHTML += `
                    <tr>
                        <td><strong style="color: ${index < 3 ? '#c084fc' : '#f3f4f6'}">${rankDisplay}</strong></td>
                        <td><span style="color: #c084fc; font-weight: bold;">@${row.username}</span> ${isUser ? '<small style="color:#34d399; margin-left:6px;">(You)</small>' : ''}</td>
                        <td><code style="background: rgba(5,7,11,0.9); padding: 4px 8px; border-radius: 4px; color: #34d399;">${row.discount_code}</code></td>
                        <td>
                            <span style="color: ${metricColor}; font-weight: bold;">$${row.metric_value.toFixed(2)} USDT</span>
                            <small style="font-size:10px; background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; margin-left: 6px; color: #9ca3af;">${badgeText}</small>
                        </td>
                        <td>
                            <div style="display: flex; gap: 8px;">
                                <button class="btn-wallet" style="padding: 5px 10px; font-size: 11px;" onclick="usePromoCode('${row.discount_code}')">Use Code</button>
                                ${isUser ? `<button class="btn-share-x" onclick="shareRankOnX(${index + 1}, '${row.username}', ${row.metric_value})">𝕏 Share Rank</button>` : ''}
                            </div>
                        </td>
                    </tr>
                `;
            });

            if (userFoundRank && myRankLabel) {
                myRankLabel.innerText = `Your Rank: #${userFoundRank}`;
                myRankLabel.style.display = 'inline-block';
            }
        }

        function filterLeaderboardTable() {
            const query = document.getElementById('lb-search-input')?.value.toLowerCase().trim() || '';
            if (!query) {
                renderLeaderboardTable(rawLeaderboardData);
                return;
            }
            const filtered = rawLeaderboardData.filter(row => 
                row.username.toLowerCase().includes(query) || row.discount_code.toLowerCase().includes(query)
            );
            renderLeaderboardTable(filtered);
        }

        function shareRankOnX(rank, username, metricValue) {
            const modeText = currentLeaderboardMode === 'DAILY' ? 'Daily Profit' : (currentLeaderboardMode === 'MONTHLY' ? 'Monthly Profit' : 'Lifetime Payouts');
            const text = `I'm ranked #${rank} on @BlastrrProp for ${modeText} with $${metricValue.toFixed(2)} USDT! 🚀\n\nTrade live crypto prop accounts with 90% OFF using my code: ${currentUserProfile?.discount_code || 'BLASTRR'}\n\nhttps://blastrr.com/?ref=${currentUserProfile?.discount_code || ''}`;
            window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank');
        }

        function shareTradeOnX(tradeId, symbol, side, pnl, entryPrice) {
            const emoji = pnl >= 0 ? '🟢' : '🔴';
            const text = `${emoji} Just closed a ${side} trade on ${symbol} via @BlastrrProp!\nEntry: $${entryPrice.toFixed(2)} | Realized PnL: $${pnl.toFixed(2)} USDT 📈\n\nTrade direct-to-live crypto prop accounts on Blastrr: https://blastrr.com`;
            window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank');
        }

        function shareCreatorCodeOnX() {
            if (!currentUserProfile) return;
            const text = `Get 90% OFF your @BlastrrProp evaluation trading accounts using my promo code: ${currentUserProfile.discount_code} 🔥\n\nDirect-to-live crypto prop trading terminal with instant executions:\nhttps://blastrr.com/?ref=${currentUserProfile.discount_code}`;
            window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank');
        }

        function usePromoCode(code) {
            const promoInput = document.getElementById('applied-promo');
            if (promoInput) promoInput.value = code;
            switchView('buyView');
            applyPromo();
        }

        function getProvider() {
            return window.ethereum?.providers ? window.ethereum.providers.find(p => p.isMetaMask) || window.ethereum.providers[0] : window.ethereum;
        }

        async function connectWallet() {
            const provider = getProvider();
            if (!provider) { alert("No Web3 wallet found!"); return; }
            try {
                const accounts = await provider.request({ method: 'eth_requestAccounts' });
                if (!accounts || accounts.length === 0) return;
                availableWallets = accounts;
                connectedWallet = accounts[0];
                updateWalletUIState(true);
                updateWalletDropdown();
                onWalletSwitched(connectedWallet);
            } catch (err) { console.error("Wallet Connection Error:", err); }
        }

        async function connectNewWallet() {
            const provider = getProvider();
            if (!provider) { alert("No Web3 wallet found!"); return; }
            try {
                const permissions = await provider.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
                const accountsPermission = permissions.find(p => p.parentCapability === 'eth_accounts');
                if (accountsPermission) {
                    const accounts = await provider.request({ method: 'eth_accounts' });
                    if (accounts && accounts.length > 0) {
                        availableWallets = accounts;
                        connectedWallet = accounts[0];
                        updateWalletUIState(true);
                        updateWalletDropdown();
                        onWalletSwitched(connectedWallet);
                    }
                }
            } catch (err) { console.error(err); }
        }

        function updateWalletDropdown() {
            const walletSelect = document.getElementById('wallet-select');
            if (!walletSelect) return;
            walletSelect.innerHTML = '';
            availableWallets.forEach(acc => {
                const shortAddr = acc.substring(0, 6) + '...' + acc.slice(-4);
                walletSelect.innerHTML += `<option value="${acc}" ${acc.toLowerCase() === connectedWallet?.toLowerCase() ? 'selected' : ''}>${shortAddr}</option>`;
            });
        }

        function updateWalletUIState(isConnected) {
            const connectBtn = document.getElementById('connect-btn');
            const walletSelect = document.getElementById('wallet-select');
            const newBtn = document.getElementById('connect-new-btn');
            const discBtn = document.getElementById('disconnect-btn');
            const statusPill = document.getElementById('wallet-status');

            if (connectBtn) connectBtn.style.display = isConnected ? 'none' : 'inline-block';
            if (walletSelect) walletSelect.style.display = isConnected ? 'inline-block' : 'none';
            if (newBtn) newBtn.style.display = isConnected ? 'inline-block' : 'none';
            if (discBtn) discBtn.style.display = isConnected ? 'inline-block' : 'none';
            
            if (statusPill) {
                statusPill.innerText = isConnected ? "Connected" : "Disconnected";
                statusPill.classList.toggle("connected", isConnected);
            }
        }

        function onWalletSwitched(walletAddress) {
            if (!walletAddress) return;
            if (connectedWallet?.toLowerCase() !== walletAddress.toLowerCase()) {
                walletSessionGeneration++;
                walletSessionToken = null;
                walletSessionOwner = null;
                walletSessionExpiresAt = 0;
                walletSessionPromise = null;
            }
            connectedWallet = walletAddress;
            checkRole(connectedWallet);
            loadUserAccounts(connectedWallet);
            loadUserProfile(connectedWallet);
        }

        function isRiskLockedAccount(account) {
            return account?.lock_reason === 'DLL' ||
                account?.lock_reason === 'MLL' ||
                Number(account?.permanent_lock) === 1;
        }

        function isSelectableTradingAccount(account) {
            return account?.status === 'ACTIVE' &&
                !isRiskLockedAccount(account) &&
                Number(account.admin_frozen) !== 1 &&
                Number(account.withdrawal_pending) !== 1 &&
                Number(account.pending_withdrawal_amount || 0) <= 0;
        }

        async function silentSyncUserData(wallet) {
            try {
                const res = await walletFetch(`/api/accounts?wallet=${encodeURIComponent(wallet)}`);
                const data = await res.json();
                userAccounts = data.accounts || [];

                const selectElem = document.getElementById('active-account-select');
                if (!selectElem) return;
                const currentSelected = selectElem.value;
                const selectableAccounts = userAccounts.filter(isSelectableTradingAccount);
                const nextSelected = selectableAccounts.find(account => account.id === currentSelected)?.id ||
                    selectableAccounts.find(account => account.id === selectedAccountId)?.id ||
                    selectableAccounts[0]?.id ||
                    null;
                selectedAccountId = nextSelected;
                activeAccount = selectableAccounts.find(account => account.id === nextSelected) || null;

                if (selectableAccounts.length === 0) {
                    selectElem.innerHTML = '<option value="">No Unlocked Accounts Available</option>';
                    const openList = document.getElementById('open-trades-list');
                    if (openList) openList.innerHTML = '<tr><td colspan="9" style="text-align: center; color: #6b7280; padding: 24px;">No unlocked accounts available.</td></tr>';
                    updateAvailableBalanceLabel();
                } else {
                    let selectHtml = '';
                    selectableAccounts.forEach((acc) => {
                        selectHtml += `<option value="${acc.id}" ${acc.id === selectedAccountId ? 'selected' : ''}>${acc.plan_name} (${acc.id}) - Bal: $${acc.current_balance.toLocaleString()}</option>`;
                    });
                    if (selectElem.innerHTML !== selectHtml) selectElem.innerHTML = selectHtml;

                    selectElem.value = selectedAccountId;
                }

                if (selectedAccountId) {
                    updateAvailableBalanceLabel();
                    loadOpenTrades(selectedAccountId);
                }

                if (document.getElementById('accountsView')?.classList.contains('active')) renderAccountsPortfolioFlickerFree();
            } catch (err) { console.error("Auto-sync error:", err); }
        }

        function manualRefreshData() {
            if (!connectedWallet) { alert("Connect wallet first!"); return; }
            silentSyncUserData(connectedWallet);
            loadLeaderboard(currentLeaderboardMode);
            alert("Data refreshed successfully!");
        }

        function disconnectWallet() {
            connectedWallet = null;
            walletSessionGeneration++;
            walletSessionToken = null;
            walletSessionOwner = null;
            walletSessionExpiresAt = 0;
            walletSessionPromise = null;
            availableWallets = [];
            userAccounts = [];
            selectedAccountId = null;
            activeAccount = null;
            currentUserProfile = null;

            updateWalletUIState(false);
            const adminNav = document.getElementById('admin-nav-item');
            if (adminNav) adminNav.style.display = 'none';
            if (document.getElementById('adminView')?.classList.contains('active')) switchView('tradeView');

            const actSelect = document.getElementById('active-account-select');
            if (actSelect) actSelect.innerHTML = '<option value="">No Accounts Available</option>';
            
            const accPort = document.getElementById('accounts-portfolio-container');
            if (accPort) accPort.innerHTML = '<p style="text-align: center; color: #6b7280; padding: 30px;">Connect wallet to view your accounts.</p>';
            
            const openList = document.getElementById('open-trades-list');
            if (openList) openList.innerHTML = '<tr><td colspan="9" style="text-align: center; color: #6b7280; padding: 24px;">Select an account to view open positions.</td></tr>';
            
            const setupBox = document.getElementById('profile-setup-box');
            const dispBox = document.getElementById('profile-display-box');
            const editBtn = document.getElementById('btn-toggle-edit');
            if (setupBox) setupBox.style.display = 'block';
            if (dispBox) dispBox.style.display = 'none';
            if (editBtn) editBtn.style.display = 'none';

            loadLeaderboard(currentLeaderboardMode);
        }

        async function checkRole(wallet) {
            try {
                const res = await fetch(`/api/auth/role?wallet=${wallet}`);
                const data = await res.json();
                const adminNav = document.getElementById('admin-nav-item');
                if (adminNav) adminNav.style.display = data.isAdmin ? 'inline-block' : 'none';
            } catch (err) { console.error(err); }
        }

        async function loadUserAccounts(wallet) {
            await silentSyncUserData(wallet);
            renderAccountsPortfolioFlickerFree();
        }

        function toggleActiveAccountsOnly(checked) {
            showActiveAccountsOnly = checked;
            renderAccountsPortfolioFlickerFree();
        }

        async function renderAccountsPortfolioFlickerFree() {
            const container = document.getElementById('accounts-portfolio-container');
            if (!container) return;
            if (userAccounts.length === 0) {
                container.innerHTML = '<p style="text-align: center; color: #6b7280; padding: 30px;">No accounts found. Purchase a plan in the marketplace!</p>';
                return;
            }

            const accountIds = new Set(userAccounts.map(account => `acc-card-${account.id}`));
            container.querySelectorAll('[id^="acc-card-"]').forEach(card => {
                if (!accountIds.has(card.id)) card.remove();
            });
            if (!container.querySelector('[id^="acc-card-"]')) container.replaceChildren();

            for (const acc of userAccounts) {
                const detailsRes = await walletFetch(`/api/accounts/details?account_id=${encodeURIComponent(acc.id)}&wallet=${encodeURIComponent(connectedWallet)}`);
                const details = await detailsRes.json();
                if (!detailsRes.ok || !details.account) throw new Error(details.error || 'Unable to load account details.');
                Object.assign(acc, details.account);
                const m = details.metrics;
                const trades = details.trades;
                const isActive = acc.status === 'ACTIVE' &&
                    !acc.lock_reason &&
                    Number(acc.permanent_lock) !== 1 &&
                    Number(acc.admin_frozen) !== 1 &&
                    !m.withdrawalPending;
                if (showActiveAccountsOnly && !isActive) {
                    document.getElementById(`acc-card-${acc.id}`)?.remove();
                    continue;
                }

                let cardElem = document.getElementById(`acc-card-${acc.id}`);
                if (!cardElem) {
                    const cardHtml = `
                        <article id="acc-card-${acc.id}" class="card account-card">
                            <div class="account-card-header">
                                <div>
                                    <span class="account-plan-name">${acc.plan_name}</span>
                                    <code class="account-id">${acc.id}</code>
                                </div>
                                <div class="account-card-actions">
                                    <button id="withdraw-btn-${acc.id}" class="btn-wallet" onclick="requestWithdrawal('${acc.id}')">Request Withdrawal</button>
                                    <button class="btn-wallet" onclick="selectAccountAndTrade('${acc.id}')">Select in Terminal</button>
                                </div>
                            </div>
                            <div class="account-preview-grid">
                                <div class="account-preview-stat"><span>Initial capital</span><strong>$${acc.initial_balance.toLocaleString()}</strong></div>
                                <div class="account-preview-stat"><span>Current balance</span><strong id="bal-val-${acc.id}">$${acc.current_balance.toLocaleString()}</strong></div>
                                <div class="account-preview-stat"><span>Total profit</span><strong id="profit-val-${acc.id}">$${m.currentProfit.toLocaleString()}</strong></div>
                                <div class="account-preview-stat"><span>Account status</span><strong id="status-val-${acc.id}">${acc.status}</strong></div>
                            </div>
                            <div class="account-risk-preview">
                                <div class="account-risk-item">
                                    <div><span>Profit target</span><strong id="p-prog-val-${acc.id}">${m.profitProgress}%</strong></div>
                                    <div class="account-progress"><i id="p-prog-bar-${acc.id}"></i></div>
                                </div>
                                <div class="account-risk-item">
                                    <div><span>Daily loss (DLL)</span><strong id="dll-prog-val-${acc.id}">${m.dllProgress}%</strong></div>
                                    <div class="account-progress"><i id="dll-prog-bar-${acc.id}"></i></div>
                                    <small id="dll-base-${acc.id}"></small>
                                </div>
                                <div class="account-risk-item">
                                    <div><span>Trailing MLL</span><strong id="dd-prog-val-${acc.id}">${m.ddProgress}%</strong></div>
                                    <div class="account-progress"><i id="dd-prog-bar-${acc.id}"></i></div>
                                    <small id="mll-floor-${acc.id}"></small>
                                </div>
                            </div>
                            <div class="account-card-footer">
                                <span>Consistency score: <strong id="cs-val-${acc.id}">${m.consistencyScore}%</strong></span>
                                <details class="account-expanded">
                                    <summary>Expand account performance and trades</summary>
                                    <section class="account-profit-section">
                                        <h3>Daily profit</h3>
                                        <div id="profit-chart-${acc.id}" class="account-profit-chart"></div>
                                    </section>
                                    <h3 class="account-trades-heading">Trade history</h3>
                                    <div class="table-responsive">
                                        <table>
                                            <thead><tr><th>Trade ID</th><th>Symbol</th><th>Side</th><th>Entry Price</th><th>Size ($)</th><th>SL / TP</th><th>Realized PnL</th><th>Status</th><th>Share</th></tr></thead>
                                            <tbody id="trades-body-${acc.id}"></tbody>
                                        </table>
                                    </div>
                                </details>
                            </div>
                        </div>
                    `;
                    container.insertAdjacentHTML('beforeend', cardHtml);
                    cardElem = document.getElementById(`acc-card-${acc.id}`);
                }

                cardElem.querySelector(`#bal-val-${CSS.escape(acc.id)}`).innerText = `$${acc.current_balance.toLocaleString()}`;
                cardElem.querySelector(`#profit-val-${CSS.escape(acc.id)}`).innerText = `$${m.currentProfit.toLocaleString()}`;
                cardElem.querySelector(`#p-prog-val-${CSS.escape(acc.id)}`).innerText = `${m.profitProgress}%`;
                cardElem.querySelector(`#p-prog-bar-${CSS.escape(acc.id)}`).style.width = `${m.profitProgress}%`;
                cardElem.querySelector(`#dll-prog-val-${CSS.escape(acc.id)}`).innerText = `${m.dllProgress}%`;
                cardElem.querySelector(`#dll-prog-bar-${CSS.escape(acc.id)}`).style.width = `${m.dllProgress}%`;
                cardElem.querySelector(`#dd-prog-val-${CSS.escape(acc.id)}`).innerText = `${m.ddProgress}%`;
                cardElem.querySelector(`#dd-prog-bar-${CSS.escape(acc.id)}`).style.width = `${m.ddProgress}%`;
                cardElem.querySelector(`#dll-base-${CSS.escape(acc.id)}`).innerText = `Risk baseline: $${acc.daily_starting_balance.toLocaleString()}`;
                cardElem.querySelector(`#mll-floor-${CSS.escape(acc.id)}`).innerText = `Breach floor: $${m.mllFloor.toLocaleString()}`;
                cardElem.querySelector(`#cs-val-${CSS.escape(acc.id)}`).innerText = `${m.consistencyScore}%`;
                const statusLabel = acc.lock_reason === 'MLL' || Number(acc.permanent_lock) === 1
                    ? 'PERMANENTLY LOCKED — MLL'
                    : acc.lock_reason === 'DLL'
                        ? `LOCKED — DLL until ${new Date(acc.locked_until).toLocaleString()}`
                        : acc.admin_frozen
                            ? 'FROZEN — ADMIN'
                            : m.withdrawalPending
                                ? 'PAUSED — WITHDRAWAL REVIEW'
                                : acc.status;
                const statusElement = cardElem.querySelector(`#status-val-${CSS.escape(acc.id)}`);
                statusElement.innerText = statusLabel;
                statusElement.style.color = acc.lock_reason || acc.admin_frozen || m.withdrawalPending ? '#ef4444' : '#34d399';
                const withdrawButton = cardElem.querySelector(`#withdraw-btn-${CSS.escape(acc.id)}`);
                if (withdrawButton) {
                    withdrawButton.disabled = m.withdrawalPending || Boolean(acc.admin_frozen) || m.withdrawableAmount <= 0;
                    withdrawButton.textContent = m.withdrawalPending ? 'Withdrawal under review' : 'Request Withdrawal';
                    withdrawButton.title = m.withdrawalPending
                        ? 'Trading is paused until the administrator resolves this request.'
                        : `Up to $${m.withdrawableAmount.toFixed(2)} gross available`;
                }

                let tradesRows = '';
                if (trades.length === 0) {
                    tradesRows = '<tr><td colspan="9" style="text-align: center; color: #6b7280; padding: 20px;">No trades recorded for this account.</td></tr>';
                } else {
                    trades.forEach(t => {
                        const pnlColor = t.pnl >= 0 ? '#34d399' : '#ef4444';
                        tradesRows += `
                            <tr>
                                <td><code>${t.id}</code></td>
                                <td>${t.symbol}</td>
                                <td><span style="color: ${t.side === 'BUY' ? '#34d399' : '#ef4444'}; font-weight: bold;">${t.side}</span></td>
                                <td>$${t.entry_price.toFixed(2)}</td>
                                <td>$${t.size_usd.toLocaleString()}</td>
                                <td>SL: ${t.sl || 'None'} / TP: ${t.tp || 'None'}</td>
                                <td><span style="color: ${pnlColor}; font-weight: bold;">$${t.pnl.toFixed(2)}</span></td>
                                <td><span style="color: ${t.status === 'OPEN' ? '#fbbf24' : '#9ca3af'}; font-weight: 600;">${t.status}</span></td>
                                <td>
                                    ${t.status === 'CLOSED' ? `<button class="btn-share-x" onclick="shareTradeOnX('${t.id}', '${t.symbol}', '${t.side}', ${t.pnl}, ${t.entry_price})">𝕏 Share</button>` : '-'}
                                </td>
                            </tr>
                        `;
                    });
                }
                const bodyElem = document.getElementById(`trades-body-${acc.id}`);
                if (bodyElem) bodyElem.innerHTML = tradesRows;

                const dailyHistory = [...(details.dailySummaries || [])];
                dailyHistory.push({
                    day: acc.risk_day || new Date().toISOString().slice(0, 10),
                    profit: m.riskBalance - acc.daily_starting_balance
                });
                renderDailyProfitChart(cardElem.querySelector(`#profit-chart-${CSS.escape(acc.id)}`), dailyHistory);
            }
            if (!container.querySelector('[id^="acc-card-"]')) {
                const emptyMessage = document.createElement('p');
                emptyMessage.className = 'account-chart-empty';
                emptyMessage.textContent = showActiveAccountsOnly
                    ? 'No active accounts. Turn off “Show active accounts only” to review breached or frozen accounts.'
                    : 'No accounts found.';
                container.replaceChildren(emptyMessage);
            }
        }

        function renderDailyProfitChart(container, dailyHistory) {
            if (!container) return;
            const points = dailyHistory
                .filter(point => /^\d{4}-\d{2}-\d{2}$/.test(point.day) && Number.isFinite(Number(point.profit)))
                .sort((left, right) => left.day.localeCompare(right.day))
                .slice(-14);
            if (!points.length) {
                container.innerHTML = '<p class="account-chart-empty">Daily profit history will appear here.</p>';
                return;
            }

            const width = 640;
            const height = 220;
            const left = 54;
            const right = width - 18;
            const top = 20;
            const bottom = 166;
            const values = points.map(point => Number(point.profit));
            const minValue = Math.min(0, ...values);
            const maxValue = Math.max(0, ...values);
            const range = Math.max(1, maxValue - minValue);
            const x = index => points.length === 1 ? (left + right) / 2 : left + index * (right - left) / (points.length - 1);
            const y = value => bottom - ((value - minValue) / range) * (bottom - top);
            const zeroY = y(0);
            const coordinates = points.map((point, index) => `${x(index)},${y(Number(point.profit))}`).join(' ');
            const circles = points.map((point, index) => (
                `<circle cx="${x(index)}" cy="${y(Number(point.profit))}" r="4" fill="#c084fc"><title>${point.day}: $${Number(point.profit).toFixed(2)}</title></circle>`
            )).join('');
            const dateLabels = points.map((point, index) => (
                index % Math.max(1, Math.ceil(points.length / 7)) === 0 || index === points.length - 1
                    ? `<text x="${x(index)}" y="194" text-anchor="middle">${point.day.slice(5)}</text>`
                    : ''
            )).join('');
            const rows = [...points].reverse().map(point => `
                <tr><td>${point.day}</td><td class="${Number(point.profit) >= 0 ? 'profit-positive' : 'profit-negative'}">$${Number(point.profit).toFixed(2)}</td></tr>
            `).join('');

            container.innerHTML = `
                <svg class="daily-profit-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily profit by date">
                    <line x1="${left}" y1="${zeroY}" x2="${right}" y2="${zeroY}" class="profit-zero-line"></line>
                    <polyline points="${coordinates}" class="profit-line"></polyline>
                    ${circles}${dateLabels}
                </svg>
                <div class="table-responsive">
                    <table class="daily-profit-table"><thead><tr><th>Date (UTC)</th><th>Profit</th></tr></thead><tbody>${rows}</tbody></table>
                </div>
            `;
        }

        async function requestWithdrawal(accountId) {
            try {
                const detailsRes = await walletFetch(`/api/accounts/details?account_id=${encodeURIComponent(accountId)}&wallet=${encodeURIComponent(connectedWallet)}`);
                const details = await detailsRes.json();
                if (!detailsRes.ok || !details || !details.account) { alert(details.error || "Could not fetch account details."); return; }

                const acc = details.account;
                const availableGross = Number(details.metrics?.withdrawableAmount) || 0;
                if (details.metrics?.withdrawalPending) {
                    alert('A withdrawal is already awaiting admin review. Trading remains paused until it is resolved.');
                    return;
                }
                if (availableGross <= 0) {
                    alert(`Withdrawals are available only from funds above the protected balance of $${Number(details.metrics?.withdrawalFloor || 0).toFixed(2)} USDT.`);
                    return;
                }
                const amountInput = prompt(
                    `Maximum gross withdrawal: $${availableGross.toFixed(2)} USDT.\n` +
                    `You receive 90% ($${(availableGross * 0.9).toFixed(2)}); admin retains 10% ($${(availableGross * 0.1).toFixed(2)}).\n` +
                    'Your account will pause new trades while the request is reviewed. The gross amount is deducted only if approved.\nEnter gross USDT amount:'
                );
                if (!amountInput) return;
                const amount = parseFloat(amountInput);

                if (isNaN(amount) || amount <= 0 || amount > availableGross) {
                    alert("Invalid amount or exceeds your limit.");
                    return;
                }

                const authorization = await signedTradeAuthorization();
                const res = await fetch('/api/withdrawals/request', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...authorization, account_id: accountId, amount })
                });
                const data = await res.json();
                if (data.success) { alert(`Withdrawal requested for review.\nGross: $${data.gross_amount.toFixed(2)}\nYou receive: $${data.user_amount.toFixed(2)}\nAdmin share: $${data.admin_share.toFixed(2)}`); loadUserAccounts(connectedWallet); }
                else alert("Error: " + data.error);
            } catch (err) { console.error(err); }
        }

        async function requestCommissionWithdrawal() {
            const amountInput = prompt(`Enter commission USDT amount (Available: $${availableCommissionBalance.toFixed(2)}):`);
            if (!amountInput) return;
            const amount = parseFloat(amountInput);
            if (isNaN(amount) || amount <= 0 || amount > availableCommissionBalance) { alert("Invalid amount."); return; }

            try {
                const authorization = await signedTradeAuthorization();
                const res = await fetch('/api/referrals/withdraw', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...authorization, amount })
                });
                const data = await res.json();
                if (data.success) { alert("Commission withdrawal submitted!"); loadUserProfile(connectedWallet); }
                else alert("Error: " + data.error);
            } catch (err) { console.error(err); }
        }

        async function loadAdminWithdrawals() {
            try {
                const authorization = await signedTradeAuthorization();
                const res = await fetch('/api/admin/withdrawals', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(authorization)
                });
                const data = await readAdminApiResponse(res, '/api/admin/withdrawals');
                const tbody = document.getElementById('admin-payout-queue');
                if (!tbody) return;
                if (!res.ok) throw new Error(data.error || 'Unable to load withdrawal queue.');
                tbody.innerHTML = '';

                if (!data.withdrawals || data.withdrawals.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #6b7280; padding: 24px;">No withdrawal requests.</td></tr>';
                    return;
                }

                data.withdrawals.forEach(w => {
                    let statusColor = w.status === 'PAID' ? '#34d399' : (w.status === 'REJECTED' ? '#ef4444' : '#fbbf24');
                    let actionsHtml = w.status === 'PENDING' ? `
                        <button class="btn-wallet" style="padding: 4px 10px; font-size: 11px; background: #059669;" data-withdrawal-id="${escapeHTML(w.id)}" data-withdrawal-action="APPROVE" data-withdrawal-type="${escapeHTML(w.type)}">${w.type === 'ACCOUNT' ? 'Approve payout' : 'Mark paid'}</button>
                        <button class="btn-sell" style="padding: 4px 10px; font-size: 11px;" data-withdrawal-id="${escapeHTML(w.id)}" data-withdrawal-action="REJECT" data-withdrawal-type="${escapeHTML(w.type)}">Reject</button>
                        ${w.type === 'ACCOUNT' ? `<button class="btn-sell" style="padding: 4px 10px; font-size: 11px;" data-admin-account-id="${escapeHTML(w.account_id)}" data-admin-account-action="FREEZE">Freeze account</button>` : ''}
                    ` : `<span style="color: #9ca3af;">Processed</span>`;
                    const accountDetails = w.type === 'ACCOUNT'
                        ? `<strong>${escapeHTML(w.plan_name)}</strong><br>Balance: $${Number(w.account_balance).toFixed(2)}<br>${Number(w.admin_frozen) ? 'Manual freeze: ' + escapeHTML(w.admin_freeze_reason || 'active') : (w.trades?.some(trade => trade.status === 'OPEN') ? 'Open trades: ' + w.trades.filter(trade => trade.status === 'OPEN').length : 'No open trades')}<details><summary>Review ${w.trades?.length || 0} trades</summary>${renderAdminTradeTable(w.trades || [])}</details>`
                        : escapeHTML(w.plan_name);
                    const amountDetails = w.type === 'ACCOUNT'
                        ? `<strong>$${Number(w.amount).toFixed(2)} gross</strong><br>User: $${Number(w.user_amount).toFixed(2)}<br>Admin: $${Number(w.admin_share).toFixed(2)}`
                        : `<strong>$${Number(w.amount).toFixed(2)}</strong>`;

                    tbody.innerHTML += `
                        <tr>
                            <td><code>${escapeHTML(w.id)}</code></td>
                            <td><span style="color: ${w.type === 'COMMISSION' ? '#c084fc' : '#60a5fa'}; font-weight: bold;">${escapeHTML(w.type)}</span></td>
                            <td><code style="color: #c084fc;" title="${escapeHTML(w.wallet_address)}">${escapeHTML(w.wallet_address.substring(0,6))}...${escapeHTML(w.wallet_address.slice(-4))}</code></td>
                            <td>${accountDetails}</td>
                            <td>${amountDetails}</td>
                            <td><span style="color: ${statusColor}; font-weight: bold;">${w.status}</span></td>
                            <td>${actionsHtml}</td>
                        </tr>
                    `;
                });
                tbody.onclick = event => {
                    const withdrawalButton = event.target.closest('[data-withdrawal-id]');
                    if (withdrawalButton) {
                        processWithdrawal(
                            withdrawalButton.dataset.withdrawalId,
                            withdrawalButton.dataset.withdrawalAction,
                            withdrawalButton.dataset.withdrawalType
                        );
                        return;
                    }
                    const accountButton = event.target.closest('[data-admin-account-action]');
                    if (accountButton) adminAccountAction(accountButton.dataset.adminAccountId, accountButton.dataset.adminAccountAction);
                };
            } catch (err) {
                console.error(err);
                const tbody = document.getElementById('admin-payout-queue');
                if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="color:#f87171;padding:18px;">${escapeHTML(err.message)}</td></tr>`;
            }
        }

        function renderAdminTradeTable(trades) {
            if (!trades.length) return '<p class="account-chart-empty">No trades recorded.</p>';
            const rows = trades.map(trade => `
                <tr>
                    <td><code>${escapeHTML(trade.id)}</code></td>
                    <td>${escapeHTML(trade.symbol)}</td>
                    <td>${escapeHTML(trade.side)}</td>
                    <td>${escapeHTML(trade.status)}</td>
                    <td>$${Number(trade.entry_price).toFixed(2)}</td>
                    <td>$${Number(trade.size_usd).toFixed(2)}</td>
                    <td>$${Number(trade.pnl || 0).toFixed(2)}</td>
                </tr>
            `).join('');
            return `<div class="table-responsive"><table class="admin-trade-table"><thead><tr><th>Trade</th><th>Pair</th><th>Side</th><th>Status</th><th>Entry</th><th>Size</th><th>PnL</th></tr></thead><tbody>${rows}</tbody></table></div>`;
        }

        async function loadAdminAccounts() {
            const container = document.getElementById('admin-account-list');
            if (!container) return;
            try {
                const authorization = await signedTradeAuthorization();
                const response = await fetch('/api/admin/accounts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(authorization)
                });
                const data = await readAdminApiResponse(response, '/api/admin/accounts');
                if (!response.ok) throw new Error(data.error || 'Unable to load account reviews.');
                if (!data.accounts?.length) {
                    container.innerHTML = '<p class="account-chart-empty">No accounts found.</p>';
                    return;
                }
                container.innerHTML = data.accounts.map(account => {
                    const mllCap = Number(account.initial_balance) * (1 + Number(account.max_drawdown_pct) / 100);
                    const riskLock = account.permanent_lock
                        ? `Permanent risk lock: ${escapeHTML(account.lock_reason || 'MLL')}`
                        : account.locked_until ? `Risk lock until ${escapeHTML(account.locked_until)}` : '';
                    const adminFreeze = Number(account.admin_frozen) === 1;
                    const automaticPause = Number(account.withdrawal_pending) === 1;
                    return `
                        <article class="admin-account-card">
                            <div class="admin-account-heading">
                                <div><strong>${escapeHTML(account.plan_name)}</strong> · <code>${escapeHTML(account.id)}</code><br><code>${escapeHTML(account.wallet_address)}</code></div>
                                <button class="${adminFreeze ? 'btn-sell' : 'btn-wallet'}" data-admin-account-action="${adminFreeze ? 'UNFREEZE' : 'FREEZE'}" data-admin-account-id="${escapeHTML(account.id)}">${adminFreeze ? 'Unfreeze account' : 'Freeze account'}</button>
                            </div>
                            <div class="admin-account-stats">
                                <span>Balance: <strong>$${Number(account.current_balance).toFixed(2)}</strong></span>
                                <span>Risk balance: <strong>$${Number(account.risk_balance).toFixed(2)}</strong></span>
                                <span>Equity: <strong>$${Number(account.current_equity).toFixed(2)}</strong></span>
                                <span>Protected floor: <strong>$${mllCap.toFixed(2)}</strong></span>
                                ${adminFreeze ? `<span class="admin-account-flag">Manual freeze: ${escapeHTML(account.admin_freeze_reason || '')}</span>` : ''}
                                ${automaticPause ? '<span class="admin-account-flag">Withdrawal review pause active</span>' : ''}
                                ${riskLock ? `<span class="admin-account-flag">${riskLock}</span>` : ''}
                            </div>
                            <details><summary>Review ${account.trades?.length || 0} trades</summary>${renderAdminTradeTable(account.trades || [])}</details>
                        </article>
                    `;
                }).join('');
                container.onclick = event => {
                    const button = event.target.closest('[data-admin-account-action]');
                    if (button) adminAccountAction(button.dataset.adminAccountId, button.dataset.adminAccountAction);
                };
            } catch (err) {
                console.error(err);
                container.innerHTML = `<p class="account-chart-empty">${escapeHTML(err.message)}</p>`;
            }
        }

        async function adminAccountAction(accountId, action) {
            const reason = action === 'FREEZE' ? prompt('Why is this account being frozen?')?.trim() : '';
            if (action === 'FREEZE' && !reason) return;
            const promptText = action === 'FREEZE'
                ? `Freeze this account? New trades and withdrawals will be blocked.`
                : 'Remove the administrator freeze? Any DLL/MLL risk lock will remain.';
            if (!confirm(promptText)) return;
            try {
                const authorization = await signedTradeAuthorization();
                const response = await fetch('/api/admin/accounts/action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...authorization, account_id: accountId, action, reason })
                });
                const data = await readAdminApiResponse(response, '/api/admin/accounts/action');
                if (!response.ok) throw new Error(data.error || 'Unable to update account freeze.');
                alert(data.message);
                loadAdminAccounts();
                loadAdminWithdrawals();
            } catch (err) {
                console.error(err);
                alert(err.message);
            }
        }

        async function processWithdrawal(withdrawalId, action, type) {
            if (!confirm(action === 'APPROVE'
                ? `Approve this payout? The gross amount will be deducted from the account. Transfer 90% to the user and retain 10% for admin.`
                : `Reject this withdrawal request? No account funds have been deducted.`)) return;
            try {
                const authorization = await signedTradeAuthorization();
                const res = await fetch('/api/admin/withdrawals/action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...authorization, withdrawal_id: withdrawalId, action, type })
                });
                const data = await readAdminApiResponse(res, '/api/admin/withdrawals/action');
                if (data.success) { alert(data.message); loadAdminWithdrawals(); loadAdminAccounts(); if (connectedWallet) loadUserAccounts(connectedWallet); }
                else alert("Error: " + data.error);
            } catch (err) { console.error(err); }
        }

        function switchActiveAccount(accId) {
            activeAccount = userAccounts.find(a => a.id === accId && isSelectableTradingAccount(a)) || null;
            selectedAccountId = activeAccount?.id || null;
            if (!activeAccount) {
                const selectElem = document.getElementById('active-account-select');
                if (selectElem) selectElem.value = '';
                updateAvailableBalanceLabel();
                return;
            }
            updateAvailableBalanceLabel();
            loadOpenTrades(selectedAccountId);
        }

        function selectAccountAndTrade(accId) {
            activeAccount = userAccounts.find(a => a.id === accId && isSelectableTradingAccount(a)) || null;
            if (!activeAccount) {
                setTradeFeedback('This account is locked or unavailable for trading.');
                return;
            }
            selectedAccountId = activeAccount.id;
            const selectElem = document.getElementById('active-account-select');
            if (selectElem) selectElem.value = accId;
            updateAvailableBalanceLabel();
            switchView('tradeView');
            loadOpenTrades(accId);
        }

        function updateAvailableBalanceLabel() {
            const balLabel = document.getElementById('available-bal-label');
            if (balLabel) {
                balLabel.innerText = activeAccount ? `Available Balance: $${activeAccount.current_balance.toLocaleString()}` : `Available Balance: $0.00`;
            }
        }

        async function monitorClientStops() {
            if (!connectedWallet || !selectedAccountId || !currentLivePrice) return;
            const selectedSymbol = document.getElementById('order-symbol')?.value;
            try {
                const response = await walletFetch(`/api/trades/active?account_id=${encodeURIComponent(selectedAccountId)}&wallet=${encodeURIComponent(connectedWallet)}`);
                const data = await response.json();
                for (const trade of data.trades || []) {
                    if (trade.symbol !== selectedSymbol || closingTradeIds.has(trade.id)) continue;
                    const hitStop = trade.side === 'BUY'
                        ? (trade.sl && currentLivePrice <= trade.sl) || (trade.tp && currentLivePrice >= trade.tp)
                        : (trade.sl && currentLivePrice >= trade.sl) || (trade.tp && currentLivePrice <= trade.tp);
                    if (hitStop) {
                        closingTradeIds.add(trade.id);
                        await closeTrade(trade.id, currentLivePrice, true);
                    }
                }
            } catch (error) {
                console.warn('Unable to check browser-side stop orders:', error);
            }
        }

        async function signedTradeAuthorization() {
            const provider = getProvider();
            if (!provider || !connectedWallet) throw new Error('Connect the wallet that owns this account first.');
            const challengeResponse = await fetch('/api/auth/trade-challenge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ wallet_address: connectedWallet })
            });
            const challengeData = await challengeResponse.json();
            if (!challengeResponse.ok) throw new Error(challengeData.error || 'Unable to request wallet authorization.');

            const encodedMessage = `0x${Array.from(new TextEncoder().encode(challengeData.challenge), byte => byte.toString(16).padStart(2, '0')).join('')}`;
            const signature = await provider.request({
                method: 'personal_sign',
                params: [encodedMessage, connectedWallet]
            });
            return {
                wallet_address: connectedWallet,
                challenge: challengeData.challenge,
                signature
            };
        }

        async function ensureWalletSession() {
            const owner = connectedWallet?.toLowerCase();
            if (!owner) throw new Error('Connect a wallet to view private account data.');
            if (walletSessionToken && walletSessionOwner === owner && walletSessionExpiresAt > Date.now()) {
                return walletSessionToken;
            }
            if (walletSessionPromise && walletSessionOwner === owner) return walletSessionPromise;

            const generation = walletSessionGeneration;
            const sessionPromise = (async () => {
                const authorization = await signedTradeAuthorization();
                if (generation !== walletSessionGeneration || owner !== connectedWallet?.toLowerCase()) {
                    throw new Error('Wallet changed before authorization completed.');
                }
                const response = await fetch('/api/auth/wallet-session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(authorization)
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Unable to establish a wallet session.');
                walletSessionToken = data.token;
                walletSessionOwner = owner;
                walletSessionExpiresAt = data.expires_at;
                return walletSessionToken;
            })();
            walletSessionOwner = owner;
            walletSessionPromise = sessionPromise;
            try {
                return await sessionPromise;
            } finally {
                if (walletSessionPromise === sessionPromise) walletSessionPromise = null;
            }
        }

        async function walletFetch(url, options = {}) {
            const token = await ensureWalletSession();
            return fetch(url, {
                ...options,
                headers: {
                    ...(options.headers || {}),
                    Authorization: `Bearer ${token}`
                }
            });
        }

        async function loadOpenTrades(accountId) {
            if (!accountId) return;
            const res = await walletFetch(`/api/trades/active?account_id=${encodeURIComponent(accountId)}&wallet=${encodeURIComponent(connectedWallet)}`);
            const data = await res.json();
            const tbody = document.getElementById('open-trades-list');
            if (!tbody) return;
            tbody.innerHTML = '';

            if (!data.trades || data.trades.length === 0) {
                tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: #6b7280; padding: 24px;">No open positions for this account.</td></tr>';
                return;
            }

            data.trades.forEach(trd => {
                const currentPrice = trd.current_price || currentLivePrice || trd.entry_price;
                const priceDiff = trd.side === 'BUY' ? (currentPrice - trd.entry_price) : (trd.entry_price - currentPrice);
                const pnl = Number.isFinite(Number(trd.live_pnl)) ? Number(trd.live_pnl) : priceDiff * trd.units;
                const pnlColor = pnl >= 0 ? '#34d399' : '#ef4444';
                const leverageDisplay = trd.leverage && trd.leverage > 1 ? `${trd.leverage}x Perp` : '1x Spot';

                tbody.innerHTML += `
                    <tr>
                        <td><code>${trd.id}</code></td>
                        <td>${trd.symbol}</td>
                        <td><span style="color: ${trd.side === 'BUY' ? '#34d399' : '#ef4444'}; font-weight: bold;">${trd.side}</span></td>
                        <td>${leverageDisplay}</td>
                        <td>$${trd.entry_price.toFixed(2)}</td>
                        <td>$${trd.size_usd.toLocaleString()}</td>
                        <td>SL: ${trd.sl || 'None'} / TP: ${trd.tp || 'None'}</td>
                        <td><span style="color: ${pnlColor}; font-weight: bold;">$${pnl.toFixed(2)}</span></td>
                        <td><button class="btn-sell" style="padding:5px 10px; font-size:11px;" onclick="closeTrade('${trd.id}', ${currentPrice})">Close Early</button></td>
                    </tr>
                `;
            });
        }

        async function executeTrade(side) {
            if (!selectedAccountId || !activeAccount) { setTradeFeedback('Select or purchase an active trading account first.'); return; }
            const symbol = document.getElementById('order-symbol').value;
            const price = parseFloat(document.getElementById('order-price').value) || currentLivePrice;
            const sizeUsd = parseFloat(document.getElementById('order-size-usd').value);
            const leverage = parseInt(document.getElementById('order-leverage').value) || 1;
            const sl = parseFloat(document.getElementById('order-sl').value) || null;
            const tp = parseFloat(document.getElementById('order-tp').value) || null;

            if (!sizeUsd || sizeUsd <= 0 || sizeUsd > activeAccount.current_balance) {
                setTradeFeedback('Please check position size and available balance.');
                return;
            }

            const totalNotional = sizeUsd * leverage;
            const buyButton = document.querySelector('.btn-buy[onclick*="executeTrade"]');
            const sellButton = document.querySelector('.btn-sell[onclick*="executeTrade"]');
            setTradeFeedback('');
            if (buyButton) buyButton.disabled = true;
            if (sellButton) sellButton.disabled = true;

            try {
                const res = await walletFetch('/api/trades/execute', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        wallet_address: connectedWallet,
                        account_id: selectedAccountId, 
                        symbol, 
                        side, 
                        price, 
                        size_usd: totalNotional,
                        margin_used: sizeUsd,
                        leverage: leverage,
                        is_perp: leverage > 1,
                        sl, 
                        tp 
                    })
                });
                const data = await res.json();
                if (data.success) {
                    await loadUserAccounts(connectedWallet);
                    await loadOpenTrades(selectedAccountId);
                } else setTradeFeedback(data.error || 'Unable to execute trade.');
            } catch (err) {
                console.error('Unable to execute trade:', err);
                setTradeFeedback(err.message || 'Unable to execute trade.');
            } finally {
                if (buyButton) buyButton.disabled = false;
                if (sellButton) sellButton.disabled = false;
            }
        }

        async function closeTrade(tradeId, currentPrice, automatic = false) {
            if (!automatic && !confirm("Are you sure you want to close this position early?")) return;
            try {
                const res = await walletFetch('/api/trades/close', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ wallet_address: connectedWallet, trade_id: tradeId, current_market_price: currentPrice })
                });
                const data = await res.json();
                if (data.success) {
                    loadUserAccounts(connectedWallet);
                    loadLeaderboard(currentLeaderboardMode);
                } else if (!automatic) setTradeFeedback(data.error || 'Unable to close position.');
            } catch (err) {
                console.error('Unable to close trade:', err);
                if (!automatic) setTradeFeedback(err.message || 'Unable to close trade.');
            } finally {
                closingTradeIds.delete(tradeId);
            }
        }

        async function loadPlans() {
            try {
                const res = await fetch('/api/plans');
                const data = await res.json();
                plansData = data.plans || [];
                if (plansData.length === 0 && planLoadAttempts < 5) {
                    planLoadAttempts++;
                    setTimeout(loadPlans, 400);
                    return;
                }
                planLoadAttempts = 0;
                renderPlans();
            } catch(e) { console.error("Plans load error:", e); }
        }

        function renderPlans() {
            const container = document.getElementById('plans-container');
            if (!container) return;
            container.innerHTML = '';

            plansData.forEach(plan => {
                let displayPrice = plan.base_price_usdt;
                let priceHtml = `$${plan.base_price_usdt.toLocaleString()} USDT`;

                if (activePromoCode) {
                    displayPrice = plan.price_usdt;
                    priceHtml = `<span style="text-decoration: line-through; color: #6b7280; font-size: 15px;">$${plan.base_price_usdt.toLocaleString()}</span> <span style="color: #34d399;">$${plan.price_usdt.toLocaleString()} USDT</span>`;
                }

                container.innerHTML += `
                    <div class="card" style="display: flex; flex-direction: column; justify-content: space-between;">
                        <div>
                            <h3 style="margin:0; color:#c084fc; font-size: 18px; font-weight: 800;">${plan.name}</h3>
                            <div style="font-size: 24px; font-weight: 800; color: #fff; margin: 12px 0;">${priceHtml}</div>
                            <div style="font-size: 13px; color: #9ca3af; margin: 6px 0;">Simulated Capital: <strong>$${plan.simulated_capital.toLocaleString()}</strong></div>
                            <div style="font-size: 13px; color: #9ca3af; margin: 6px 0;">Profit Target: <strong>$${plan.profit_target.toLocaleString()}</strong></div>
                            <div style="font-size: 13px; color: #9ca3af; margin: 6px 0;">Daily Loss Limit: <strong>$${(plan.simulated_capital * (plan.daily_loss_pct / 100)).toLocaleString()}</strong> (${plan.daily_loss_pct}%)</div>
                            <div style="font-size: 13px; color: #9ca3af; margin: 6px 0;">Max Drawdown: <strong>$${(plan.simulated_capital * (plan.max_drawdown_pct / 100)).toLocaleString()}</strong> (${plan.max_drawdown_pct}%)</div>
                        </div>
                        <button class="btn-wallet" style="margin-top:24px; width:100%; padding: 12px;" onclick="buyPlan(${plan.id}, ${displayPrice})">Buy Plan ($${displayPrice})</button>
                    </div>
                `;
            });
        }

        async function applyPromo() {
            const code = document.getElementById('applied-promo')?.value.trim();
            if (!code) return;

            const res = await fetch('/api/promo/validate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });
            const data = await res.json();

            const feedback = document.getElementById('promo-feedback');
            if (data.valid) {
                activePromoCode = code.toUpperCase();
                if (feedback) feedback.innerText = `✓ Code '${activePromoCode}' applied! Discount active.`;
                renderPlans();
            } else {
                activePromoCode = null;
                if (feedback) feedback.innerText = `✕ Invalid promo code.`;
                renderPlans();
            }
        }

        async function loadUserProfile(wallet) {
            try {
                const res = await walletFetch(`/api/user/profile?wallet=${encodeURIComponent(wallet)}`);
                const data = await res.json();
                
                const setupBox = document.getElementById('profile-setup-box');
                const dispBox = document.getElementById('profile-display-box');
                const editBtn = document.getElementById('btn-toggle-edit');

                if (data.user) {
                    currentUserProfile = data.user;
                    if (setupBox) setupBox.style.display = 'none';
                    if (dispBox) dispBox.style.display = 'block';
                    if (editBtn) editBtn.style.display = 'inline-block';

                    const dUser = document.getElementById('disp-username');
                    const dCode = document.getElementById('disp-code');
                    const dLink = document.getElementById('disp-link');
                    if (dUser) dUser.innerText = data.user.username;
                    if (dCode) dCode.innerText = data.user.discount_code;
                    if (dLink) dLink.value = `https://blastrr.com/?ref=${data.user.discount_code}`;

                    const pUser = document.getElementById('prof-username');
                    const pCode = document.getElementById('prof-code');
                    if (pUser) pUser.value = data.user.username;
                    if (pCode) pCode.value = data.user.discount_code;

                    const refCount = document.getElementById('stat-ref-count');
                    const refEarn = document.getElementById('stat-ref-earnings');
                    if (refCount) refCount.innerText = data.stats.total_referrals || 0;
                    availableCommissionBalance = data.stats.available_commission || 0;
                    if (refEarn) refEarn.innerText = `$${availableCommissionBalance.toFixed(2)} USDT`;

                    loadReferralTransactions(wallet);
                } else {
                    currentUserProfile = null;
                    if (setupBox) setupBox.style.display = 'block';
                    if (dispBox) dispBox.style.display = 'none';
                    if (editBtn) editBtn.style.display = 'none';
                }
                loadLeaderboard(currentLeaderboardMode);
            } catch (err) { console.error(err); }
        }

        function toggleEditProfile() {
            const setupBox = document.getElementById('profile-setup-box');
            if (setupBox) setupBox.style.display = setupBox.style.display === 'none' ? 'block' : 'none';
        }

        async function loadReferralTransactions(wallet) {
            try {
                const res = await walletFetch(`/api/user/referrals?wallet=${encodeURIComponent(wallet)}`);
                const data = await res.json();
                const tbody = document.getElementById('ref-transactions-list');
                if (!tbody) return;
                tbody.innerHTML = '';

                if (!data.referrals || data.referrals.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #6b7280; padding: 24px;">No sales recorded yet.</td></tr>';
                    return;
                }

                data.referrals.forEach(ref => {
                    const buyerName = ref.buyer_username ? `@${ref.buyer_username}` : 'Anonymous Trader';
                    const dateStr = new Date(ref.created_at).toLocaleString();
                    tbody.innerHTML += `
                        <tr>
                            <td><strong>${buyerName}</strong></td>
                            <td>${ref.plan_name}</td>
                            <td><span style="color: #34d399; font-weight: bold;">+$${ref.commission_earned.toFixed(2)} USDT</span></td>
                            <td style="color: #9ca3af; font-size: 12.5px;">${dateStr}</td>
                        </tr>
                    `;
                });
            } catch (err) { console.error(err); }
        }

        async function saveProfile() {
            if (!connectedWallet) { alert("Connect wallet first!"); return; }
            const username = document.getElementById('prof-username')?.value.trim();
            const discount_code = document.getElementById('prof-code')?.value.trim();

            if (!username || !discount_code) {
                alert("Please provide both a username and a promo code.");
                return;
            }

            const authorization = await signedTradeAuthorization();
            const res = await fetch('/api/user/profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...authorization, username, discount_code })
            });
            const data = await res.json();

            if (data.success) {
                alert("Profile saved successfully!");
                loadUserProfile(connectedWallet);
            } else {
                alert("Error: " + data.error);
            }
        }

        async function buyPlan(planId, priceUsdt) {
            if (!connectedWallet) { alert("Connect wallet first!"); return; }
            
            const selectedChainId = parseInt(document.getElementById('payment-chain-select')?.value || '1');
            const chainConfig = SUPPORTED_EVM_CHAINS[selectedChainId];
            if (!chainConfig) { alert("Invalid network selection."); return; }

            const provider = getProvider();
            if (!provider) return;

            try {
                await ensurePaymentNetwork(provider, chainConfig);
            } catch (networkErr) {
                console.error("Payment network switch error:", networkErr);
                alert(networkErr.message || `Unable to connect to ${chainConfig.name}. Please check your wallet network.`);
                return;
            }

            if (!confirm(`Confirm purchase for $${priceUsdt} USDT on ${chainConfig.name}?`)) return;

            try {
                const paddedRecipient = TREASURY_WALLET.toLowerCase().replace('0x', '').padStart(64, '0');
                const rawAmount = BigInt(Math.round(priceUsdt * 1e6));
                const amountHex = rawAmount.toString(16).padStart(64, '0');
                const calldata = '0xa9059cbb' + paddedRecipient + amountHex;

                const txHash = await provider.request({
                    method: 'eth_sendTransaction',
                    params: [{
                        from: connectedWallet,
                        to: chainConfig.usdtAddress,
                        data: calldata
                    }]
                });

                alert("Transaction submitted! Verifying on-chain...");

                const res = await fetch('/api/accounts/purchase', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        wallet_address: connectedWallet, 
                        plan_id: planId, 
                        tx_hash: txHash, 
                        chain_id: selectedChainId,
                        promo_code: activePromoCode 
                    })
                });
                const data = await res.json();

                if (data.success) {
                    alert("Payment verified on-chain! Account provisioned successfully.");
                    loadUserAccounts(connectedWallet);
                    switchView('tradeView');
                } else {
                    alert("Verification Error: " + data.error);
                }
            } catch (err) {
                console.error("Purchase Error:", err);
                alert("Transaction failed or was rejected.");
            }
        }
