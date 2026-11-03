const defaultPageTitle = document.title;
let connectedWallet = null;
        let availableWallets = [];
        let userAccounts = [];
        let userReviewAccounts = [];
        let selectedAccountId = null;
        let activeAccount = null;
        let tvWidget = null;
        let liveMarketChart = null;
        let liveMarketCandleSeries = null;
        let liveMarketResizeObserver = null;
        let liveMarketChartPair = null;
        let liveMarketChartStatus = null;
        let liveMarketLastCandle = null;
        let liveMarketChartGeneration = 0;
        let livePriceRequestGeneration = 0;
        let activePromoCode = null;
        let battlePassDiscountBonusPct = 0;
        let standardDiscountPct = 90;
        let plansData = [];
        let planLoadAttempts = 0;
        let livePriceInterval = null;
        let autoSyncInterval = null;
        let currentLivePrice = 0;
        let displayedOpenTrades = [];
        let userHasEditedPrice = false;
        let availableCommissionBalance = 0;
        let currentLeaderboardMode = 'DAILY';
        let rawLeaderboardData = [];
        let currentUserProfile = null;
        let hidePermanentlyLockedAccounts = true;
        let walletSessionToken = null;
        let walletSessionOwner = null;
        let walletSessionExpiresAt = 0;
        let walletSessionPromise = null;
        let walletSessionGeneration = 0;
        let dashboardInitialized = false;
        let dashboardAuthenticated = false;
        let disclaimerGateMode = 'login';
        let pendingPurchaseDisclaimer = null;
        let battlePassProfile = null;
        let battlePassTasks = [];
        let battlePassLevels = [];
        let battlePassActiveTab = 'missions';
        let adminBattlePassTasks = [];
                let marketsData = [];
                const closingTradeIds = new Set();
        let maintenanceStatuses = {};
        let maintenanceMessage = '';
        let currentWalletIsAdmin = false;
        const maintenanceViewPages = {
            tradeView: 'trade',
            accountsView: 'accounts',
            leaderboardView: 'leaderboard',
            blastrrPassView: 'blastrrpass',
            profileView: 'profile',
            buyView: 'plans'
        };
        const maintenancePageLabels = {
            home: 'Homepage',
            trade: 'Trading Terminal',
            accounts: 'My Accounts',
            leaderboard: 'Leaderboard',
            blastrrpass: 'BlastrrPass',
            profile: 'Profile & Promos',
            plans: 'Buy Plans',
            faq: 'FAQ',
            docs: 'Docs'
        };
        
        const TREASURY_WALLET = "0x8632fa855d5dc6b59a3cf892d72cf4a94f182aae";
        const DISCLAIMER_VERSION = '2026-11-02-v1';

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
            1: { name: "Ethereum Mainnet", chainIdHex: "0x1", usdtAddress: "0xdac17f958d2ee523a2206206994597c13d831ec7", decimals: 6 },
            8453: { name: "Base", chainIdHex: "0x2105", usdtAddress: "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2", decimals: 6 },
            137: { name: "Polygon PoS", chainIdHex: "0x89", usdtAddress: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", decimals: 6 },
            43114: { name: "Avalanche C-Chain", chainIdHex: "0xa86a", usdtAddress: "0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7", decimals: 6 },
            56: {
                name: "BNB Smart Chain",
                chainIdHex: "0x38",
                rpcUrl: "https://bsc-dataseed.binance.org",
                nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
                usdtAddress: "0x55d398326f99059fF775485246999027B3197955",
                decimals: 18
            },
            448000: {
                name: "NullNet Private EVM",
                chainIdHex: "0x6d600",
                rpcUrl: "https://rpc.lunul.org",
                nativeCurrency: { name: "LUN", symbol: "LUN", decimals: 18 },
                usdtAddress: "0x7ec3659A8225ED474D7c662126616aE08545C29b",
                decimals: 18
            }
        };

        function toTokenUnits(amount, decimals) {
            const match = String(amount).match(/^(\d+)(?:\.(\d+))?$/);
            if (!match || (match[2]?.length || 0) > decimals) {
                throw new Error('Invalid payment amount for token precision.');
            }
            const whole = BigInt(match[1]) * (10n ** BigInt(decimals));
            const fraction = BigInt((match[2] || '').padEnd(decimals, '0') || '0');
            return whole + fraction;
        }

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
            await loadMaintenanceStatus();
            setInterval(loadMaintenanceStatus, 30000);
            const disclaimerScrollArea = document.getElementById('disclaimer-scroll-area');
            disclaimerScrollArea?.addEventListener('scroll', updateDisclaimerScrollState);
            document.getElementById('disclaimer-accept-terms')?.addEventListener('change', updateDisclaimerContinueState);
            document.getElementById('disclaimer-simulated-funds')?.addEventListener('change', updateDisclaimerContinueState);
            document.getElementById('disclaimer-continue-button')?.addEventListener('click', acceptDisclaimer);
            document.getElementById('disclaimer-cancel-purchase')?.addEventListener('click', () => resolvePurchaseDisclaimer(false));
            document.getElementById('wallet-menu-trigger')?.addEventListener('click', toggleWalletMenu);
            document.addEventListener('click', event => {
                if (!event.target.closest('#wallet-menu')) closeWalletMenu();
            });
            document.addEventListener('keydown', event => {
                if (event.key === 'Escape') closeWalletMenu();
            });

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
            const defaultMarket = marketsData.find(market => market.pair === 'NDX100USDT') || marketsData[0];
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
            disposeLiveMarketChart();
            const container = document.getElementById('tradingview-widget-container');
            if (!container) return;
            container.innerHTML = '';
            if (!window.TradingView?.widget) {
                container.textContent = 'TradingView chart is unavailable.';
                return;
            }
            tvWidget = new TradingView.widget({
                "autosize": true,
                "symbol": symbol,
                "interval": "D",
                "timezone": "Etc/UTC",
                "theme": "dark",
                "style": "1",
                "locale": "en",
                "toolbar_bg": "#090d13",
                "studies": ["MAExp@tv-basicstudies"],
                "studies_overrides": {
                    "moving average exponential.plot.color": "#b7bdc5",
                    "moving average exponential.plot.linewidth": 2
                },
                "overrides": {
                    "paneProperties.background": "#090d13",
                    "paneProperties.vertGridProperties.color": "rgba(196, 178, 255, 0.10)",
                    "paneProperties.horzGridProperties.color": "rgba(196, 178, 255, 0.10)",
                    "mainSeriesProperties.candleStyle.upColor": "#72f0c3",
                    "mainSeriesProperties.candleStyle.downColor": "#ff638e",
                    "mainSeriesProperties.candleStyle.borderUpColor": "#72f0c3",
                    "mainSeriesProperties.candleStyle.borderDownColor": "#ff638e",
                    "mainSeriesProperties.candleStyle.wickUpColor": "#72f0c3",
                    "mainSeriesProperties.candleStyle.wickDownColor": "#ff638e"
                },
                "container_id": "tradingview-widget-container"
            });
        }

        function disposeLiveMarketChart() {
            liveMarketChartGeneration += 1;
            liveMarketResizeObserver?.disconnect();
            liveMarketResizeObserver = null;
            liveMarketChart?.remove();
            liveMarketChart = null;
            liveMarketCandleSeries = null;
            liveMarketChartPair = null;
            liveMarketChartStatus = null;
            liveMarketLastCandle = null;
        }

        async function initLiveMarketChart(pair) {
            disposeLiveMarketChart();
            const container = document.getElementById('tradingview-widget-container');
            if (!container) return;
            container.replaceChildren();
            tvWidget = null;

            if (!window.LightweightCharts?.createChart) {
                container.textContent = 'Live perpetual chart is unavailable. Check the chart library connection.';
                return;
            }

            const generation = liveMarketChartGeneration;
            liveMarketChartPair = pair;
            const chartHost = document.createElement('div');
            chartHost.className = 'live-market-chart-host';
            liveMarketChartStatus = document.createElement('div');
            liveMarketChartStatus.className = 'live-market-chart-status';
            liveMarketChartStatus.textContent = 'Loading live Bitget candles…';
            const attribution = document.createElement('a');
            attribution.className = 'live-market-chart-attribution';
            attribution.href = 'https://www.tradingview.com/';
            attribution.target = '_blank';
            attribution.rel = 'noopener noreferrer';
            attribution.textContent = 'Charts by TradingView';
            container.replaceChildren(chartHost, liveMarketChartStatus, attribution);

            liveMarketChart = LightweightCharts.createChart(chartHost, {
                width: chartHost.clientWidth,
                height: chartHost.clientHeight,
                layout: {
                    background: { color: '#090d13' },
                    textColor: '#9ca3af'
                },
                grid: {
                    vertLines: { color: 'rgba(148, 163, 184, 0.08)' },
                    horzLines: { color: 'rgba(148, 163, 184, 0.08)' }
                },
                rightPriceScale: { borderColor: 'rgba(148, 163, 184, 0.16)' },
                timeScale: { borderColor: 'rgba(148, 163, 184, 0.16)', timeVisible: true },
                crosshair: { mode: LightweightCharts.CrosshairMode?.Normal ?? 0 }
            });
            liveMarketCandleSeries = liveMarketChart.addCandlestickSeries({
                upColor: '#34d399',
                downColor: '#f87171',
                borderVisible: false,
                wickUpColor: '#34d399',
                wickDownColor: '#f87171'
            });
            if (window.ResizeObserver) {
                liveMarketResizeObserver = new ResizeObserver(entries => {
                    const { width, height } = entries[0].contentRect;
                    if (width > 0 && height > 0) liveMarketChart?.applyOptions({ width, height });
                });
                liveMarketResizeObserver.observe(chartHost);
            }

            try {
                const endpoint = `https://api.bitget.com/api/v2/mix/market/candles?productType=USDT-FUTURES&symbol=${encodeURIComponent(pair)}&granularity=1m&limit=120`;
                const response = await fetch(endpoint);
                if (!response.ok) throw new Error(`Bitget candle request failed (${response.status}).`);
                const data = await response.json();
                if (data?.code !== '00000') throw new Error(`Bitget candle request failed (${data?.msg || data?.code}).`);
                if (generation !== liveMarketChartGeneration || liveMarketChartPair !== pair) return;

                const candles = (data.data || []).map(candle => ({
                    time: Math.floor(Number(candle[0]) / 1000),
                    open: Number(candle[1]),
                    high: Number(candle[2]),
                    low: Number(candle[3]),
                    close: Number(candle[4])
                })).filter(candle => Number.isFinite(candle.time) &&
                    [candle.open, candle.high, candle.low, candle.close].every(value => Number.isFinite(value) && value > 0))
                    .sort((a, b) => a.time - b.time);
                if (candles.length === 0) throw new Error('Bitget returned no valid candles.');
                liveMarketCandleSeries.setData(candles);
                liveMarketLastCandle = { ...candles[candles.length - 1] };
                liveMarketChart.timeScale().fitContent();
                liveMarketChartStatus.remove();
                liveMarketChartStatus = null;
            } catch (error) {
                if (generation !== liveMarketChartGeneration) return;
                console.error(`Unable to load Bitget candles for ${pair}:`, error.message);
                liveMarketChartStatus.textContent = 'Unable to load live candles. Retrying with the next price update.';
            }
        }

        function updateLiveMarketChart(ticker) {
            if (!liveMarketCandleSeries || !ticker || ticker.symbol !== liveMarketChartPair) return;
            const price = Number(ticker.markPrice);
            const timestamp = Number(ticker.ts);
            if (!Number.isFinite(price) || price <= 0) return;
            const time = Math.floor((Number.isFinite(timestamp) ? timestamp : Date.now()) / 60000) * 60;
            const latest = liveMarketLastCandle;
            if (!latest || time < latest.time) return;
            if (time === latest.time) {
                latest.high = Math.max(latest.high, price);
                latest.low = Math.min(latest.low, price);
                latest.close = price;
                liveMarketCandleSeries.update({ ...latest });
                return;
            }
            liveMarketLastCandle = {
                time,
                open: latest.close,
                high: Math.max(latest.close, price),
                low: Math.min(latest.close, price),
                close: price
            };
            liveMarketCandleSeries.update({ ...liveMarketLastCandle });
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
            document.title = defaultPageTitle;
            const select = document.getElementById('order-symbol');
            if (!select) return;
            const opt = select.querySelector(`option[value="${tvSymbol}"]`);
            if (!opt) return;
            resetChartMarketStats(opt.textContent);
            if (opt.dataset.source === 'BITGET_PERP') {
                initLiveMarketChart(opt.dataset.pair);
            } else {
                updateTradingViewSymbol(tvSymbol);
            }
            startPricePolling(opt.dataset.pair, opt.dataset.type, opt.dataset.source);
        }

        function resetChartMarketStats(marketLabel) {
            const marketName = document.getElementById('chart-market-name');
            if (marketName) marketName.textContent = marketLabel || 'Selected market';
            for (const id of ['chart-mid-price', 'chart-bid-ask', 'chart-change-24h', 'chart-high-24h', 'chart-low-24h', 'chart-volume-24h']) {
                const element = document.getElementById(id);
                if (element) {
                    element.textContent = '—';
                    element.classList.remove('is-positive', 'is-negative');
                }
            }
        }

        function formatMarketStat(value, style = 'number') {
            const number = Number(value);
            if (!Number.isFinite(number)) return '—';
            if (style === 'currency') {
                return `$${number.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
            }
            if (style === 'compactCurrency') {
                return new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: 'USD',
                    notation: 'compact',
                    maximumFractionDigits: 2
                }).format(number);
            }
            if (style === 'percent') {
                return `${number >= 0 ? '+' : ''}${number.toFixed(2)}%`;
            }
            return number.toLocaleString(undefined, { maximumFractionDigits: 2 });
        }

        function updateMarketTabTitle(price, pair) {
            const baseAsset = String(pair || '').replace(/USDT$/, '');
            if (!Number.isFinite(price) || price <= 0 || !baseAsset) {
                document.title = defaultPageTitle;
                return;
            }
            document.title = `$${price.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            })} | ${baseAsset}`;
        }

        function renderChartMarketStats(ticker) {
            if (!ticker) return;
            const bidPrice = Number(ticker.bidPr ?? ticker.bidPrice);
            const askPrice = Number(ticker.askPr ?? ticker.askPrice);
            const lastPrice = Number(ticker.lastPr ?? ticker.lastPrice ?? ticker.price);
            const midPrice = Number.isFinite(bidPrice) && bidPrice > 0 && Number.isFinite(askPrice) && askPrice > 0
                ? (bidPrice + askPrice) / 2
                : lastPrice;
            const bidAsk = Number.isFinite(bidPrice) && bidPrice > 0 && Number.isFinite(askPrice) && askPrice > 0
                ? `${formatMarketStat(bidPrice, 'currency')} / ${formatMarketStat(askPrice, 'currency')}`
                : '—';
            const changePct = Number(ticker.priceChangePercent ?? (Number(ticker.change24h) * 100));
            const volumeUsd = Number(ticker.usdtVolume ?? ticker.quoteVolume);
            const highPrice = Number(ticker.highPrice ?? ticker.high24h);
            const lowPrice = Number(ticker.lowPrice ?? ticker.low24h);
            const stats = [
                ['chart-mid-price', formatMarketStat(midPrice, 'currency')],
                ['chart-bid-ask', bidAsk],
                ['chart-change-24h', formatMarketStat(changePct, 'percent')],
                ['chart-high-24h', formatMarketStat(highPrice, 'currency')],
                ['chart-low-24h', formatMarketStat(lowPrice, 'currency')],
                ['chart-volume-24h', formatMarketStat(volumeUsd, 'compactCurrency')]
            ];
            stats.forEach(([id, value]) => {
                const element = document.getElementById(id);
                if (element) element.textContent = value;
            });
            const change = document.getElementById('chart-change-24h');
            if (change && Number.isFinite(changePct)) {
                change.classList.toggle('is-positive', changePct > 0);
                change.classList.toggle('is-negative', changePct < 0);
            }
        }

        function startPricePolling(pair, type, source) {
            if (livePriceInterval) clearInterval(livePriceInterval);
            const generation = ++livePriceRequestGeneration;
            fetchPrice(pair, type, source, generation);
            livePriceInterval = setInterval(() => fetchPrice(pair, type, source, generation), 1000);
        }

        async function fetchPrice(pair, type, source, generation) {
            try {
                const endpoint = source === 'BINANCE_SPOT'
                    ? `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(pair)}`
                    : source === 'BITGET_PERP'
                        ? `https://api.bitget.com/api/v2/mix/market/ticker?productType=USDT-FUTURES&symbol=${encodeURIComponent(pair)}`
                        : null;
                if (!endpoint) throw new Error(`Unsupported market price source: ${source}`);
                const res = await fetch(endpoint);
                if (!res.ok) throw new Error(`Market price request failed (${res.status}).`);
                const data = await res.json();
                let price;
                if (source === 'BINANCE_SPOT') {
                    price = Number(data?.lastPrice);
                } else {
                    if (source === 'BITGET_PERP') {
                        if (data?.code !== '00000') throw new Error(`Bitget price request failed (${data?.msg || data?.code}).`);
                        const ticker = data.data?.[0];
                        if (ticker?.symbol !== pair) throw new Error('Bitget returned an unexpected market symbol.');
                        price = Number(ticker.markPrice);
                        if (generation === livePriceRequestGeneration) updateLiveMarketChart(ticker);
                        if (generation === livePriceRequestGeneration) renderChartMarketStats(ticker);
                    } else {
                        price = Number(data?.lastPrice);
                        if (generation === livePriceRequestGeneration) renderChartMarketStats(data);
                    }
                }
                if (!Number.isFinite(price) || price <= 0) throw new Error('Market provider returned an invalid price.');
                if (generation !== livePriceRequestGeneration) return;
                if (source === 'BINANCE_SPOT') renderChartMarketStats(data);
                currentLivePrice = price;
                updateMarketTabTitle(price, pair);

                const priceInput = document.getElementById('order-price');
                if (priceInput && currentLivePrice > 0 && !userHasEditedPrice) {
                    priceInput.value = currentLivePrice;
                    calculateMetrics();
                }
                updateDisplayedOpenTradePnls(currentLivePrice);
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
            if (!dashboardAuthenticated || !walletSessionToken ||
                walletSessionOwner !== connectedWallet?.toLowerCase() ||
                walletSessionExpiresAt <= Date.now()) {
                lockDashboard();
                return;
            }
            const pageId = maintenanceViewPages[viewId];
            if (pageId && maintenanceStatuses[pageId] && !currentWalletIsAdmin) {
                renderMaintenanceView(pageId);
                viewId = 'maintenanceView';
            }
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
                loadAdminTickets();
                loadAdminReviews();
                if (document.getElementById('admin-creators-panel')?.hidden === false) {
                    loadAdminCreatorApplications();
                    loadAdminPromoManagement();
                }
                if (document.getElementById('admin-battlepass-panel')?.hidden === false) loadAdminBattlePass();
                if (document.getElementById('admin-maintenance-panel')?.hidden === false) loadAdminMaintenanceSettings();
            }
            else if (viewId === 'leaderboardView') loadLeaderboard(currentLeaderboardMode);
            else if (viewId === 'accountsView' && connectedWallet) loadUserAccounts(connectedWallet);
            else if (viewId === 'blastrrPassView' && connectedWallet) loadBattlePass();
        }

        async function loadMaintenanceStatus() {
            try {
                const response = await fetch('/api/maintenance/status');
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Unable to load maintenance status.');
                maintenanceStatuses = Object.fromEntries(
                    (data.pages || []).map(page => [page.page_id, Number(page.is_offline) === 1])
                );
                maintenanceMessage = data.outage_message || '';
                updateMaintenanceNavigation();
                const activeView = document.querySelector('.view-panel.active')?.id;
                const activePageId = maintenanceViewPages[activeView];
                if (activePageId && maintenanceStatuses[activePageId] && !currentWalletIsAdmin &&
                    dashboardAuthenticated && activeView !== 'maintenanceView') {
                    switchView(activeView);
                }
            } catch (error) {
                console.error('Unable to load maintenance status:', error);
            }
        }

        function updateMaintenanceNavigation() {
            document.querySelectorAll('[data-maintenance-page]').forEach(link => {
                const offline = maintenanceStatuses[link.dataset.maintenancePage];
                link.hidden = Boolean(offline && !currentWalletIsAdmin);
            });
        }

        function renderMaintenanceView(pageId) {
            const title = document.getElementById('maintenance-view-title');
            const message = document.getElementById('maintenance-view-message');
            if (title) title.textContent = `${maintenancePageLabels[pageId] || 'This service'} is temporarily unavailable`;
            if (message) message.textContent = maintenanceMessage || 'This service is temporarily unavailable while we make updates.';
        }

        function switchAdminSection(panelId) {
            const sections = [
                ['admin-operations-panel', 'admin-operations-tab'],
                ['admin-creators-panel', 'admin-creators-tab'],
                ['admin-battlepass-panel', 'admin-battlepass-tab'],
                ['admin-maintenance-panel', 'admin-maintenance-tab']
            ];
            if (!sections.some(([id]) => id === panelId)) return;
            sections.forEach(([id, tabId]) => {
                const selected = id === panelId;
                const panel = document.getElementById(id);
                const tab = document.getElementById(tabId);
                if (panel) panel.hidden = !selected;
                tab?.classList.toggle('active', selected);
                tab?.setAttribute('aria-selected', String(selected));
            });
            if (panelId === 'admin-creators-panel') {
                loadAdminCreatorApplications();
                loadAdminPromoManagement();
            }
            if (panelId === 'admin-battlepass-panel') loadAdminBattlePass();
            if (panelId === 'admin-maintenance-panel') loadAdminMaintenanceSettings();
        }

        function battlePassLevelForXp(xp) {
            return Math.min(12, Math.floor(Math.max(0, Number(xp) || 0) / 10000));
        }

        function compactBattlePassXp(xp) {
            const value = Math.max(0, Number(xp) || 0);
            return value >= 1000 ? `${Math.floor(value / 1000)}k` : String(value);
        }

        function setBattlePassAvatar(container, imageUrl, username) {
            if (!container) return;
            container.replaceChildren();
            const fallback = document.createElement('span');
            fallback.textContent = (username || 'B').charAt(0).toUpperCase();
            container.append(fallback);
            const defaultImageUrl = '/favicon.png';
            const image = document.createElement('img');
            image.src = imageUrl || defaultImageUrl;
            image.alt = imageUrl ? `${username || 'Trader'} profile` : 'Blastrr';
            image.addEventListener('error', () => {
                if (imageUrl) {
                    imageUrl = '';
                    image.src = defaultImageUrl;
                    image.alt = 'Blastrr';
                    const feedback = document.getElementById('battlepass-profile-feedback');
                    if (feedback) feedback.textContent = 'The saved image could not be loaded. Showing the Blastrr default image instead.';
                } else {
                    image.remove();
                }
            });
            container.append(image);
        }

        function validateBattlePassImageUrl(imageUrl) {
            return new Promise((resolve, reject) => {
                const image = new Image();
                const timeout = setTimeout(() => {
                    image.src = '';
                    reject(new Error('The image took too long to load. Check the direct image URL and try again.'));
                }, 15000);
                image.onload = () => {
                    clearTimeout(timeout);
                    if (image.naturalWidth > 0) resolve();
                    else reject(new Error('That URL did not load a usable image. Use the direct image address, not a Google Images results page.'));
                };
                image.onerror = () => {
                    clearTimeout(timeout);
                    reject(new Error('That URL did not load as an image. Open the image itself and copy its direct image address, not the Google Images page URL.'));
                };
                image.referrerPolicy = 'strict-origin-when-cross-origin';
                image.src = imageUrl;
            });
        }

        async function loadBattlePass() {
            const note = document.getElementById('battlepass-wallet-note');
            if (!connectedWallet) {
                if (note) note.textContent = 'Connect your wallet to view your XP, points, tasks, and level rewards.';
                return;
            }
            if (note) note.textContent = 'Loading your BlastrrPass...';
            try {
                const response = await walletFetch(`/api/battlepass?wallet=${encodeURIComponent(connectedWallet)}`);
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Unable to load your BlastrrPass.');
                battlePassProfile = data.profile;
                battlePassTasks = data.tasks || [];
                battlePassLevels = data.levels || [];
                if (note) note.textContent = '';
                renderBattlePass();
            } catch (error) {
                console.error(error);
                if (note) note.textContent = error.message || 'Unable to load your BlastrrPass.';
            }
        }

        function renderBattlePass() {
            if (!battlePassProfile) return;
            const profileCard = document.getElementById('battlepass-profile-card');
            const profileForm = document.getElementById('battlepass-profile-form');
            const username = battlePassProfile.username || connectedWallet || 'Trader';
            const shareButton = document.getElementById('battlepass-share');
            const xp = Number(battlePassProfile.xp || 0);
            const points = Number(battlePassProfile.points || 0);
            const level = Number(battlePassProfile.level ?? battlePassLevelForXp(xp));
            const rank = level ? `Level ${level}` : 'Unranked';
            if (profileCard) profileCard.hidden = false;
            if (profileForm) profileForm.hidden = false;
            if (shareButton) {
                shareButton.disabled = !battlePassProfile.username;
                shareButton.title = battlePassProfile.username ? '' : 'Set up a profile username before sharing.';
            }
            document.getElementById('battlepass-username').textContent = `@${username}`;
            document.getElementById('battlepass-rank').textContent = rank;
            document.getElementById('battlepass-xp').textContent = xp.toLocaleString();
            document.getElementById('battlepass-points').textContent = points.toLocaleString();
            const progressLabel = document.getElementById('battlepass-progress-label');
            const withinLevel = Math.min(10000, Math.max(0, xp - level * 10000));
            if (progressLabel) {
                progressLabel.textContent = level >= 12
                    ? `${xp.toLocaleString()} XP · max level`
                    : `${withinLevel.toLocaleString()} / 10,000 XP to Level ${level + 1}`;
            }
            const segments = document.getElementById('battlepass-level-segments');
            if (segments) {
                segments.innerHTML = Array.from({ length: 12 }, (_, index) => {
                    const earnedFraction = index < level ? 1 : index === level && level < 12 ? withinLevel / 10000 : 0;
                    return `<span class="battlepass-level-segment"><i style="width:${earnedFraction * 100}%"></i></span>`;
                }).join('');
                segments.setAttribute('aria-label', `${level} levels completed, ${withinLevel.toLocaleString()} of 10,000 XP toward the next level`);
            }
            const imageInput = document.getElementById('battlepass-profile-image');
            if (imageInput && document.activeElement !== imageInput) imageInput.value = battlePassProfile.profile_image_url || '';
            setBattlePassAvatar(document.getElementById('battlepass-avatar-wrap'), battlePassProfile.profile_image_url, username);
            setBattlePassAvatar(document.getElementById('profile-battlepass-avatar'), battlePassProfile.profile_image_url, username);
            renderBattlePassTasks();
            renderBattlePassLevels();
            selectBattlePassTab(battlePassActiveTab);
        }

        function renderBattlePassTasks() {
            const groups = {
                DAILY: document.getElementById('battlepass-daily-tasks'),
                WEEKLY: document.getElementById('battlepass-weekly-tasks'),
                MONTHLY: document.getElementById('battlepass-monthly-tasks')
            };
            Object.values(groups).forEach(container => { if (container) container.replaceChildren(); });
            for (const [cadence, container] of Object.entries(groups)) {
                if (!container) continue;
                const tasks = battlePassTasks.filter(task => task.cadence === cadence);
                const count = document.getElementById(`battlepass-${cadence.toLowerCase()}-count`);
                const steps = document.getElementById(`battlepass-${cadence.toLowerCase()}-progress`);
                if (count) {
                    const done = tasks.filter(task => task.claimed).length;
                    count.textContent = `${done} of ${tasks.length} done`;
                    if (steps) {
                        const segmentCount = Math.max(5, Math.min(10, tasks.length));
                        steps.innerHTML = Array.from({ length: segmentCount }, (_, index) =>
                            `<span class="${index < done ? 'is-complete' : ''}"></span>`
                        ).join('');
                    }
                }
                if (!tasks.length) {
                    container.innerHTML = '<p class="account-chart-empty">No tasks in this period yet.</p>';
                    continue;
                }
                container.innerHTML = tasks.map(task => {
                    const url = typeof task.action_url === 'string' ? task.action_url : '';
                    const safeUrl = escapeHTML(url);
                    let xPostUrl = '';
                    try {
                        const parsedUrl = new URL(url);
                        if (['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(parsedUrl.hostname.toLowerCase()) &&
                            /^\/[^/]+\/status\/\d+/.test(parsedUrl.pathname)) xPostUrl = safeUrl;
                    } catch { /* Invalid action links are not rendered. */ }
                    const action = task.task_type === 'SOCIAL_CLICK' && url
                        ? `<a class="battlepass-task-action" href="${safeUrl}" target="_blank" rel="noopener noreferrer" data-task-link="${Number(task.id)}">${task.claimed ? 'Open task again' : 'Open task &amp; earn reward'}</a>`
                        : '';
                    const state = task.claimed ? 'Earned this period' : task.eligible ? 'Reward ready to claim' : 'Complete the activity to unlock';
                    const claimButton = task.task_type !== 'SOCIAL_CLICK' && !task.claimed
                        ? `<button class="btn-wallet" type="button" data-task-claim="${Number(task.id)}" ${task.eligible ? '' : 'disabled'}>${task.eligible ? 'Claim reward' : 'Not ready'}</button>`
                        : '';
                    const embed = xPostUrl
                        ? `<details class="battlepass-x-preview"><summary>Preview X post</summary><blockquote class="twitter-tweet"><a href="${xPostUrl}" target="_blank" rel="noopener noreferrer">View post on X</a></blockquote></details>`
                        : '';
                    return `<article class="battlepass-task" data-battlepass-task="${Number(task.id)}">
                        <div class="battlepass-task-copy"><div class="battlepass-task-heading"><strong>${escapeHTML(task.title)}</strong>
                        <span class="battlepass-task-awards"><span><i class="battlepass-gem" aria-hidden="true">◆</i> +${Number(task.points_reward)}</span><span class="battlepass-award-divider"></span><span><i class="battlepass-xp-mark" aria-hidden="true">XP</i> +${Number(task.xp_reward).toLocaleString()}</span></span></div>
                        <p>${escapeHTML(task.description)}</p><div class="battlepass-task-action-row"><span class="battlepass-task-status ${task.claimed ? 'is-claimed' : task.eligible ? 'is-ready' : ''}">${state}</span>${embed}${action}${claimButton}</div></div></article>`;
                }).join('');
                container.onclick = event => {
                    const button = event.target.closest('[data-task-claim]');
                    const link = event.target.closest('[data-task-link]');
                    if (button && !button.disabled) claimBattlePassTask(button.dataset.taskClaim, button);
                    if (link && !link.closest('[data-battlepass-task]')?.querySelector('.battlepass-task-status.is-claimed')) {
                        claimBattlePassTask(link.dataset.taskLink);
                    }
                };
            }
            if (battlePassTasks.some(task => task.task_type === 'SOCIAL_CLICK' && /(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/i.test(task.action_url || ''))) {
                const embedScriptId = 'battlepass-x-embed-script';
                if (window.twttr?.widgets?.load) {
                    window.twttr.widgets.load(document.getElementById('battlepass-user-content'));
                } else if (!document.getElementById(embedScriptId)) {
                    const script = document.createElement('script');
                    script.id = embedScriptId;
                    script.async = true;
                    script.src = 'https://platform.twitter.com/widgets.js';
                    script.addEventListener('load', () => window.twttr?.widgets?.load?.(document.getElementById('battlepass-user-content')), { once: true });
                    document.head.append(script);
                }
            }
        }

        function renderBattlePassLevels() {
            const container = document.getElementById('battlepass-level-list');
            if (!container) return;
            const xpTotal = document.getElementById('battlepass-xp');
            if (xpTotal) xpTotal.textContent = Number(battlePassProfile?.xp || 0).toLocaleString();
            const readyLevels = battlePassLevels.filter(level =>
                level.unlocked && !level.reward_code && Number(battlePassProfile?.points || 0) >= Number(level.points_cost)
            );
            const readyTitle = document.getElementById('battlepass-ready-title');
            const readySummary = document.getElementById('battlepass-ready-summary');
            const claimAll = document.getElementById('battlepass-claim-all');
            if (readyTitle) readyTitle.textContent = readyLevels.length
                ? `${readyLevels.length} reward${readyLevels.length === 1 ? '' : 's'} ready to claim`
                : 'No rewards ready to claim';
            if (readySummary) readySummary.textContent = readyLevels.length
                ? `${readyLevels.reduce((sum, level) => sum + Number(level.points_cost), 0).toLocaleString()} points will claim these level discounts.`
                : 'Complete missions and purchases to earn XP and points.';
            if (claimAll) {
                claimAll.disabled = !readyLevels.length;
                claimAll.textContent = readyLevels.length ? `Claim all (${readyLevels.length})` : 'Claim all';
                claimAll.dataset.claimLevels = JSON.stringify(readyLevels.map(level => Number(level.level)));
            }
            container.innerHTML = battlePassLevels.map(level => {
                const unlocked = Boolean(level.unlocked);
                const code = level.reward_code;
                const button = code
                    ? `<button class="battlepass-task-action" type="button" data-use-reward="${escapeHTML(code)}" ${level.reward_redeemed ? 'disabled' : ''}>${level.reward_redeemed ? 'Used' : 'Use discount'}</button>`
                    : `<button class="battlepass-task-action" type="button" data-claim-level="${Number(level.level)}" ${unlocked ? '' : 'disabled'}>${unlocked ? 'Claim reward' : 'Locked'}</button>`;
                const status = code
                    ? level.reward_redeemed ? 'Discount used' : 'Discount claimed · ready to use'
                    : unlocked ? 'Reward unlocked · ready to claim' : `Unlock at ${Number(level.xp_required).toLocaleString()} XP`;
                return `<article class="battlepass-task battlepass-reward-item">
                    <div class="battlepass-task-copy">
                        <div class="battlepass-task-heading">
                            <strong>Level ${Number(level.level)} · +${Number(level.discount_bonus_pct)}% discount</strong>
                            <span class="battlepass-task-awards"><span><i class="battlepass-gem" aria-hidden="true">◆</i> ${Number(level.points_cost)} points</span><span class="battlepass-award-divider"></span><span><i class="battlepass-xp-mark" aria-hidden="true">XP</i> ${Number(level.xp_required).toLocaleString()}</span></span>
                        </div>
                        <div class="battlepass-task-action-row"><span class="battlepass-task-status ${code ? 'is-claimed' : unlocked ? 'is-ready' : ''}">${status}</span>${code ? `<code class="battlepass-reward-code">${escapeHTML(code)}</code>` : ''}${button}</div>
                    </div>
                </article>`;
            }).join('');
            container.onclick = event => {
                const claimButton = event.target.closest('[data-claim-level]');
                const useButton = event.target.closest('[data-use-reward]');
                if (claimButton && !claimButton.disabled) claimBattlePassLevel(claimButton.dataset.claimLevel);
                if (useButton && !useButton.disabled) usePromoCode(useButton.dataset.useReward);
            };
        }

        function selectBattlePassTab(tabName) {
            const validTabs = ['missions', 'rewards', 'leaderboard', 'profile'];
            if (!validTabs.includes(tabName)) return;
            battlePassActiveTab = tabName;
            document.querySelectorAll('#battlepass-user-content [data-battlepass-tab]').forEach(button => {
                const selected = button.dataset.battlepassTab === tabName;
                button.classList.toggle('active', selected);
                button.setAttribute('aria-selected', String(selected));
            });
            document.querySelectorAll('#battlepass-user-content [data-battlepass-panel]').forEach(panel => {
                const selected = panel.dataset.battlepassPanel === tabName;
                panel.hidden = !selected;
                panel.classList.toggle('active', selected);
            });
        }

        async function claimAllBattlePassRewards(button) {
            const levels = JSON.parse(button?.dataset.claimLevels || '[]');
            if (!levels.length) return;
            button.disabled = true;
            const feedback = document.getElementById('battlepass-reward-feedback');
            if (feedback) feedback.textContent = '';
            try {
                for (const level of levels) {
                    const response = await walletFetch('/api/battlepass/rewards/claim', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ level })
                    });
                    const data = await response.json();
                    if (!response.ok) throw new Error(data.error || `Unable to claim level ${level}.`);
                }
                if (feedback) feedback.textContent = `${levels.length} level reward${levels.length === 1 ? '' : 's'} claimed. Use the codes below at checkout.`;
                battlePassActiveTab = 'rewards';
                await loadBattlePass();
            } catch (error) {
                console.error(error);
                if (feedback) feedback.textContent = error.message;
                await loadBattlePass();
            } finally {
                button.disabled = false;
            }
        }

        async function claimBattlePassTask(taskId, button) {
            if (!connectedWallet) return;
            if (button) button.disabled = true;
            try {
                const response = await walletFetch('/api/battlepass/tasks/claim', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ task_id: Number(taskId) })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Unable to claim this task reward.');
                await loadBattlePass();
            } catch (error) {
                console.error(error);
                const note = document.getElementById('battlepass-wallet-note');
                if (note) note.textContent = error.message;
                if (button) button.disabled = false;
            }
        }

        async function claimBattlePassLevel(level) {
            const feedback = document.getElementById('battlepass-reward-feedback');
            if (feedback) feedback.textContent = '';
            try {
                const response = await walletFetch('/api/battlepass/rewards/claim', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ level: Number(level) })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Unable to claim this level reward.');
                if (feedback) feedback.textContent = `Reward claimed. Use code ${data.code} at checkout for an additional discount.`;
                await loadBattlePass();
            } catch (error) {
                console.error(error);
                if (feedback) feedback.textContent = error.message;
            }
        }

        async function loadPublicBattlePassProfile(username) {
            const container = document.getElementById('battlepass-shared-profile');
            if (!container) return;
            container.hidden = false;
            container.textContent = 'Loading BlastrrPass profile...';
            try {
                const response = await fetch(`/api/battlepass/profile?username=${encodeURIComponent(username)}`);
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Unable to load this public profile.');
                const profile = data.profile;
                const level = Number(profile.level || 0);
                const xp = Number(profile.xp || 0);
                const shareUrl = new URL(window.location.href);
                shareUrl.searchParams.set('passprofile', profile.username);
                container.innerHTML = `<div class="card-title">BlastrrPass profile</div>
                    <div class="battlepass-profile-card">
                        <div id="battlepass-public-avatar" class="battlepass-avatar-wrap"></div>
                        <div class="battlepass-profile-details"><strong>@${escapeHTML(profile.username)}</strong>
                        <span>${level ? `Level ${level}` : 'Unranked'}</span><span>${xp.toLocaleString()} XP (${compactBattlePassXp(xp)})</span></div>
                        <button class="btn-share-x" type="button" id="battlepass-public-share">Share profile on X</button>
                    </div>`;
                setBattlePassAvatar(document.getElementById('battlepass-public-avatar'), profile.profile_image_url, profile.username);
                document.getElementById('battlepass-public-share')?.addEventListener('click', () => {
                    const text = `I'm Level ${level} in BlastrrPass with ${xp.toLocaleString()} XP!`;
                    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl.toString())}`, '_blank', 'noopener,noreferrer');
                });
            } catch (error) {
                console.error(error);
                container.textContent = error.message;
            }
        }

        function shareBattlePassProfile() {
            if (!battlePassProfile?.username) return;
            const url = new URL(window.location.href);
            url.search = '';
            url.searchParams.set('passprofile', battlePassProfile.username);
            const level = battlePassLevelForXp(battlePassProfile.xp);
            const xp = Number(battlePassProfile.xp || 0);
            const text = `I'm ${level ? `Level ${level}` : 'starting out'} in BlastrrPass with ${xp.toLocaleString()} XP (${compactBattlePassXp(xp)})!`;
            window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url.toString())}`, '_blank', 'noopener,noreferrer');
        }

        async function saveBattlePassProfileImage(event) {
            event.preventDefault();
            const feedback = document.getElementById('battlepass-profile-feedback');
            const imageUrl = document.getElementById('battlepass-profile-image')?.value.trim() || '';
            if (feedback) feedback.textContent = '';
            try {
                if (imageUrl) await validateBattlePassImageUrl(imageUrl);
                const response = await walletFetch('/api/battlepass/profile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ profile_image_url: imageUrl })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Unable to save the profile image.');
                battlePassProfile.profile_image_url = data.profile_image_url;
                if (feedback) feedback.textContent = 'Profile image saved.';
                renderBattlePass();
            } catch (error) {
                console.error(error);
                if (feedback) feedback.textContent = error.message;
            }
        }

        async function loadAdminBattlePass() {
            const levels = document.getElementById('admin-battlepass-level-rewards');
            if (!levels) return;
            levels.innerHTML = '<p class="account-chart-empty">Loading BlastrrPass settings...</p>';
            try {
                const authorization = await signedTradeAuthorization();
                const response = await fetch('/api/admin/battlepass/load', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(authorization)
                });
                const data = await readAdminApiResponse(response, '/api/admin/battlepass/load');
                if (!response.ok) throw new Error(data.error || 'Unable to load BlastrrPass settings.');
                document.getElementById('admin-standard-discount').value = data.settings.standard_discount_pct;
                renderAdminBattlePassPlans(data.plans || []);
                renderAdminBattlePassLevels(data.levels || []);
                renderAdminBattlePassTasks(data.tasks || []);
            } catch (error) {
                console.error(error);
                levels.innerHTML = `<p class="support-feedback">${escapeHTML(error.message)}</p>`;
            }
        }

        function renderAdminBattlePassPlans(plans) {
            const container = document.getElementById('admin-battlepass-plan-rewards');
            if (!container) return;
            container.innerHTML = plans.length ? plans.map(plan => `<article class="battlepass-admin-row" data-plan-id="${Number(plan.plan_id)}">
                <strong>${escapeHTML(plan.name)} · $${Number(plan.simulated_capital).toLocaleString()}</strong>
                <label>XP <input type="number" min="0" step="1" value="${Number(plan.xp_reward)}" data-plan-xp></label>
                <label>Points <input type="number" min="0" step="1" value="${Number(plan.points_reward)}" data-plan-points></label>
                <button class="btn-wallet" type="button" data-save-plan-reward>Save</button>
            </article>`).join('') : '<p class="account-chart-empty">No active plans.</p>';
            container.onclick = event => {
                const button = event.target.closest('[data-save-plan-reward]');
                const row = button?.closest('[data-plan-id]');
                if (!row) return;
                saveAdminBattlePass('/api/admin/battlepass/plan-rewards/save', {
                    plan_id: Number(row.dataset.planId),
                    xp_reward: Number(row.querySelector('[data-plan-xp]').value),
                    points_reward: Number(row.querySelector('[data-plan-points]').value)
                }, button);
            };
        }

        function renderAdminBattlePassLevels(levels) {
            const container = document.getElementById('admin-battlepass-level-rewards');
            if (!container) return;
            container.innerHTML = levels.map(level => `<article class="battlepass-admin-row" data-level="${Number(level.level)}">
                <strong>Level ${Number(level.level)} · ${Number(level.xp_required).toLocaleString()} XP</strong>
                <label>Extra discount (%) <input type="number" min="0" max="100" step="0.01" value="${Number(level.discount_bonus_pct)}" data-level-discount></label>
                <label>Points cost <input type="number" min="0" step="1" value="${Number(level.points_cost)}" data-level-points></label>
                <button class="btn-wallet" type="button" data-save-level-reward>Save</button>
            </article>`).join('');
            container.onclick = event => {
                const button = event.target.closest('[data-save-level-reward]');
                const row = button?.closest('[data-level]');
                if (!row) return;
                saveAdminBattlePass('/api/admin/battlepass/levels/save', {
                    level: Number(row.dataset.level),
                    discount_bonus_pct: Number(row.querySelector('[data-level-discount]').value),
                    points_cost: Number(row.querySelector('[data-level-points]').value)
                }, button);
            };
        }

        function renderAdminBattlePassTasks(tasks) {
            adminBattlePassTasks = tasks;
            const builtIn = document.getElementById('admin-battlepass-built-in-tasks');
            const custom = document.getElementById('admin-battlepass-custom-tasks');
            const builtIns = tasks.filter(task => Number(task.is_builtin) === 1);
            const customTasks = tasks.filter(task => Number(task.is_builtin) !== 1);
            if (builtIn) {
                builtIn.innerHTML = builtIns.map(task => `<article class="battlepass-admin-row" data-task-id="${Number(task.id)}">
                    <strong>${escapeHTML(task.title)}</strong><label>XP <input type="number" min="0" step="1" value="${Number(task.xp_reward)}" data-task-xp></label>
                    <label>Points <input type="number" min="0" step="1" value="${Number(task.points_reward)}" data-task-points></label>
                    <button class="btn-wallet" type="button" data-save-built-in-task>Save</button>
                </article>`).join('');
                builtIn.onclick = event => {
                    const button = event.target.closest('[data-save-built-in-task]');
                    const row = button?.closest('[data-task-id]');
                    if (row) saveAdminBattlePass('/api/admin/battlepass/tasks/rewards', {
                        task_id: Number(row.dataset.taskId),
                        xp_reward: Number(row.querySelector('[data-task-xp]').value),
                        points_reward: Number(row.querySelector('[data-task-points]').value)
                    }, button);
                };
            }
            if (!custom) return;
            custom.innerHTML = customTasks.length ? customTasks.map(task => `<article class="battlepass-admin-task" data-task-id="${Number(task.id)}">
                <div class="battlepass-admin-task-fields">
                    <label>Title <input type="text" maxlength="100" value="${escapeHTML(task.title)}" data-custom-title></label>
                    <label>Description <input type="text" maxlength="500" value="${escapeHTML(task.description)}" data-custom-description></label>
                    <label>Type <select data-custom-type><option value="SOCIAL_CLICK" ${task.task_type === 'SOCIAL_CLICK' ? 'selected' : ''}>Social action</option><option value="WITHDRAWAL" ${task.task_type === 'WITHDRAWAL' ? 'selected' : ''}>Paid withdrawal</option></select></label>
                    <label>Period <select data-custom-cadence>${['DAILY', 'WEEKLY', 'MONTHLY'].map(cadence => `<option value="${cadence}" ${task.cadence === cadence ? 'selected' : ''}>${cadence.toLowerCase()}</option>`).join('')}</select></label>
                    <label>Action URL <input type="url" maxlength="2048" value="${escapeHTML(task.action_url)}" data-custom-url></label>
                    <label>XP <input type="number" min="0" step="1" value="${Number(task.xp_reward)}" data-custom-xp></label>
                    <label>Points <input type="number" min="0" step="1" value="${Number(task.points_reward)}" data-custom-points></label>
                </div>
                <label class="battlepass-active-toggle"><input type="checkbox" data-custom-active ${task.active ? 'checked' : ''}> Active</label>
                <button class="btn-wallet" type="button" data-save-custom-task>Save task</button>
            </article>`).join('') : '<p class="account-chart-empty">No custom tasks yet.</p>';
            custom.onclick = event => {
                const button = event.target.closest('[data-save-custom-task]');
                const row = button?.closest('[data-task-id]');
                if (!row) return;
                saveAdminBattlePass('/api/admin/battlepass/tasks/save', {
                    task_id: Number(row.dataset.taskId),
                    title: row.querySelector('[data-custom-title]').value,
                    description: row.querySelector('[data-custom-description]').value,
                    task_type: row.querySelector('[data-custom-type]').value,
                    cadence: row.querySelector('[data-custom-cadence]').value,
                    action_url: row.querySelector('[data-custom-url]').value,
                    xp_reward: Number(row.querySelector('[data-custom-xp]').value),
                    points_reward: Number(row.querySelector('[data-custom-points]').value),
                    active: row.querySelector('[data-custom-active]').checked
                }, button);
            };
        }

        async function saveAdminBattlePass(endpoint, values, button) {
            if (button) button.disabled = true;
            try {
                const authorization = await signedTradeAuthorization();
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...authorization, ...values })
                });
                const data = await readAdminApiResponse(response, endpoint);
                if (!response.ok) throw new Error(data.error || 'Unable to save BlastrrPass settings.');
                if (endpoint === '/api/admin/battlepass/settings') {
                    standardDiscountPct = Number(data.standard_discount_pct);
                    renderPlans();
                }
                if (endpoint === '/api/admin/battlepass/tasks/rewards') {
                    const task = adminBattlePassTasks.find(item => Number(item.id) === Number(values.task_id));
                    if (task) {
                        task.xp_reward = values.xp_reward;
                        task.points_reward = values.points_reward;
                    }
                    renderAdminBattlePassTasks(adminBattlePassTasks);
                } else if (endpoint === '/api/admin/battlepass/tasks/save') {
                    const savedTask = { ...values, id: data.task_id, active: values.active === false ? 0 : 1 };
                    const existingIndex = adminBattlePassTasks.findIndex(task => Number(task.id) === Number(data.task_id));
                    if (existingIndex < 0) adminBattlePassTasks.push(savedTask);
                    else adminBattlePassTasks[existingIndex] = savedTask;
                    renderAdminBattlePassTasks(adminBattlePassTasks);
                }
                const feedback = document.getElementById(endpoint.includes('/tasks/')
                    ? 'admin-battlepass-task-feedback'
                    : 'admin-battlepass-settings-feedback');
                if (feedback) feedback.textContent = 'BlastrrPass settings saved.';
                return true;
            } catch (error) {
                console.error(error);
                const feedback = document.getElementById(endpoint.includes('/tasks/')
                    ? 'admin-battlepass-task-feedback'
                    : 'admin-battlepass-settings-feedback');
                if (feedback) feedback.textContent = error.message;
                return false;
            } finally {
                if (button) button.disabled = false;
            }
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
            const container = document.getElementById('leaderboard-table-body');
            if (!container) return;
            container.replaceChildren();
            const myRankLabel = document.getElementById('lb-my-rank-label');
            if (myRankLabel) myRankLabel.style.display = 'none';

            if (!dataRows || dataRows.length === 0) {
                container.innerHTML = '<p class="workspace-empty-state">No records available for this leaderboard mode.</p>';
                return;
            }

            let userFoundRank = null;

            dataRows.forEach((row, index) => {
                const isUser = currentUserProfile && row.wallet_address && row.wallet_address.toLowerCase() === currentUserProfile.wallet_address.toLowerCase();
                if (isUser) userFoundRank = index + 1;

                const metricColor = row.metric_value >= 0 ? '#34d399' : '#ef4444';
                const battlePassXp = Number(row.battlepass_xp || 0);
                const battlePassLevel = Math.min(12, Math.floor(battlePassXp / 10000));
                const battlePassRank = battlePassLevel ? `Level ${battlePassLevel}` : 'Unranked';
                const compactXp = battlePassXp >= 1000 ? `${Math.floor(battlePassXp / 1000)}k` : String(battlePassXp);
                const rankDisplay = `#${index + 1}`;
                const badgeText = currentLeaderboardMode === 'PAYOUTS' ? 'PAID' : 'PnL';

                container.insertAdjacentHTML('beforeend', `
                    <article class="battlepass-task leaderboard-card${isUser ? ' is-current-user' : ''}">
                        <div class="leaderboard-card-top">
                            <div class="leaderboard-trader">
                                <span class="leaderboard-position${index < 3 ? ' is-top-three' : ''}">${rankDisplay}</span>
                                <div class="battlepass-avatar-wrap leaderboard-avatar" aria-hidden="true"></div>
                                <div class="leaderboard-identity">
                                    <strong>@${escapeHTML(row.username)}</strong>
                                    ${isUser ? '<small class="leaderboard-you">Your profile</small>' : ''}
                                </div>
                            </div>
                            <div class="leaderboard-metric">
                                <strong style="color: ${metricColor}">$${Number(row.metric_value).toFixed(2)} USDT</strong>
                                <small>${badgeText}</small>
                            </div>
                        </div>
                        <div class="leaderboard-card-stats">
                            <div><small>Promo code</small><code>${escapeHTML(row.discount_code)}</code></div>
                            <div><small>Battle Pass rank</small><span class="battlepass-rank-badge">${battlePassRank}</span></div>
                            <div><small>XP earned</small><strong>${compactXp}</strong></div>
                        </div>
                        <div class="leaderboard-card-actions">
                            <button class="battlepass-task-action" type="button" data-leaderboard-promo="${escapeHTML(row.discount_code)}">Use code</button>
                            ${isUser ? `<button class="battlepass-task-action" type="button" data-share-rank="${index + 1}" data-share-username="${escapeHTML(row.username)}" data-share-metric="${Number(row.metric_value)}">Share rank on X</button>` : ''}
                        </div>
                    </article>
                `);
                setBattlePassAvatar(container.lastElementChild?.querySelector('.leaderboard-avatar'), row.profile_image_url, row.username);
            });

            if (userFoundRank && myRankLabel) {
                myRankLabel.innerText = `Your Rank: #${userFoundRank}`;
                myRankLabel.style.display = 'inline-block';
            }
            container.onclick = event => {
                const promoButton = event.target.closest('[data-leaderboard-promo]');
                if (promoButton) {
                    usePromoCode(promoButton.dataset.leaderboardPromo);
                    return;
                }
                const shareButton = event.target.closest('[data-share-rank]');
                if (shareButton) {
                    shareRankOnX(
                        Number(shareButton.dataset.shareRank),
                        shareButton.dataset.shareUsername,
                        Number(shareButton.dataset.shareMetric)
                    );
                }
            };
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
            const text = `I'm ranked #${rank} on @BlastrrProp for ${modeText} with $${metricValue.toFixed(2)} USDT! 🚀\n\nTrade live crypto prop accounts with ${standardDiscountPct}% off using my referral code: ${currentUserProfile?.discount_code || 'BLASTRR'}\n\nhttps://blastrr.com/?ref=${currentUserProfile?.discount_code || ''}`;
            window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank');
        }

        function shareTradeOnX(tradeId, symbol, side, pnl, entryPrice) {
            const emoji = pnl >= 0 ? '🟢' : '🔴';
            const text = `${emoji} Just closed a ${side} trade on ${symbol} via @BlastrrProp!\nEntry: $${entryPrice.toFixed(2)} | Realized PnL: $${pnl.toFixed(2)} USDT 📈\n\nTrade direct-to-live crypto prop accounts on Blastrr: https://blastrr.com`;
            window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank');
        }

        function shareCreatorCodeOnX() {
            if (!currentUserProfile) return;
            const text = `Get ${standardDiscountPct}% OFF your @BlastrrProp evaluation trading accounts using my referral code: ${currentUserProfile.discount_code} 🔥\n\nDirect-to-live crypto prop trading terminal with instant executions:\nhttps://blastrr.com/?ref=${currentUserProfile.discount_code}`;
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

        function setWalletLoginStatus(message, signing = false) {
            const button = document.getElementById('wallet-login-button');
            const status = document.getElementById('wallet-login-status');
            if (button) {
                button.disabled = signing;
                button.textContent = signing ? 'Waiting for wallet signature...' : 'Connect wallet & sign in';
            }
            if (status) status.textContent = message || '';
        }

        function lockDashboard(message = 'Sign a message with your wallet to unlock your trading dashboard.') {
            dashboardAuthenticated = false;
            resolvePurchaseDisclaimer(false);
            document.body.classList.add('auth-locked');
            const header = document.querySelector('body > header');
            const main = document.querySelector('main');
            const gate = document.getElementById('wallet-login-gate');
            const disclaimerGate = document.getElementById('disclaimer-gate');
            if (header) header.hidden = true;
            if (main) main.hidden = true;
            if (gate) gate.hidden = false;
            if (disclaimerGate) disclaimerGate.hidden = true;
            setWalletLoginStatus(message);
        }

        function showDisclaimerGate(mode = 'login') {
            disclaimerGateMode = mode;
            if (mode === 'login') {
                dashboardAuthenticated = false;
                document.body.classList.add('auth-locked');
            }
            const header = document.querySelector('body > header');
            const main = document.querySelector('main');
            const loginGate = document.getElementById('wallet-login-gate');
            const disclaimerGate = document.getElementById('disclaimer-gate');
            const scrollArea = document.getElementById('disclaimer-scroll-area');
            if (header) header.hidden = true;
            if (main) main.hidden = true;
            if (loginGate) loginGate.hidden = true;
            if (disclaimerGate) disclaimerGate.hidden = false;
            if (scrollArea) scrollArea.scrollTop = 0;
            ['disclaimer-accept-terms', 'disclaimer-simulated-funds'].forEach(id => {
                const checkbox = document.getElementById(id);
                if (checkbox) {
                    checkbox.checked = false;
                    checkbox.disabled = true;
                }
            });
            const remember = document.getElementById('disclaimer-remember');
            if (remember) remember.checked = true;
            const rememberLabel = document.querySelector('.disclaimer-remember');
            if (rememberLabel) rememberLabel.hidden = mode === 'purchase';
            const cancelButton = document.getElementById('disclaimer-cancel-purchase');
            if (cancelButton) cancelButton.hidden = mode !== 'purchase';
            const title = document.getElementById('disclaimer-title');
            if (title) title.textContent = mode === 'purchase' ? 'Review Terms Before Purchase' : 'Important Disclaimers & Terms';
            const copy = document.querySelector('.disclaimer-header .wallet-login-copy');
            if (copy) copy.textContent = mode === 'purchase'
                ? 'Review the terms for this purchase. You must reach the end and confirm both acknowledgements each time you buy.'
                : 'Read to the end and confirm both acknowledgements to unlock your dashboard.';
            const continueButton = document.getElementById('disclaimer-continue-button');
            if (continueButton) continueButton.textContent = mode === 'purchase' ? 'Agree and continue to checkout' : 'Agree and continue';
            const hint = document.getElementById('disclaimer-scroll-hint');
            if (hint) hint.textContent = 'Scroll to the end of the terms to enable the acknowledgements.';
            const feedback = document.getElementById('disclaimer-feedback');
            if (feedback) feedback.textContent = '';
            updateDisclaimerScrollState();
            updateDisclaimerContinueState();
        }

        function updateDisclaimerScrollState() {
            const scrollArea = document.getElementById('disclaimer-scroll-area');
            if (!scrollArea) return;
            const reachedEnd = scrollArea.scrollTop + scrollArea.clientHeight >= scrollArea.scrollHeight - 4;
            if (!reachedEnd) return;
            ['disclaimer-accept-terms', 'disclaimer-simulated-funds'].forEach(id => {
                const checkbox = document.getElementById(id);
                if (checkbox) checkbox.disabled = false;
            });
            const hint = document.getElementById('disclaimer-scroll-hint');
            if (hint) hint.textContent = 'You have reached the end. Confirm both acknowledgements to continue.';
        }

        function updateDisclaimerContinueState() {
            const reachedEnd = document.getElementById('disclaimer-accept-terms')?.disabled === false &&
                document.getElementById('disclaimer-simulated-funds')?.disabled === false;
            const acceptedTerms = document.getElementById('disclaimer-accept-terms')?.checked === true;
            const acknowledgedSimulation = document.getElementById('disclaimer-simulated-funds')?.checked === true;
            const button = document.getElementById('disclaimer-continue-button');
            if (button) button.disabled = !(reachedEnd && acceptedTerms && acknowledgedSimulation);
        }

        async function acceptDisclaimer() {
            const button = document.getElementById('disclaimer-continue-button');
            const feedback = document.getElementById('disclaimer-feedback');
            const owner = connectedWallet?.toLowerCase();
            if (!owner || !button || button.disabled) return;
            button.disabled = true;
            if (feedback) feedback.textContent = 'Saving your selection...';
            try {
                if (disclaimerGateMode === 'purchase') {
                    if (connectedWallet?.toLowerCase() !== owner) return;
                    resolvePurchaseDisclaimer(true);
                    return;
                }
                if (document.getElementById('disclaimer-remember')?.checked) {
                    const response = await walletFetch('/api/user/disclaimer-consent', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            version: DISCLAIMER_VERSION,
                            accepted_terms: true,
                            simulated_funds: true
                        })
                    });
                    const data = await response.json();
                    if (!response.ok) throw new Error(data.error || 'Unable to remember your selection.');
                }
                if (connectedWallet?.toLowerCase() !== owner) return;
                await continueAfterDisclaimer();
            } catch (error) {
                console.error('Disclaimer acceptance failed:', error);
                if (feedback) feedback.textContent = error.message || 'Unable to save your selection. Please try again.';
                updateDisclaimerContinueState();
            }
        }

        async function continueAfterDisclaimer() {
            disclaimerGateMode = 'login';
            unlockDashboard();
            setWalletLoginStatus('');
            await initializeDashboard();
            checkRole(connectedWallet);
            const accountsLoaded = await loadUserAccounts(connectedWallet);
            loadUserProfile(connectedWallet);
            loadUserTickets(connectedWallet);
            loadBattlePass();
            if (accountsLoaded && userAccounts.length === 0) switchView('buyView');
        }

        function unlockDashboard() {
            dashboardAuthenticated = true;
            document.body.classList.remove('auth-locked');
            const header = document.querySelector('body > header');
            const main = document.querySelector('main');
            const gate = document.getElementById('wallet-login-gate');
            const disclaimerGate = document.getElementById('disclaimer-gate');
            if (header) header.hidden = false;
            if (main) main.hidden = false;
            if (gate) gate.hidden = true;
            if (disclaimerGate) disclaimerGate.hidden = true;
        }

        function requestPurchaseDisclaimer() {
            return new Promise(resolve => {
                pendingPurchaseDisclaimer = resolve;
                showDisclaimerGate('purchase');
            });
        }

        function resolvePurchaseDisclaimer(accepted) {
            if (!pendingPurchaseDisclaimer) return;
            const resolve = pendingPurchaseDisclaimer;
            pendingPurchaseDisclaimer = null;
            disclaimerGateMode = 'login';
            const gate = document.getElementById('disclaimer-gate');
            if (gate) gate.hidden = true;
            const rememberLabel = document.querySelector('.disclaimer-remember');
            if (rememberLabel) rememberLabel.hidden = false;
            const cancelButton = document.getElementById('disclaimer-cancel-purchase');
            if (cancelButton) cancelButton.hidden = true;
            if (dashboardAuthenticated &&
                walletSessionToken &&
                walletSessionOwner === connectedWallet?.toLowerCase() &&
                walletSessionExpiresAt > Date.now()) {
                const header = document.querySelector('body > header');
                const main = document.querySelector('main');
                if (header) header.hidden = false;
                if (main) main.hidden = false;
            }
            resolve(accepted);
        }

        function resetDashboardToTradeView() {
            document.querySelectorAll('.view-panel').forEach(panel => panel.classList.remove('active'));
            document.getElementById('tradeView')?.classList.add('active');
            document.querySelectorAll('#nav-menu .nav-tab').forEach(tab => {
                tab.classList.toggle('active', tab.getAttribute('onclick')?.includes('tradeView'));
            });
        }

        async function initializeDashboard() {
            if (dashboardInitialized) return;
            dashboardInitialized = true;
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
            if (!autoSyncInterval) {
                autoSyncInterval = setInterval(() => {
                    if (connectedWallet && dashboardAuthenticated) silentSyncUserData(connectedWallet);
                }, 5000);
            }

            const urlParams = new URLSearchParams(window.location.search);
            const sharedProfile = urlParams.get('passprofile');
            if (sharedProfile) {
                document.getElementById('battlepass-user-content')?.setAttribute('hidden', '');
                switchView('blastrrPassView');
                loadPublicBattlePassProfile(sharedProfile);
            }
            const refCode = urlParams.get('ref');
            if (refCode) {
                const promoInput = document.getElementById('applied-promo');
                if (promoInput) {
                    promoInput.value = refCode;
                    applyPromo();
                }
            }
        }

        async function connectWallet() {
            const provider = getProvider();
            if (!provider) {
                setWalletLoginStatus('No compatible Web3 wallet was found. Install or enable a wallet to continue.');
                return;
            }
            setWalletLoginStatus('Approve the wallet connection, then sign the access message.', true);
            try {
                const accounts = await provider.request({ method: 'eth_requestAccounts' });
                if (!accounts || accounts.length === 0) {
                    setWalletLoginStatus('No wallet account was selected.');
                    return;
                }
                availableWallets = accounts;
                await onWalletSwitched(accounts[0]);
            } catch (err) {
                console.error("Wallet Connection Error:", err);
                setWalletLoginStatus(err?.code === 4001 ? 'Wallet signature was rejected. Sign the message to unlock the dashboard.' : (err.message || 'Unable to sign in with this wallet.'));
            }
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
                        await onWalletSwitched(accounts[0]);
                    }
                }
            } catch (err) {
                console.error(err);
                setWalletLoginStatus(err?.code === 4001 ? 'Wallet signature was rejected. Sign the message to unlock the dashboard.' : (err.message || 'Unable to sign in with this wallet.'));
            }
        }

        function toggleWalletMenu() {
            const panel = document.getElementById('wallet-menu-panel');
            const trigger = document.getElementById('wallet-menu-trigger');
            if (!panel || !trigger) return;
            const isOpen = panel.hidden;
            panel.hidden = !isOpen;
            trigger.setAttribute('aria-expanded', String(isOpen));
        }

        function closeWalletMenu() {
            const panel = document.getElementById('wallet-menu-panel');
            const trigger = document.getElementById('wallet-menu-trigger');
            if (panel) panel.hidden = true;
            if (trigger) trigger.setAttribute('aria-expanded', 'false');
        }

        function updateWalletDropdown() {
            const accounts = document.getElementById('wallet-menu-accounts');
            const preview = document.getElementById('wallet-active-preview');
            if (!accounts || !preview) return;
            preview.textContent = connectedWallet
                ? `${connectedWallet.substring(0, 6)}...${connectedWallet.slice(-4)}`
                : 'Wallet';
            accounts.replaceChildren();
            availableWallets.forEach(address => {
                const isActive = address.toLowerCase() === connectedWallet?.toLowerCase();
                const button = document.createElement('button');
                button.type = 'button';
                button.className = `wallet-menu-account${isActive ? ' is-active' : ''}`;
                button.setAttribute('aria-current', isActive ? 'true' : 'false');
                button.textContent = `${address.substring(0, 6)}...${address.slice(-4)}`;
                button.addEventListener('click', () => {
                    closeWalletMenu();
                    onWalletSwitched(address);
                });
                accounts.append(button);
            });
        }

        function updateWalletUIState(isConnected) {
            const connectBtn = document.getElementById('connect-btn');
            const walletMenu = document.getElementById('wallet-menu');
            const statusPill = document.getElementById('wallet-status');

            if (connectBtn) connectBtn.style.display = isConnected ? 'none' : 'inline-block';
            if (walletMenu) walletMenu.hidden = !isConnected;
            if (!isConnected) closeWalletMenu();
            
            if (statusPill) {
                statusPill.innerText = isConnected ? "Connected" : "Disconnected";
                statusPill.classList.toggle("connected", isConnected);
            }
        }

        async function onWalletSwitched(walletAddress) {
            if (!walletAddress) return;
            const owner = walletAddress.toLowerCase();
            const changedWallet = connectedWallet?.toLowerCase() !== owner;
            if (changedWallet) {
                resetDashboardToTradeView();
                userAccounts = [];
                walletSessionGeneration++;
                walletSessionToken = null;
                walletSessionOwner = null;
                walletSessionExpiresAt = 0;
                walletSessionPromise = null;
                lockDashboard('Sign the access message with the selected wallet to continue.');
            }
            connectedWallet = walletAddress;
            updateWalletUIState(true);
            updateWalletDropdown();
            setWalletLoginStatus('Sign the access message in your wallet.', true);
            try {
                await ensureWalletSession();
            } catch (error) {
                if (connectedWallet?.toLowerCase() === owner) {
                    console.error('Wallet sign-in failed:', error);
                    lockDashboard(error?.code === 4001 ? 'Wallet signature was rejected. Sign the message to unlock the dashboard.' : (error.message || 'Unable to sign in with this wallet.'));
                }
                return;
            }
            if (connectedWallet?.toLowerCase() !== owner) return;
            try {
                const consentResponse = await walletFetch('/api/user/disclaimer-consent');
                const consent = await consentResponse.json();
                if (!consentResponse.ok) throw new Error(consent.error || 'Unable to check disclaimer acceptance.');
                if (connectedWallet?.toLowerCase() !== owner) return;
                if (consent.accepted && consent.version === DISCLAIMER_VERSION) {
                    await continueAfterDisclaimer();
                } else {
                    showDisclaimerGate();
                }
            } catch (error) {
                if (connectedWallet?.toLowerCase() === owner) {
                    console.error('Disclaimer status check failed:', error);
                    lockDashboard(error.message || 'Unable to check disclaimer acceptance. Sign in again to continue.');
                }
            }
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

        function populateTicketAccountOptions() {
            const select = document.getElementById('ticket-account-select');
            if (!select) return;
            const selected = select.value;
            select.innerHTML = '<option value="">General support (no account)</option>' +
                userAccounts.map(account => `<option value="${escapeHTML(account.id)}">${escapeHTML(account.plan_name)} (${escapeHTML(account.id)})</option>`).join('');
            if (userAccounts.some(account => account.id === selected)) select.value = selected;
        }

        async function silentSyncUserData(wallet) {
            try {
                const res = await walletFetch(`/api/accounts?wallet=${encodeURIComponent(wallet)}`);
                if (!res.ok) throw new Error('Unable to load wallet accounts.');
                const data = await res.json();
                if (!Array.isArray(data.accounts)) throw new Error('The wallet account list is unavailable.');
                userAccounts = data.accounts;
                populateTicketAccountOptions();

                const selectElem = document.getElementById('active-account-select');
                if (!selectElem) return true;
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
                return true;
            } catch (err) {
                console.error("Auto-sync error:", err);
                return false;
            }
        }

        function manualRefreshData() {
            if (!connectedWallet) { alert("Connect wallet first!"); return; }
            silentSyncUserData(connectedWallet);
            loadLeaderboard(currentLeaderboardMode);
            alert("Data refreshed successfully!");
        }

        function disconnectWallet() {
            resetDashboardToTradeView();
            connectedWallet = null;
            walletSessionGeneration++;
            walletSessionToken = null;
            walletSessionOwner = null;
            walletSessionExpiresAt = 0;
            walletSessionPromise = null;
            lockDashboard('Your wallet has been disconnected. Sign in again to access your dashboard.');
            availableWallets = [];
            userAccounts = [];
            selectedAccountId = null;
            activeAccount = null;
            currentUserProfile = null;
            battlePassProfile = null;
            document.getElementById('battlepass-profile-card')?.setAttribute('hidden', '');
            document.getElementById('battlepass-profile-form')?.setAttribute('hidden', '');
            document.getElementById('battlepass-wallet-note').textContent = 'Connect your wallet to view your XP, points, tasks, and level rewards.';

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
            const ticketList = document.getElementById('user-ticket-list');
            if (ticketList) ticketList.innerHTML = '<p class="account-chart-empty">Connect your wallet to view tickets.</p>';
            const ticketAccount = document.getElementById('ticket-account-select');
            if (ticketAccount) ticketAccount.innerHTML = '<option value="">General support (no account)</option>';
            const reviewUsername = document.getElementById('review-username');
            if (reviewUsername) reviewUsername.value = '';
            const reviewSubmit = document.querySelector('#user-review-form button[type="submit"]');
            if (reviewSubmit) reviewSubmit.disabled = true;
            userReviewAccounts = [];
            const reviewAccountSelect = document.getElementById('review-account');
            if (reviewAccountSelect) {
                reviewAccountSelect.disabled = true;
                reviewAccountSelect.innerHTML = '<option value="">Connect wallet to check eligibility</option>';
            }
            const reviewComment = document.getElementById('review-comment');
            if (reviewComment) reviewComment.value = '';
            const reviewFeedback = document.getElementById('review-form-feedback');
            if (reviewFeedback) reviewFeedback.textContent = 'Connect your wallet and set up a profile username to submit a review.';
            
            const setupBox = document.getElementById('profile-setup-box');
            const dispBox = document.getElementById('profile-display-box');
            const editBtn = document.getElementById('btn-toggle-edit');
            if (setupBox) setupBox.style.display = 'block';
            if (dispBox) dispBox.style.display = 'none';
            if (editBtn) editBtn.style.display = 'none';

        }

        async function checkRole(wallet) {
            try {
                const res = await fetch(`/api/auth/role?wallet=${wallet}`);
                const data = await res.json();
                currentWalletIsAdmin = Boolean(data.isAdmin);
                const adminNav = document.getElementById('admin-nav-item');
                if (adminNav) adminNav.style.display = data.isAdmin ? 'inline-block' : 'none';
                updateMaintenanceNavigation();
                const activeView = document.querySelector('.view-panel.active')?.id;
                const pageId = maintenanceViewPages[activeView];
                if (!currentWalletIsAdmin && pageId && maintenanceStatuses[pageId]) switchView(activeView);
            } catch (err) { console.error(err); }
        }

        async function loadUserAccounts(wallet) {
            const synced = await silentSyncUserData(wallet);
            renderAccountsPortfolioFlickerFree();
            return synced;
        }

        function togglePermanentlyLockedAccounts(checked) {
            hidePermanentlyLockedAccounts = checked;
            renderAccountsPortfolioFlickerFree();
        }

        async function renderAccountsPortfolioFlickerFree() {
            const container = document.getElementById('accounts-portfolio-container');
            if (!container) return;
            if (userAccounts.length === 0) {
                container.innerHTML = '<p class="workspace-empty-state">No accounts found. Purchase a plan in the marketplace!</p>';
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
                const isPermanentlyLocked = acc.lock_reason === 'MLL' ||
                    Number(acc.permanent_lock) === 1 ||
                    acc.status === 'PERMANENTLY_LOCKED';
                if (hidePermanentlyLockedAccounts && isPermanentlyLocked) {
                    document.getElementById(`acc-card-${acc.id}`)?.remove();
                    continue;
                }

                let cardElem = document.getElementById(`acc-card-${acc.id}`);
                if (!cardElem) {
                    const cardHtml = `
                        <article id="acc-card-${acc.id}" class="account-card">
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
                                    <small id="profit-target-${acc.id}"></small>
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
                        </article>
                    `;
                    container.insertAdjacentHTML('beforeend', cardHtml);
                    cardElem = document.getElementById(`acc-card-${acc.id}`);
                }

                cardElem.querySelector(`#bal-val-${CSS.escape(acc.id)}`).innerText = `$${acc.current_balance.toLocaleString()}`;
                cardElem.querySelector(`#profit-val-${CSS.escape(acc.id)}`).innerText = `$${m.currentProfit.toLocaleString()}`;
                cardElem.querySelector(`#p-prog-val-${CSS.escape(acc.id)}`).innerText = `${m.profitProgress}%`;
                cardElem.querySelector(`#p-prog-bar-${CSS.escape(acc.id)}`).style.width = `${m.profitProgress}%`;
                cardElem.querySelector(`#profit-target-${CSS.escape(acc.id)}`).innerText = `Target: $${acc.profit_target.toLocaleString()}`;
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
                emptyMessage.textContent = hidePermanentlyLockedAccounts
                    ? 'No accounts to show. Turn off “Hide permanently locked accounts” to review permanently locked accounts.'
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

        async function loadAdminTickets() {
            const container = document.getElementById('admin-ticket-list');
            if (!container) return;
            try {
                const authorization = await signedTradeAuthorization();
                const response = await fetch('/api/admin/tickets', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(authorization)
                });
                const data = await readAdminApiResponse(response, '/api/admin/tickets');
                if (!response.ok) throw new Error(data.error || 'Unable to load support tickets.');
                if (!data.tickets?.length) {
                    container.innerHTML = '<p class="account-chart-empty">No support tickets.</p>';
                    return;
                }
                container.innerHTML = data.tickets.map(ticket => `
                    <article class="support-ticket-card" data-admin-ticket-id="${escapeHTML(ticket.id)}">
                        <div class="support-ticket-heading">
                            <h3>${escapeHTML(ticket.subject)}</h3>
                            <span class="support-status ${supportStatusClass(ticket.status)}">${supportStatusLabel(ticket.status)}</span>
                        </div>
                        <p class="support-ticket-meta">
                            ${escapeHTML(ticket.username || 'Trader')} · <code>${escapeHTML(ticket.wallet_address)}</code><br>
                            ${ticket.account_id ? `${escapeHTML(ticket.plan_name || 'Account')} · ${escapeHTML(ticket.account_id)}` : 'General support'} · Created ${escapeHTML(new Date(ticket.created_at).toLocaleString())}
                        </p>
                        ${renderSupportMessages(ticket.messages || [])}
                        ${ticket.status !== 'CLOSED' ? `
                            <div class="support-ticket-actions">
                                <label for="admin-ticket-reply-${escapeHTML(ticket.id)}">Reply (sending a reply marks “Needs your info”)</label>
                                <textarea id="admin-ticket-reply-${escapeHTML(ticket.id)}" maxlength="5000" rows="4" placeholder="Write a clear response or request the details needed to resolve this issue."></textarea>
                                <div class="support-ticket-buttons">
                                    <button class="btn-wallet" data-admin-ticket-action="REPLY">Send reply</button>
                                    <button class="btn-sell" data-admin-ticket-action="CLOSE">Close ticket</button>
                                </div>
                            </div>
                        ` : ''}
                    </article>
                `).join('');
                container.onclick = event => {
                    const button = event.target.closest('[data-admin-ticket-action]');
                    const card = button?.closest('[data-admin-ticket-id]');
                    if (button && card) processAdminTicket(card.dataset.adminTicketId, button.dataset.adminTicketAction, card);
                };
            } catch (err) {
                console.error(err);
                container.innerHTML = `<p class="support-feedback">${escapeHTML(err.message)}</p>`;
            }
        }

        async function processAdminTicket(ticketId, action, card) {
            const message = card.querySelector('textarea')?.value.trim() || '';
            if (action === 'REPLY' && !message) {
                alert('Write a reply before sending it.');
                return;
            }
            if (action === 'CLOSE' && !confirm('Close this support ticket?')) return;
            try {
                const authorization = await signedTradeAuthorization();
                const response = await fetch('/api/admin/tickets/action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...authorization, ticket_id: ticketId, action, message })
                });
                const data = await readAdminApiResponse(response, '/api/admin/tickets/action');
                if (!response.ok) throw new Error(data.error || 'Unable to update support ticket.');
                await loadAdminTickets();
            } catch (err) {
                console.error(err);
                alert(err.message);
            }
        }

        function renderStarRating(rating) {
            const value = Math.max(0, Math.min(5, Number(rating) || 0));
            return `<span class="support-stars" aria-label="${value} out of 5 stars">${'★'.repeat(value)}${'☆'.repeat(5 - value)}</span>`;
        }

        async function loadAdminReviews() {
            const container = document.getElementById('admin-review-list');
            if (!container) return;
            try {
                const authorization = await signedTradeAuthorization();
                const response = await fetch('/api/admin/reviews', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(authorization)
                });
                const data = await readAdminApiResponse(response, '/api/admin/reviews');
                if (!response.ok) throw new Error(data.error || 'Unable to load reviews.');
                if (!data.reviews?.length) {
                    container.innerHTML = '<p class="account-chart-empty">No customer reviews submitted.</p>';
                    return;
                }
                container.innerHTML = data.reviews.map(review => `
                    <article class="support-review-card">
                        <div class="support-review-heading">
                            <div><h3>${escapeHTML(review.username)}</h3>${renderStarRating(review.rating)}</div>
                            <div class="admin-review-actions">
                                <span class="support-status ${Number(review.published) ? 'support-status-open' : 'support-status-needs-info'}">${Number(review.published) ? 'Published' : 'Awaiting approval'}</span>
                                <button class="${Number(review.published) ? 'btn-sell' : 'btn-wallet'}" data-review-account="${escapeHTML(review.account_id)}" data-review-action="${Number(review.published) ? 'HIDE' : 'PUBLISH'}">${Number(review.published) ? 'Hide from homepage' : 'Publish to homepage'}</button>
                            </div>
                        </div>
                        <p class="support-review-meta">${escapeHTML(review.plan_name || 'Purchased account')} · <code>${escapeHTML(review.account_id)}</code><br><code>${escapeHTML(review.wallet_address)}</code> · Updated ${escapeHTML(new Date(review.updated_at).toLocaleString())}</p>
                        <p class="support-review-comment">${escapeHTML(review.comment)}</p>
                    </article>
                `).join('');
                container.onclick = event => {
                    const button = event.target.closest('[data-review-action]');
                    if (button) processAdminReview(button.dataset.reviewAccount, button.dataset.reviewAction);
                };
            } catch (err) {
                console.error(err);
                container.innerHTML = `<p class="support-feedback">${escapeHTML(err.message)}</p>`;
            }
        }

        async function loadAdminCreatorSearch(username) {
            const container = document.getElementById('admin-creator-search-results');
            if (!container) return;
            container.innerHTML = '<p class="account-chart-empty">Searching creator profiles...</p>';
            try {
                const authorization = await signedTradeAuthorization();
                const response = await fetch('/api/admin/referrals/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...authorization, username })
                });
                const data = await readAdminApiResponse(response, '/api/admin/referrals/search');
                if (!response.ok) throw new Error(data.error || 'Unable to search creator profiles.');
                if (!data.users?.length) {
                    container.innerHTML = '<p class="account-chart-empty">No creator profiles matched that username.</p>';
                    return;
                }
                container.innerHTML = data.users.map((user, index) => `
                    <article class="admin-creator-card" data-creator-wallet="${escapeHTML(user.wallet_address)}">
                        <div>
                            <strong>@${escapeHTML(user.username)}</strong><br>
                            <code>${escapeHTML(user.wallet_address)}</code>
                        </div>
                        <div class="admin-creator-rate">
                            <div class="form-group">
                                <label for="admin-referral-pct-${index}">Commission rate (%)</label>
                                <input id="admin-referral-pct-${index}" type="number" min="0" max="100" step="0.01" value="${Number(user.referral_pct ?? 2)}">
                            </div>
                            <button class="btn-wallet" type="button" data-save-referral-rate>Save</button>
                        </div>
                    </article>
                `).join('');
                container.onclick = event => {
                    const button = event.target.closest('[data-save-referral-rate]');
                    const card = button?.closest('[data-creator-wallet]');
                    const input = card?.querySelector('input[type="number"]');
                    if (card && input) saveAdminReferralRate(card.dataset.creatorWallet, input.value, button);
                };
            } catch (err) {
                console.error(err);
                container.innerHTML = `<p class="support-feedback">${escapeHTML(err.message)}</p>`;
            }
        }

        async function loadAdminCreatorApplications() {
            const container = document.getElementById('admin-creator-applications');
            if (!container) return;
            container.innerHTML = '<p class="account-chart-empty">Loading creator applications...</p>';
            try {
                const authorization = await signedTradeAuthorization();
                const response = await fetch('/api/admin/creator-applications/list', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(authorization)
                });
                const data = await readAdminApiResponse(response, '/api/admin/creator-applications/list');
                if (!response.ok) throw new Error(data.error || 'Unable to load creator applications.');
                if (!data.applications?.length) {
                    container.innerHTML = '<p class="account-chart-empty">No creator applications have been submitted.</p>';
                    return;
                }

                const socialLinks = [
                    ['X', 'x_url'],
                    ['YouTube', 'youtube_url'],
                    ['TikTok', 'tiktok_url'],
                    ['Instagram', 'instagram_url'],
                    ['Twitch', 'twitch_url'],
                    ['Discord', 'discord_url'],
                    ['Website', 'website_url']
                ];
                container.innerHTML = data.applications.map((application, index) => {
                    const links = socialLinks
                        .filter(([, key]) => application[key])
                        .map(([label, key]) => `<a href="${escapeHTML(application[key])}" target="_blank" rel="noopener noreferrer">${label}</a>`)
                        .join('');
                    const status = String(application.status || 'PENDING').toLowerCase().replaceAll('_', ' ');
                    return `
                        <article class="creator-application-admin-card" data-creator-application-wallet="${escapeHTML(application.wallet_address)}">
                            <div class="creator-application-admin-heading">
                                <div>
                                    <h3>${application.username ? `@${escapeHTML(application.username)}` : 'Creator applicant'}</h3>
                                    <code>${escapeHTML(application.wallet_address)}</code>
                                </div>
                                <span class="creator-application-admin-status">${escapeHTML(status)}</span>
                            </div>
                            <div class="creator-application-admin-links">${links || '<span>No social profile links</span>'}</div>
                            <p><span>Community size</span>${escapeHTML(application.community_size)}</p>
                            <p><span>Community</span>${escapeHTML(application.community_description)}</p>
                            <p><span>Why Blastrr</span>${escapeHTML(application.creator_motivation)}</p>
                            <div class="creator-application-admin-actions">
                                <label for="creator-application-rate-${index}">Referral bonus (%)</label>
                                <input id="creator-application-rate-${index}" type="number" min="0" max="100" step="0.01" value="${Number(application.referral_pct ?? 2)}">
                                <button class="btn-wallet" type="button" data-creator-application-action="APPROVE">${application.status === 'APPROVED' ? 'Save bonus' : 'Approve'}</button>
                                <button class="creator-application-reject" type="button" data-creator-application-action="REJECT">Reject</button>
                            </div>
                        </article>
                    `;
                }).join('');
            } catch (err) {
                console.error(err);
                container.innerHTML = `<p class="support-feedback">${escapeHTML(err.message)}</p>`;
            }
        }

        async function loadAdminMaintenanceSettings() {
            const container = document.getElementById('admin-maintenance-pages');
            const message = document.getElementById('admin-maintenance-message');
            const feedback = document.getElementById('admin-maintenance-feedback');
            if (!container) return;
            if (feedback) feedback.textContent = 'Loading maintenance settings...';
            try {
                const authorization = await signedTradeAuthorization();
                const response = await fetch('/api/admin/maintenance/load', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(authorization)
                });
                const data = await readAdminApiResponse(response, '/api/admin/maintenance/load');
                if (!response.ok) throw new Error(data.error || 'Unable to load maintenance settings.');
                const settings = new Map((data.pages || []).map(page => [page.page_id, Number(page.is_offline) === 1]));
                container.querySelectorAll('input[type="checkbox"]').forEach(input => {
                    input.checked = Boolean(settings.get(input.value));
                });
                if (message) message.value = data.outage_message || '';
                if (feedback) feedback.textContent = '';
            } catch (error) {
                console.error(error);
                if (feedback) feedback.textContent = error.message;
            }
        }

        async function saveAdminMaintenanceSettings(button) {
            const container = document.getElementById('admin-maintenance-pages');
            const message = document.getElementById('admin-maintenance-message')?.value.trim() || '';
            const feedback = document.getElementById('admin-maintenance-feedback');
            const offlinePages = Array.from(container?.querySelectorAll('input[type="checkbox"]:checked') || [])
                .map(input => input.value);
            if (offlinePages.length && !message) {
                if (feedback) feedback.textContent = 'Add an outage message before taking pages offline.';
                return;
            }
            if (button) button.disabled = true;
            if (feedback) feedback.textContent = 'Saving maintenance settings...';
            try {
                const authorization = await signedTradeAuthorization();
                const response = await fetch('/api/admin/maintenance/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...authorization, offline_pages: offlinePages, outage_message: message })
                });
                const data = await readAdminApiResponse(response, '/api/admin/maintenance/save');
                if (!response.ok) throw new Error(data.error || 'Unable to save maintenance settings.');
                await loadMaintenanceStatus();
                if (feedback) feedback.textContent = offlinePages.length
                    ? `Maintenance enabled for ${offlinePages.length} ${offlinePages.length === 1 ? 'page' : 'pages'}.`
                    : 'All selected services are online.';
            } catch (error) {
                console.error(error);
                if (feedback) feedback.textContent = error.message;
            } finally {
                if (button) button.disabled = false;
            }
        }

        async function reviewCreatorApplication(wallet, action, card, button) {
            const input = card?.querySelector('input[type="number"]');
            const referralPct = action === 'APPROVE' ? Number(input?.value) : undefined;
            if (action === 'APPROVE' && (!Number.isFinite(referralPct) || referralPct < 0 || referralPct > 100)) {
                alert('Enter a referral bonus from 0% to 100%.');
                return;
            }
            if (button) button.disabled = true;
            try {
                const authorization = await signedTradeAuthorization();
                const response = await fetch('/api/admin/creator-applications/action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...authorization, user_wallet: wallet, action, referral_pct: referralPct })
                });
                const data = await readAdminApiResponse(response, '/api/admin/creator-applications/action');
                if (!response.ok) throw new Error(data.error || 'Unable to review creator application.');
                await loadAdminCreatorApplications();
                const search = document.getElementById('admin-creator-search')?.value.trim();
                if (search?.length >= 2) await loadAdminCreatorSearch(search);
            } catch (err) {
                console.error(err);
                alert(err.message);
                if (button) button.disabled = false;
            }
        }

        async function saveAdminReferralRate(wallet, referralPct, button) {
            if (button) button.disabled = true;
            try {
                const authorization = await signedTradeAuthorization();
                const response = await fetch('/api/admin/referrals/commission', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...authorization, user_wallet: wallet, referral_pct: referralPct })
                });
                const data = await readAdminApiResponse(response, '/api/admin/referrals/commission');
                if (!response.ok) throw new Error(data.error || 'Unable to update the commission rate.');
                await loadAdminCreatorSearch(document.getElementById('admin-creator-search')?.value.trim());
            } catch (err) {
                console.error(err);
                alert(err.message);
                if (button) button.disabled = false;
            }
        }

        async function loadAdminPromoManagement() {
            await Promise.all([loadAdminPromoPlans(), loadAdminPromoCodes()]);
        }

        async function loadAdminPromoPlans() {
            const select = document.getElementById('admin-promo-plan');
            if (!select) return;
            try {
                const response = await fetch('/api/plans');
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Unable to load account plans.');
                const plans = data.plans || [];
                select.innerHTML = plans.length
                    ? `<option value="">Select a plan</option>${plans.map(plan => `<option value="${Number(plan.id)}">${escapeHTML(plan.name)} · $${Number(plan.simulated_capital).toLocaleString()} capital</option>`).join('')}`
                    : '<option value="">No active plans available</option>';
            } catch (err) {
                console.error(err);
                select.innerHTML = '<option value="">Plans unavailable</option>';
                const feedback = document.getElementById('admin-promo-feedback');
                if (feedback) feedback.textContent = err.message;
            }
        }

        async function loadAdminPromoCodes() {
            const container = document.getElementById('admin-promo-code-list');
            if (!container) return;
            try {
                const authorization = await signedTradeAuthorization();
                const response = await fetch('/api/admin/promo-codes/list', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(authorization)
                });
                const data = await readAdminApiResponse(response, '/api/admin/promo-codes/list');
                if (!response.ok) throw new Error(data.error || 'Unable to load free account codes.');
                if (!data.codes?.length) {
                    container.innerHTML = '<p class="account-chart-empty">No free account codes generated.</p>';
                    return;
                }
                container.innerHTML = data.codes.map(code => `
                    <article class="promo-code-card">
                        <div class="promo-code-card-header">
                            <code>${escapeHTML(code.code)}</code>
                            <span class="promo-code-status ${code.claimed_at ? 'claimed' : ''}">${code.claimed_at ? 'Claimed' : 'Available'}</span>
                        </div>
                        <p class="support-review-meta">${escapeHTML(code.plan_name)} · Created ${escapeHTML(new Date(code.created_at).toLocaleString())}</p>
                        ${code.claimed_at ? `<p class="support-review-meta">Claimed by <code>${escapeHTML(code.claimed_by)}</code> · ${escapeHTML(new Date(code.claimed_at).toLocaleString())}</p>` : ''}
                    </article>
                `).join('');
            } catch (err) {
                console.error(err);
                container.innerHTML = `<p class="support-feedback">${escapeHTML(err.message)}</p>`;
            }
        }

        async function createAdminPromoCode(planId) {
            const feedback = document.getElementById('admin-promo-feedback');
            if (feedback) feedback.textContent = '';
            try {
                const authorization = await signedTradeAuthorization();
                const response = await fetch('/api/admin/promo-codes/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...authorization, plan_id: planId })
                });
                const data = await readAdminApiResponse(response, '/api/admin/promo-codes/create');
                if (!response.ok) throw new Error(data.error || 'Unable to generate a free account code.');
                if (feedback) feedback.textContent = `Generated ${data.code} for ${data.plan_name}. Share this code with its recipient.`;
                await loadAdminPromoCodes();
            } catch (err) {
                console.error(err);
                if (feedback) feedback.textContent = err.message;
            }
        }

        async function processAdminReview(accountId, action) {
            try {
                const authorization = await signedTradeAuthorization();
                const response = await fetch('/api/admin/reviews/action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...authorization, review_account_id: accountId, action })
                });
                const data = await readAdminApiResponse(response, '/api/admin/reviews/action');
                if (!response.ok) throw new Error(data.error || 'Unable to update review publication.');
                await loadAdminReviews();
            } catch (err) {
                console.error(err);
                alert(err.message);
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
            if (dashboardAuthenticated && (!walletSessionToken || walletSessionExpiresAt <= Date.now())) {
                lockDashboard('Your wallet session expired. Sign in again to continue.');
                throw new Error('Wallet session expired. Sign in again to continue.');
            }
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
            displayedOpenTrades = data.trades || [];

            if (displayedOpenTrades.length === 0) {
                tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: #6b7280; padding: 24px;">No open positions for this account.</td></tr>';
                return;
            }

            displayedOpenTrades.forEach(trd => {
                const currentPrice = trd.current_price || currentLivePrice || trd.entry_price;
                const priceDiff = trd.side === 'BUY' ? (currentPrice - trd.entry_price) : (trd.entry_price - currentPrice);
                const pnl = Number.isFinite(Number(trd.live_pnl)) ? Number(trd.live_pnl) : priceDiff * trd.units;
                const pnlColor = pnl >= 0 ? '#34d399' : '#ef4444';
                const leverageDisplay = trd.leverage && trd.leverage > 1 ? `${trd.leverage}x Perp` : '1x Spot';
                const margin = Number(trd.size_usd);
                const notional = Number(trd.units) * Number(trd.entry_price);

                tbody.innerHTML += `
                    <tr>
                        <td><code>${trd.id}</code></td>
                        <td>${trd.symbol}</td>
                        <td><span style="color: ${trd.side === 'BUY' ? '#34d399' : '#ef4444'}; font-weight: bold;">${trd.side}</span></td>
                        <td>${leverageDisplay}</td>
                        <td>$${trd.entry_price.toFixed(2)}</td>
                        <td>$${margin.toLocaleString()} / $${notional.toLocaleString()}</td>
                        <td>SL: ${trd.sl || 'None'} / TP: ${trd.tp || 'None'}</td>
                        <td><span data-trade-pnl="${trd.id}" style="color: ${pnlColor}; font-weight: bold;">$${pnl.toFixed(2)}</span></td>
                        <td><button class="btn-sell" style="padding:5px 10px; font-size:11px;" onclick="closeTrade('${trd.id}', ${currentPrice})">Close Early</button></td>
                    </tr>
                `;
            });
        }

        function updateDisplayedOpenTradePnls(currentPrice) {
            if (!Number.isFinite(currentPrice) || currentPrice <= 0) return;
            const selectedSymbol = document.getElementById('order-symbol')?.value;
            const tbody = document.getElementById('open-trades-list');
            if (!selectedSymbol || !tbody) return;

            for (const trade of displayedOpenTrades) {
                if (trade.symbol !== selectedSymbol) continue;
                const priceDiff = trade.side === 'BUY'
                    ? currentPrice - Number(trade.entry_price)
                    : Number(trade.entry_price) - currentPrice;
                const pnl = priceDiff * Number(trade.units);
                if (!Number.isFinite(pnl)) continue;
                const pnlCell = Array.from(tbody.querySelectorAll('[data-trade-pnl]'))
                    .find(cell => cell.dataset.tradePnl === trade.id);
                if (!pnlCell) continue;
                pnlCell.textContent = `$${pnl.toFixed(2)}`;
                pnlCell.style.color = pnl >= 0 ? '#34d399' : '#ef4444';
            }
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
                standardDiscountPct = Number(data.standard_discount_pct ?? 90);
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
                const basePrice = Number(plan.base_price_usdt);
                const discountPct = Math.min(100, standardDiscountPct + (activePromoCode ? battlePassDiscountBonusPct : 0));
                const displayPrice = Math.round(basePrice * (100 - discountPct)) / 100;
                const capital = Number(plan.simulated_capital);
                const price = `$${displayPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
                const oldPrice = `$${basePrice.toLocaleString()} USDT`;
                const profitTarget = `$${Number(plan.profit_target).toLocaleString()}`;
                const dailyLossLimit = `$${(capital * Number(plan.daily_loss_pct) / 100).toLocaleString()}`;
                const maxDrawdown = `$${(capital * Number(plan.max_drawdown_pct) / 100).toLocaleString()}`;
                const isFeatured = plan.name.replace(/\s+\$[\d,]+.*$/, '') === 'Pro';

                container.innerHTML += `
                    <article class="card purchase-plan-card${isFeatured ? ' is-featured' : ''}">
                        <div class="purchase-plan-header">
                            <div>
                                <h3 class="purchase-plan-name">${escapeHTML(plan.name)}</h3>
                                <div class="purchase-plan-capital">$${capital.toLocaleString()}</div>
                                <div class="purchase-plan-caption">SIMULATED CAPITAL</div>
                            </div>
                            ${isFeatured ? '<span class="battlepass-period-tag">POPULAR</span>' : ''}
                        </div>
                        <span class="purchase-plan-status" title="Straight-to-funded plan model. Account capital is simulated; eligibility and current terms apply."><span class="purchase-plan-status-icon" aria-hidden="true">↗</span>STRAIGHT TO FUNDED</span>
                        <section class="purchase-plan-reward" aria-label="Purchase discount reward">
                            <span class="purchase-plan-reward-label">Purchase reward · discount applied</span>
                            <div class="purchase-plan-price">${price}<small>${discountPct}% off · <span class="purchase-plan-old-price">${oldPrice}</span></small></div>
                        </section>
                        <div class="purchase-plan-rules" aria-label="${escapeHTML(plan.name)} account rules">
                            <div class="purchase-plan-rule"><span>Profit target</span><strong>${profitTarget}</strong></div>
                            <div class="purchase-plan-rule"><span>Daily loss limit (${Number(plan.daily_loss_pct)}%)</span><strong>${dailyLossLimit}</strong></div>
                            <div class="purchase-plan-rule"><span>Max drawdown (${Number(plan.max_drawdown_pct)}%)</span><strong>${maxDrawdown}</strong></div>
                            <div class="purchase-plan-rule"><span>Profit consistency</span><strong>${Number(plan.max_single_day_profit_pct)}% max single-day profit</strong></div>
                            <div class="purchase-plan-rule"><span>Trading availability</span><strong>24/7/365</strong></div>
                        </div>
                        <button class="btn-wallet" style="width:100%; padding:12px;" onclick="buyPlan(${Number(plan.id)}, ${displayPrice})">Buy Plan (${price})</button>
                    </article>
                `;
            });
        }

        async function applyPromo() {
            const code = document.getElementById('applied-promo')?.value.trim();
            const feedback = document.getElementById('promo-feedback');
            if (!code) {
                activePromoCode = null;
                battlePassDiscountBonusPct = 0;
                if (feedback) feedback.textContent = '';
                renderPlans();
                return;
            }

            const res = await fetch('/api/promo/validate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });
            const data = await res.json();

            if (data.valid) {
                activePromoCode = code.toUpperCase();
                battlePassDiscountBonusPct = data.type === 'BATTLEPASS' ? Number(data.bonus_discount_pct || 0) : 0;
                if (feedback) feedback.innerText = `✓ Code '${activePromoCode}' applied! ${Math.min(100, standardDiscountPct + battlePassDiscountBonusPct)}% total discount.`;
                renderPlans();
            } else {
                activePromoCode = null;
                battlePassDiscountBonusPct = 0;
                if (feedback) feedback.innerText = `✕ ${data.error || 'Invalid promo code.'}`;
                renderPlans();
            }
        }

        async function loadUserProfile(wallet) {
            try {
                const res = await walletFetch(`/api/user/profile?wallet=${encodeURIComponent(wallet)}`);
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Unable to load your profile.');
                
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
                    const dReferralPct = document.getElementById('disp-referral-pct');
                    if (dUser) dUser.innerText = data.user.username;
                    if (dCode) dCode.innerText = data.user.discount_code;
                    if (dLink) dLink.value = `https://blastrr.com/?ref=${data.user.discount_code}`;
                    if (dReferralPct) dReferralPct.innerText = `${Number(data.user.referral_pct ?? 2)}%`;

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
                renderCreatorApplication(data.application);

                const reviewUsername = document.getElementById('review-username');
                if (reviewUsername) reviewUsername.value = currentUserProfile?.username || '';
                await loadUserReview(wallet);
                loadLeaderboard(currentLeaderboardMode);
            } catch (err) { console.error(err); }
        }

        function renderCreatorApplication(application) {
            const form = document.getElementById('creator-application-form');
            const status = document.getElementById('creator-application-status');
            const startButton = document.getElementById('creator-application-start');
            if (!form || !status || !startButton) return;

            const fields = {
                'creator-x-url': application?.x_url,
                'creator-youtube-url': application?.youtube_url,
                'creator-tiktok-url': application?.tiktok_url,
                'creator-instagram-url': application?.instagram_url,
                'creator-twitch-url': application?.twitch_url,
                'creator-discord-url': application?.discord_url,
                'creator-website-url': application?.website_url,
                'creator-community-size': application?.community_size,
                'creator-community-description': application?.community_description,
                'creator-motivation': application?.creator_motivation
            };
            Object.entries(fields).forEach(([id, value]) => {
                const field = document.getElementById(id);
                if (field) field.value = value || '';
            });

            const intro = document.getElementById('creator-application-intro');
            startButton.hidden = false;
            if (application) {
                const statusText = {
                    PENDING: 'Under review',
                    APPROVED: 'Approved',
                    REJECTED: 'Not approved'
                }[application.status] || 'Under review';
                status.textContent = statusText;
                status.hidden = false;
                intro?.classList.add('creator-application-existing');
                startButton.textContent = 'Edit application';
            } else {
                status.hidden = true;
                intro?.classList.remove('creator-application-existing');
                startButton.textContent = 'Apply to become a creator';
            }
            form.hidden = true;
            const feedback = document.getElementById('creator-application-feedback');
            if (feedback) feedback.textContent = '';
        }

        async function submitCreatorApplication(event) {
            event.preventDefault();
            const form = event.currentTarget;
            const feedback = document.getElementById('creator-application-feedback');
            const button = form.querySelector('button[type="submit"]');
            const linkIds = [
                'creator-x-url', 'creator-youtube-url', 'creator-tiktok-url',
                'creator-instagram-url', 'creator-twitch-url', 'creator-discord-url',
                'creator-website-url'
            ];
            if (!linkIds.some(id => document.getElementById(id)?.value.trim())) {
                if (feedback) feedback.textContent = 'Add at least one social profile link.';
                return;
            }
            if (!connectedWallet) {
                if (feedback) feedback.textContent = 'Connect your wallet before applying.';
                return;
            }

            if (button) button.disabled = true;
            if (feedback) feedback.textContent = 'Submitting your application...';
            try {
                const authorization = await signedTradeAuthorization();
                const response = await fetch('/api/user/creator-application', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...authorization,
                        x_url: document.getElementById('creator-x-url').value.trim(),
                        youtube_url: document.getElementById('creator-youtube-url').value.trim(),
                        tiktok_url: document.getElementById('creator-tiktok-url').value.trim(),
                        instagram_url: document.getElementById('creator-instagram-url').value.trim(),
                        twitch_url: document.getElementById('creator-twitch-url').value.trim(),
                        discord_url: document.getElementById('creator-discord-url').value.trim(),
                        website_url: document.getElementById('creator-website-url').value.trim(),
                        community_size: document.getElementById('creator-community-size').value,
                        community_description: document.getElementById('creator-community-description').value.trim(),
                        creator_motivation: document.getElementById('creator-motivation').value.trim()
                    })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Unable to submit creator application.');
                if (feedback) feedback.textContent = 'Application submitted. You can edit it while it is under review.';
                form.hidden = true;
                await loadUserProfile(connectedWallet);
            } catch (err) {
                console.error(err);
                if (feedback) feedback.textContent = err.message;
            } finally {
                if (button) button.disabled = false;
            }
        }

        async function claimFreeAccountCode() {
            const input = document.getElementById('free-account-code');
            const feedback = document.getElementById('free-account-feedback');
            const button = document.getElementById('claim-free-account');
            const code = input?.value.trim();
            if (!connectedWallet) {
                if (feedback) feedback.textContent = 'Connect your wallet before claiming a code.';
                return;
            }
            if (!code) {
                if (feedback) feedback.textContent = 'Enter a free account code.';
                return;
            }
            if (button) button.disabled = true;
            if (feedback) feedback.textContent = 'Claiming your account...';
            try {
                const response = await walletFetch('/api/promo/claim', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Unable to claim this code.');
                if (feedback) feedback.textContent = `${data.plan_name} account added to your wallet.`;
                if (input) input.value = '';
                await loadUserAccounts(connectedWallet);
                switchView('accountsView');
            } catch (err) {
                console.error(err);
                if (feedback) feedback.textContent = err.message;
            } finally {
                if (button) button.disabled = false;
            }
        }

        function supportStatusLabel(status) {
            if (status === 'NEEDS_INFO') return 'Needs your info';
            if (status === 'CLOSED') return 'Closed';
            return 'Open';
        }

        function supportStatusClass(status) {
            if (status === 'NEEDS_INFO') return 'support-status-needs-info';
            if (status === 'CLOSED') return 'support-status-closed';
            return 'support-status-open';
        }

        function renderSupportMessages(messages) {
            return `<div class="support-message-list">${messages.map(message => `
                <article class="support-message ${message.author_role === 'ADMIN' ? 'support-message-admin' : 'support-message-user'}">
                    <div class="support-message-header"><strong>${escapeHTML(message.author_name)}</strong><time>${escapeHTML(new Date(message.created_at).toLocaleString())}</time></div>
                    <p>${escapeHTML(message.body)}</p>
                </article>
            `).join('')}</div>`;
        }

        async function loadUserTickets(wallet) {
            const container = document.getElementById('user-ticket-list');
            if (!container || !wallet) return;
            populateTicketAccountOptions();
            try {
                const response = await walletFetch(`/api/user/tickets?wallet=${encodeURIComponent(wallet)}`);
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Unable to load support tickets.');
                if (!data.tickets?.length) {
                    container.innerHTML = '<p class="account-chart-empty">No support tickets yet. Create one above if you need help.</p>';
                    return;
                }
                container.innerHTML = data.tickets.map(ticket => `
                    <article class="support-ticket-card" data-ticket-id="${escapeHTML(ticket.id)}">
                        <div class="support-ticket-heading">
                            <h3>${escapeHTML(ticket.subject)}</h3>
                            <span class="support-status ${supportStatusClass(ticket.status)}">${supportStatusLabel(ticket.status)}</span>
                        </div>
                        <p class="support-ticket-meta">${ticket.account_id ? `${escapeHTML(ticket.plan_name || 'Account')} · ${escapeHTML(ticket.account_id)}` : 'General support'} · Updated ${escapeHTML(new Date(ticket.updated_at).toLocaleString())}</p>
                        ${renderSupportMessages(ticket.messages || [])}
                        ${ticket.status !== 'CLOSED' ? `<div class="support-ticket-actions"><label for="user-ticket-reply-${escapeHTML(ticket.id)}">Reply to this ticket</label><textarea id="user-ticket-reply-${escapeHTML(ticket.id)}" maxlength="5000" rows="4" placeholder="Add details or answer the support team (up to 5,000 characters)."></textarea><button class="btn-wallet" data-user-ticket-reply="${escapeHTML(ticket.id)}">Send reply</button></div>` : ''}
                    </article>
                `).join('');
            } catch (err) {
                console.error(err);
                container.innerHTML = `<p class="support-feedback">${escapeHTML(err.message)}</p>`;
            }
        }

        async function submitUserTicketReply(ticketId, card) {
            const textarea = card.querySelector('textarea');
            const button = card.querySelector('[data-user-ticket-reply]');
            const message = textarea?.value.trim();
            if (!message) return;
            if (button) button.disabled = true;
            try {
                const response = await walletFetch(`/api/user/tickets/${encodeURIComponent(ticketId)}/reply`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Unable to send ticket reply.');
                await loadUserTickets(connectedWallet);
            } catch (err) {
                console.error(err);
                alert(err.message);
            } finally {
                if (button) button.disabled = false;
            }
        }

        async function loadUserReview(wallet) {
            const form = document.getElementById('user-review-form');
            if (!form || !wallet) return;
            const feedback = document.getElementById('review-form-feedback');
            const submit = form.querySelector('button[type="submit"]');
            const usernameField = document.getElementById('review-username');
            const accountSelect = document.getElementById('review-account');
            if (usernameField) usernameField.value = currentUserProfile?.username || '';
            if (submit) submit.disabled = true;
            document.getElementById('review-comment').value = '';
            document.getElementById('review-rating').value = '5';
            if (feedback) feedback.textContent = 'Loading your review…';
            try {
                const response = await walletFetch(`/api/user/review?wallet=${encodeURIComponent(wallet)}`);
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Unable to load your review.');
                userReviewAccounts = Array.isArray(data.accounts) ? data.accounts : [];
                if (!accountSelect) return;
                const previouslySelected = accountSelect.value;
                accountSelect.innerHTML = userReviewAccounts.length
                    ? userReviewAccounts.map(account => `<option value="${escapeHTML(account.account_id)}">${escapeHTML(account.plan_name || 'Purchased account')} · ${escapeHTML(account.account_id)}</option>`).join('')
                    : '<option value="">No purchased accounts available</option>';
                accountSelect.disabled = userReviewAccounts.length === 0;
                if (userReviewAccounts.some(account => account.account_id === previouslySelected)) {
                    accountSelect.value = previouslySelected;
                }
                renderSelectedUserReview();
            } catch (err) {
                console.error(err);
                if (feedback) feedback.textContent = err.message;
                if (accountSelect) {
                    accountSelect.disabled = true;
                    accountSelect.innerHTML = '<option value="">Unable to load eligible accounts</option>';
                }
            }
        }

        function renderSelectedUserReview() {
            const form = document.getElementById('user-review-form');
            const accountSelect = document.getElementById('review-account');
            const feedback = document.getElementById('review-form-feedback');
            const submit = form?.querySelector('button[type="submit"]');
            const selectedAccount = userReviewAccounts.find(account => account.account_id === accountSelect?.value);
            const hasUsername = Boolean(currentUserProfile?.username);
            document.getElementById('review-comment').value = selectedAccount?.comment || '';
            document.getElementById('review-rating').value = String(selectedAccount?.rating || 5);
            if (submit) submit.disabled = !selectedAccount || !hasUsername;
            if (!feedback) return;
            if (!userReviewAccounts.length) {
                feedback.textContent = hasUsername
                    ? 'A purchased account is required before you can submit a review.'
                    : 'Set up your profile username and purchase an account before submitting a review.';
            } else if (!hasUsername) {
                feedback.textContent = 'Set up your profile username before submitting a review.';
            } else if (!selectedAccount) {
                feedback.textContent = 'Select a purchased account to write its review.';
            } else if (selectedAccount.rating) {
                feedback.textContent = selectedAccount.published
                    ? 'Your review is published. Saving changes will send it for approval again.'
                    : 'Your review is awaiting admin approval. You may edit this account review.';
            } else {
                feedback.textContent = 'One review is allowed per purchased account. Reviews are approved before appearing on the homepage.';
            }
        }

        async function submitUserReview(event) {
            event.preventDefault();
            const feedback = document.getElementById('review-form-feedback');
            if (!connectedWallet || !currentUserProfile?.username) {
                if (feedback) feedback.textContent = 'Set up your profile username before submitting a review.';
                return;
            }
            try {
                const response = await walletFetch('/api/user/reviews', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        account_id: document.getElementById('review-account').value,
                        rating: Number(document.getElementById('review-rating').value),
                        comment: document.getElementById('review-comment').value
                    })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Unable to submit review.');
                if (feedback) feedback.textContent = data.message;
                await loadUserReview(connectedWallet);
            } catch (err) {
                console.error(err);
                if (feedback) feedback.textContent = err.message;
            }
        }

        async function submitSupportTicket(event) {
            event.preventDefault();
            if (!connectedWallet) return;
            const form = event.currentTarget;
            const feedback = document.getElementById('ticket-form-feedback');
            const submit = form.querySelector('button[type="submit"]');
            if (submit) submit.disabled = true;
            try {
                const response = await walletFetch('/api/user/tickets', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        account_id: document.getElementById('ticket-account-select').value || null,
                        subject: document.getElementById('ticket-subject').value,
                        message: document.getElementById('ticket-message').value
                    })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Unable to create support ticket.');
                form.reset();
                populateTicketAccountOptions();
                if (feedback) feedback.textContent = 'Ticket created. The support team will respond here.';
                await loadUserTickets(connectedWallet);
            } catch (err) {
                console.error(err);
                if (feedback) feedback.textContent = err.message;
            } finally {
                if (submit) submit.disabled = false;
            }
        }

        function toggleEditProfile() {
            const setupBox = document.getElementById('profile-setup-box');
            if (setupBox) setupBox.style.display = setupBox.style.display === 'none' ? 'block' : 'none';
        }

        async function loadReferralTransactions(wallet) {
            try {
                const res = await walletFetch(`/api/user/referrals?wallet=${encodeURIComponent(wallet)}`);
                const data = await res.json();
                const container = document.getElementById('ref-transactions-list');
                if (!container) return;
                container.replaceChildren();

                if (!data.referrals || data.referrals.length === 0) {
                    container.innerHTML = '<p class="workspace-empty-state">No sales recorded yet.</p>';
                    return;
                }

                data.referrals.forEach(ref => {
                    const buyerName = ref.buyer_username ? `@${ref.buyer_username}` : 'Anonymous Trader';
                    const dateStr = new Date(ref.created_at).toLocaleString();
                    container.insertAdjacentHTML('beforeend', `
                        <article class="battlepass-task profile-commission-card">
                            <div class="profile-commission-main">
                                <strong>${escapeHTML(buyerName)}</strong>
                                <span>${escapeHTML(ref.plan_name)}</span>
                            </div>
                            <div class="profile-commission-details">
                                <strong>+$${Number(ref.commission_earned).toFixed(2)} USDT</strong>
                                <span>${Number(ref.commission_pct ?? 2)}% commission</span>
                                <small>${escapeHTML(dateStr)}</small>
                            </div>
                        </article>
                    `);
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
            const amount = Number(priceUsdt);
            if (!Number.isFinite(amount) || amount < 0) { alert("Invalid plan price."); return; }
            const owner = connectedWallet.toLowerCase();
            if (!dashboardAuthenticated || !walletSessionToken ||
                walletSessionOwner !== owner || walletSessionExpiresAt <= Date.now()) {
                lockDashboard('Your wallet session expired. Sign in again before purchasing.');
                return;
            }
            if (!await requestPurchaseDisclaimer() || connectedWallet?.toLowerCase() !== owner) return;
            await completePlanPurchase(planId, amount);
        }

        async function completePlanPurchase(planId, amount) {
            if (amount === 0) {
                if (!confirm('Confirm this free account purchase?')) return;
                try {
                    const response = await walletFetch('/api/accounts/purchase', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            wallet_address: connectedWallet,
                            plan_id: Number(planId),
                            promo_code: activePromoCode,
                            disclaimer_version: DISCLAIMER_VERSION,
                            terms_accepted: true,
                            simulated_funds_acknowledged: true
                        })
                    });
                    const data = await response.json();
                    if (!response.ok || !data.success) throw new Error(data.error || 'Unable to provision this free account.');
                    alert("Free account provisioned successfully.");
                    await loadUserAccounts(connectedWallet);
                    switchView('tradeView');
                } catch (error) {
                    console.error("Free account purchase error:", error);
                    alert(error.message || "Unable to provision this free account.");
                }
                return;
            }

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

            if (!confirm(`Confirm purchase for $${amount} USDT on ${chainConfig.name}?`)) return;

            try {
                const paddedRecipient = TREASURY_WALLET.toLowerCase().replace('0x', '').padStart(64, '0');
                const rawAmount = toTokenUnits(amount, chainConfig.decimals);
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

                const res = await walletFetch('/api/accounts/purchase', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        wallet_address: connectedWallet, 
                        plan_id: planId, 
                        tx_hash: txHash, 
                        chain_id: selectedChainId,
                        promo_code: activePromoCode,
                        disclaimer_version: DISCLAIMER_VERSION,
                        terms_accepted: true,
                        simulated_funds_acknowledged: true
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

        document.getElementById('support-ticket-form')?.addEventListener('submit', submitSupportTicket);
        document.getElementById('user-review-form')?.addEventListener('submit', submitUserReview);
        document.getElementById('creator-application-start')?.addEventListener('click', () => {
            const form = document.getElementById('creator-application-form');
            const button = document.getElementById('creator-application-start');
            if (form) form.hidden = false;
            if (button) button.hidden = true;
        });
        document.getElementById('creator-application-cancel')?.addEventListener('click', () => {
            const form = document.getElementById('creator-application-form');
            const button = document.getElementById('creator-application-start');
            if (form) form.hidden = true;
            if (button) button.hidden = false;
        });
        document.getElementById('creator-application-form')?.addEventListener('submit', submitCreatorApplication);
        document.getElementById('admin-creator-applications')?.addEventListener('click', event => {
            const button = event.target.closest('[data-creator-application-action]');
            const card = button?.closest('[data-creator-application-wallet]');
            if (button && card) {
                reviewCreatorApplication(
                    card.dataset.creatorApplicationWallet,
                    button.dataset.creatorApplicationAction,
                    card,
                    button
                );
            }
        });
        document.getElementById('admin-creator-search-form')?.addEventListener('submit', event => {
            event.preventDefault();
            loadAdminCreatorSearch(document.getElementById('admin-creator-search')?.value.trim() || '');
        });
        document.getElementById('admin-maintenance-save')?.addEventListener('click', event => {
            saveAdminMaintenanceSettings(event.currentTarget);
        });
        document.getElementById('admin-promo-code-form')?.addEventListener('submit', async event => {
            event.preventDefault();
            const form = event.currentTarget;
            const button = form.querySelector('button[type="submit"]');
            const planId = Number(document.getElementById('admin-promo-plan')?.value);
            if (!planId) {
                const feedback = document.getElementById('admin-promo-feedback');
                if (feedback) feedback.textContent = 'Choose an account plan first.';
                return;
            }
            if (button) button.disabled = true;
            await createAdminPromoCode(planId);
            if (button) button.disabled = false;
        });
        document.getElementById('claim-free-account')?.addEventListener('click', claimFreeAccountCode);
        document.getElementById('review-account')?.addEventListener('change', renderSelectedUserReview);
        document.getElementById('user-ticket-list')?.addEventListener('click', event => {
            const button = event.target.closest('[data-user-ticket-reply]');
            const card = button?.closest('[data-ticket-id]');
            if (button && card) submitUserTicketReply(button.dataset.userTicketReply, card);
        });
        document.getElementById('battlepass-profile-form')?.addEventListener('submit', saveBattlePassProfileImage);
        document.getElementById('battlepass-share')?.addEventListener('click', shareBattlePassProfile);
        document.getElementById('battlepass-claim-all')?.addEventListener('click', event => claimAllBattlePassRewards(event.currentTarget));
        document.getElementById('battlepass-user-content')?.addEventListener('click', event => {
            const tab = event.target.closest('[data-battlepass-tab]');
            const tabLink = event.target.closest('[data-battlepass-tab-link]');
            if (tab) selectBattlePassTab(tab.dataset.battlepassTab);
            if (tabLink) selectBattlePassTab(tabLink.dataset.battlepassTabLink);
        });
        document.getElementById('admin-battlepass-settings-form')?.addEventListener('submit', event => {
            event.preventDefault();
            saveAdminBattlePass('/api/admin/battlepass/settings', {
                standard_discount_pct: Number(document.getElementById('admin-standard-discount').value)
            }, event.currentTarget.querySelector('button[type="submit"]'));
        });
        document.getElementById('admin-battlepass-task-form')?.addEventListener('submit', async event => {
            event.preventDefault();
            const form = event.currentTarget;
            const feedback = document.getElementById('admin-battlepass-task-feedback');
            const button = form.querySelector('button[type="submit"]');
            const taskType = document.getElementById('admin-battlepass-task-type').value;
            const actionUrl = document.getElementById('admin-battlepass-task-url').value.trim();
            if (taskType === 'SOCIAL_CLICK' && !actionUrl) {
                if (feedback) feedback.textContent = 'Enter an action URL for a social task.';
                return;
            }
            if (feedback) feedback.textContent = '';
            if (button) button.disabled = true;
            const success = await saveAdminBattlePass('/api/admin/battlepass/tasks/save', {
                title: document.getElementById('admin-battlepass-task-title').value,
                description: document.getElementById('admin-battlepass-task-description').value,
                task_type: taskType,
                cadence: document.getElementById('admin-battlepass-task-cadence').value,
                action_url: actionUrl,
                xp_reward: Number(document.getElementById('admin-battlepass-task-xp').value),
                points_reward: Number(document.getElementById('admin-battlepass-task-points').value)
            }, button);
            if (success) {
                if (feedback) feedback.textContent = 'Task created.';
                form.reset();
                document.getElementById('admin-battlepass-task-xp').value = '100';
                document.getElementById('admin-battlepass-task-points').value = '10';
            }
        });
