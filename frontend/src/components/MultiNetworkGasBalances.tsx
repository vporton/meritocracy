import { useState, useEffect } from 'react'
import { useAppKit, useAppKitAccount } from '@reown/appkit/react'
import { useSendTransaction, useWriteContract } from 'wagmi'
import { parseEther, parseUnits, type Address } from 'viem'
import api from '../services/api'
import { hasReownWalletModal } from '../config/wagmi'
import { countries } from '../utils/countries'

interface NetworkInfo {
  name?: string;
  networkName?: string;
  adapterType?: string;
  networkId?: string;
  walletAddress?: string;
  chainId?: number;
  tokenSymbol?: string;
  nativeTokenSymbol?: string;
  tokenDecimals?: number;
  tokenType?: string;
  baseNetworkId?: string;
  gasPrice?: string;
  balance?: string;
  address?: string;
  balanceFormatted?: string;
  gasPriceFormatted?: string;
  availableForDistribution?: number;
  totalReserve?: number;
  lastDistribution?: string;
  walletBalance?: number;
  fundingAddresses?: FundingAddress[];
}

interface MultiNetworkStatus {
  enabledNetworks: string[];
  networks: Record<string, NetworkInfo>;
  totalNetworks: number;
  totalAvailable?: number;
  totalReserve?: number;
}

interface TokenPriceQuote {
  symbol: string;
  coinId: string;
  usd: number;
  lastUpdatedAt: string | null;
  source: 'coingecko';
}

type ExplorerLinkConfig = {
  label: string;
  buildUrl: (address: string) => string;
};

type FundingAddress = {
  network: string;
  label: string;
  address: string;
  note?: string;
  kind?: 'btc-deposit' | 'eth-deposit' | 'erc20-deposit' | 'manual';
  receiverPrincipal?: string;
  receiverPrincipalBytes32?: string;
  tokenContractAddress?: string;
};

const ETH_DEPOSIT_HELPER_ABI = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'payable',
    inputs: [{ name: 'receiver', type: 'bytes32' }],
    outputs: []
  }
] as const;

const ERC20_APPROVE_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  }
] as const;

const ERC20_DEPOSIT_HELPER_ABI = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'receiver', type: 'bytes32' }
    ],
    outputs: []
  }
] as const;

const explorerLinkMap: Record<string, ExplorerLinkConfig> = {
  mainnet: { label: 'Etherscan', buildUrl: address => `https://etherscan.io/address/${encodeURIComponent(address)}` },
  sepolia: { label: 'Sepolia Etherscan', buildUrl: address => `https://sepolia.etherscan.io/address/${encodeURIComponent(address)}` },
  polygon: { label: 'Polygonscan', buildUrl: address => `https://polygonscan.com/address/${encodeURIComponent(address)}` },
  arbitrum: { label: 'Arbiscan', buildUrl: address => `https://arbiscan.io/address/${encodeURIComponent(address)}` },
  optimism: { label: 'Optimistic Etherscan', buildUrl: address => `https://optimistic.etherscan.io/address/${encodeURIComponent(address)}` },
  base: { label: 'Base Explorer', buildUrl: address => `https://basescan.org/address/${encodeURIComponent(address)}` },
  celo: { label: 'Celo Explorer', buildUrl: address => `https://explorer.celo.org/address/${encodeURIComponent(address)}` },
  mezo: { label: 'Mezo Explorer', buildUrl: address => `https://explorer.mezo.org/address/${encodeURIComponent(address)}` },
  mezoTestnet: { label: 'Mezo Testnet Explorer', buildUrl: address => `https://explorer.test.mezo.org/address/${encodeURIComponent(address)}` },
  'bitcoin-mainnet': { label: 'Mempool Space', buildUrl: address => `https://mempool.space/address/${encodeURIComponent(address)}` },
  'bitcoin-cash-mainnet': { label: 'Bitcoin.com Explorer', buildUrl: address => `https://explorer.bitcoin.com/bch/address/${encodeURIComponent(address)}` },
  'solana-mainnet': { label: 'Solana Explorer', buildUrl: address => `https://explorer.solana.com/address/${encodeURIComponent(address)}` },
  'cosmoshub-mainnet': { label: 'Mintscan', buildUrl: address => `https://www.mintscan.io/cosmos/account/${encodeURIComponent(address)}` },
  'polkadot-mainnet': { label: 'Polkadot Subscan', buildUrl: address => `https://polkadot.subscan.io/account/${encodeURIComponent(address)}` },
  'stellar-mainnet': { label: 'Stellar Expert', buildUrl: address => `https://stellar.expert/explorer/public/account/${encodeURIComponent(address)}` },
  'icp-mainnet': { label: 'ICP Dashboard', buildUrl: address => `https://dashboard.internetcomputer.org/account/${encodeURIComponent(address)}` }
};

const stripCountrySuffix = (networkId: string) => {
  const match = networkId.match(/^(.*?)(?:-[A-Z]{2})$/);
  return match ? match[1] : networkId;
};

const placeholderAddressPatterns = [
  'ADDRESS-NOT-RESOLVED',
  'DERIVATION-FAILED',
  'DERIVE-NOT-SUPPORTED',
  'SECRET-MISSING-DB',
  'N/A'
];

const isPlaceholderAddress = (value: string) => {
  if (!value) return true;
  return placeholderAddressPatterns.some(pattern => value.includes(pattern));
};

const getExplorerLinkForNetwork = (networkId: string, address: string) => {
  if (!address || isPlaceholderAddress(address)) {
    return null;
  }

  const baseNetworkId = stripCountrySuffix(networkId);
  const config = explorerLinkMap[baseNetworkId] ?? (baseNetworkId.startsWith('icp-mainnet') ? explorerLinkMap['icp-mainnet'] : undefined);
  if (!config) {
    return null;
  }

  return {
    label: config.label,
    url: config.buildUrl(address)
  };
};

const normalizeAmountInput = (value: string) => value.trim().replace(/,/g, '');
const isPositiveAmount = (value: string) => {
  const parsed = Number(normalizeAmountInput(value));
  return Number.isFinite(parsed) && parsed > 0;
};

function MultiNetworkGasBalances() {
  const [networkStatus, setNetworkStatus] = useState<MultiNetworkStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingNetworks, setLoadingNetworks] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [copiedAddressKey, setCopiedAddressKey] = useState<string | null>(null)
  const [tokenQuotes, setTokenQuotes] = useState<Record<string, TokenPriceQuote>>({})
  const [fundingAmounts, setFundingAmounts] = useState<Record<string, string>>({})
  const [fundingStatusMessage, setFundingStatusMessage] = useState<string | null>(null)
  const [activeFundingKey, setActiveFundingKey] = useState<string | null>(null)

  const [scope, setScope] = useState<'GLOBAL' | 'REGION_EU' | 'COUNTRY'>('GLOBAL');
  const [selectedCountry, setSelectedCountry] = useState<string>('DE'); // Default to Germany or commonly used
  const { open: openAppKit } = useAppKit()
  const { isConnected } = useAppKitAccount()
  const { sendTransactionAsync } = useSendTransaction()
  const { writeContractAsync } = useWriteContract()

  const usdFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  })

  const shortenAddress = (value: string, startLength = 6, endLength = 4) => {
    if (!value || value === 'N/A') {
      return value
    }

    if (value.length <= startLength + endLength + 3) {
      return value
    }

    return `${value.slice(0, startLength)}...${value.slice(-endLength)}`
  }

  const shortenFundingAddress = (value: string) => {
    if (!value) {
      return value
    }

    const isPrincipal = value.includes('-') && !value.startsWith('0x')
    return shortenAddress(value, isPrincipal ? 8 : 10, isPrincipal ? 6 : 6)
  }

  const copyAddress = async (address: string, networkKey: string) => {
    try {
      await navigator.clipboard.writeText(address)
      setCopiedAddressKey(networkKey)
      setTimeout(() => setCopiedAddressKey(null), 2000)
    } catch (error) {
      console.error('Failed to copy address:', error)
    }
  }

  const fetchMultiNetworkStatus = async (
    currentScope: 'GLOBAL' | 'REGION_EU' | 'COUNTRY',
    currentCountry: string
  ) => {
    try {
      setLoading(true)
      setError(null)
      setNetworkStatus(null)
      setLoadingNetworks({})
      setTokenQuotes({})
      setFundingStatusMessage(null)

      const params = new URLSearchParams()
      if (currentScope === 'COUNTRY') {
        params.set('country', currentCountry)
      } else if (currentScope === 'REGION_EU') {
        params.set('region', 'EU')
      }
      const queryParams = params.toString() ? `?${params.toString()}` : ''

      // If scoped fund, ensure the corresponding treasury account exists first.
      if (currentScope === 'COUNTRY') {
        await api.post('/api/multi-network-gas/ensure-country-account', {
          country: currentCountry
        });
      } else if (currentScope === 'REGION_EU') {
        await api.post('/api/multi-network-gas/ensure-region-account', {
          region: 'EU'
        });
      }

      // 1. Fetch initial list of networks (fast)
      const listResponse = await api.get(`/api/multi-network-gas/list${queryParams}`)
      if (listResponse.data.success) {
        const listData = listResponse.data.data
        const rawNetworks = listData.networkDetails || []
        const networks = rawNetworks
        const initialNetworks: Record<string, NetworkInfo> = {}
        const initialLoading: Record<string, boolean> = {}

        networks.forEach((net: any) => {
          initialNetworks[net.networkId] = {
            networkName: net.networkName,
            adapterType: net.adapterType,
            walletAddress: net.walletAddress,
            tokenSymbol: net.tokenSymbol || '...',
            totalReserve: 0,
            walletBalance: 0,
            availableForDistribution: 0,
            balanceFormatted: 'Loading...',
            gasPriceFormatted: 'Loading...'
          }
          initialLoading[net.networkId] = true
        })

        const enabledNetworks = networks.map((net: any) => net.networkId)
        setNetworkStatus({
          enabledNetworks,
          networks: initialNetworks,
          totalNetworks: enabledNetworks.length,
          totalAvailable: 0,
          totalReserve: 0
        })
        setLoadingNetworks(initialLoading)
        setLoading(false)

        const tokenSymbols = Array.from(
          new Set(
            networks
              .map((net: any) => typeof net.tokenSymbol === 'string' ? net.tokenSymbol.trim().toUpperCase() : '')
              .filter((symbol: string) => symbol.length > 0)
          )
        )

        if (tokenSymbols.length > 0) {
          try {
            const priceResponse = await api.get('/api/global/token-prices', {
              params: {
                symbols: tokenSymbols.join(',')
              }
            })

            const quotes = priceResponse.data?.data?.quotes
            if (quotes && typeof quotes === 'object') {
              setTokenQuotes(quotes)
            }
          } catch (priceError) {
            console.error('Failed to fetch live token prices:', priceError)
          }
        }

        // 2. Fetch each network's status individualy in parallel (backend will coalesce and cache)
        enabledNetworks.forEach(async (networkId: string) => {
          try {
            const response = await api.get(`/api/multi-network-gas/network/${networkId}/status${queryParams}`)
            if (response.data.success) {
              const data = response.data.data
              setNetworkStatus(prev => {
                if (!prev) return prev;
                const updatedNetworks = {
                  ...prev.networks,
                  [networkId]: {
                    ...prev.networks[networkId],
                    ...data
                  }
                }

                // Recalculate totals
                let totalAvailable = 0
                let totalReserve = 0
                Object.values(updatedNetworks).forEach(net => {
                  totalAvailable += net.availableForDistribution || 0
                  totalReserve += net.totalReserve || 0
                })

                return {
                  ...prev,
                  networks: updatedNetworks,
                  totalAvailable,
                  totalReserve
                }
              })
            }
          } catch (err) {
            // Ignore 404s for specific country networks that might not exist yet strictly speaking
            console.error(`Failed to fetch status for ${networkId}:`, err)
          } finally {
            setLoadingNetworks(prev => ({
              ...prev,
              [networkId]: false
            }))
          }
        })
      }
    } catch (err) {
      console.error('Failed to fetch multi-network status:', err)
      setError('Failed to load network balances. Please try again later.')
    } finally {
      setLoading(false)
    }
  }

  const formatUsdAmount = (tokenSymbol: string, amount?: number) => {
    if (!Number.isFinite(amount)) {
      return null
    }

    const quote = tokenQuotes[tokenSymbol.trim().toUpperCase()]
    if (!quote || !Number.isFinite(quote.usd)) {
      return null
    }

    return usdFormatter.format((amount as number) * quote.usd)
  }

  const latestQuoteTime = Object.values(tokenQuotes).reduce<string | null>((latest, quote) => {
    if (!quote.lastUpdatedAt) {
      return latest
    }

    if (!latest || new Date(quote.lastUpdatedAt).getTime() > new Date(latest).getTime()) {
      return quote.lastUpdatedAt
    }

    return latest
  }, null)

  const getFundingAmount = (key: string) => fundingAmounts[key] ?? ''

  const setFundingAmount = (key: string, value: string) => {
    setFundingAmounts(prev => ({
      ...prev,
      [key]: value
    }))
  }

  const requireEvmWallet = async () => {
    if (isConnected) {
      return true
    }

    if (!hasReownWalletModal) {
      throw new Error('Wallet connection is not configured. Set VITE_WALLETCONNECT_PROJECT_ID to enable funding from wallet.')
    }

    await openAppKit({ view: 'Connect', namespace: 'eip155' })
    return false
  }

  const handleNativeEvmFunding = async (networkName: string, networkInfo: NetworkInfo) => {
    const targetAddress = networkInfo.address?.trim()
    const amount = normalizeAmountInput(getFundingAmount(networkName))
    if (!targetAddress || isPlaceholderAddress(targetAddress)) {
      throw new Error('Treasury address is not available for this network.')
    }
    if (!isPositiveAmount(amount)) {
      throw new Error('Enter a positive amount before funding.')
    }

    const connected = await requireEvmWallet()
    if (!connected) {
      setFundingStatusMessage('Wallet chooser opened. Connect a wallet, then submit the transfer again.')
      return
    }

    setActiveFundingKey(networkName)
    try {
      const hash = await sendTransactionAsync({
        to: targetAddress as Address,
        value: parseEther(amount)
      })
      setFundingStatusMessage(`Native transfer submitted on ${networkInfo.networkName ?? networkName}: ${hash}`)
    } finally {
      setActiveFundingKey(null)
    }
  }

  const handleCkEthFunding = async (networkName: string, funding: FundingAddress) => {
    const amount = normalizeAmountInput(getFundingAmount(networkName))
    if (!funding.receiverPrincipalBytes32) {
      throw new Error('Treasury principal encoding is missing for this ckETH deposit.')
    }
    if (!isPositiveAmount(amount)) {
      throw new Error('Enter a positive amount before funding.')
    }

    const connected = await requireEvmWallet()
    if (!connected) {
      setFundingStatusMessage('Wallet chooser opened. Connect a wallet, then submit the deposit again.')
      return
    }

    setActiveFundingKey(networkName)
    try {
      const hash = await writeContractAsync({
        address: funding.address as Address,
        abi: ETH_DEPOSIT_HELPER_ABI,
        functionName: 'deposit',
        args: [funding.receiverPrincipalBytes32 as `0x${string}`],
        value: parseEther(amount)
      })
      setFundingStatusMessage(`ckETH deposit submitted: ${hash}`)
    } finally {
      setActiveFundingKey(null)
    }
  }

  const handleCkErc20Funding = async (networkName: string, funding: FundingAddress, tokenDecimals: number) => {
    const amount = normalizeAmountInput(getFundingAmount(networkName))
    if (!funding.receiverPrincipalBytes32 || !funding.tokenContractAddress) {
      throw new Error('Treasury deposit metadata is incomplete for this token.')
    }
    if (!isPositiveAmount(amount)) {
      throw new Error('Enter a positive amount before funding.')
    }

    const connected = await requireEvmWallet()
    if (!connected) {
      setFundingStatusMessage('Wallet chooser opened. Connect a wallet, then submit the deposit again.')
      return
    }

    const amountUnits = parseUnits(amount, tokenDecimals)
    setActiveFundingKey(networkName)
    try {
      await writeContractAsync({
        address: funding.tokenContractAddress as Address,
        abi: ERC20_APPROVE_ABI,
        functionName: 'approve',
        args: [funding.address as Address, amountUnits]
      })

      const hash = await writeContractAsync({
        address: funding.address as Address,
        abi: ERC20_DEPOSIT_HELPER_ABI,
        functionName: 'deposit',
        args: [
          funding.tokenContractAddress as Address,
          amountUnits,
          funding.receiverPrincipalBytes32 as `0x${string}`
        ]
      })
      setFundingStatusMessage(`${funding.label.replace(' helper contract', '')} deposit submitted: ${hash}`)
    } finally {
      setActiveFundingKey(null)
    }
  }

  useEffect(() => {
    fetchMultiNetworkStatus(scope, selectedCountry)
  }, [scope, selectedCountry])

  if (loading && !networkStatus) {
    return (
      <div className="card">
        <div className="loading">Loading network status...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card">
        <div className="error">
          ❌ {error}
          <br />
          <small>Make sure the backend server is running and multi-network support is configured</small>
        </div>
      </div>
    )
  }

  if (!networkStatus || networkStatus.enabledNetworks.length === 0) {
    return (
      <div className="card">
        <div style={{
          padding: '1rem',
          background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
          borderRadius: '8px',
          borderLeft: '4px solid #f59e0b',
          marginBottom: '1rem'
        }}>
          <p style={{ margin: 0, color: '#92400e', fontWeight: '600' }}>
            ⚠️ <strong>No Networks Enabled</strong>
          </p>
          <p style={{ margin: '0.5rem 0 0 0', color: '#92400e', fontSize: '0.9rem' }}>
            Please configure your environment to enable multi-network support.
          </p>
        </div>
        <div style={{ fontSize: '0.9rem', color: '#888' }}>
          <p><strong>Supported Networks:</strong></p>
          <ul style={{ textAlign: 'left', margin: '0.5rem 0' }}>
            <li>mainnet - Ethereum Mainnet</li>
            <li>polygon - Polygon (POL)</li>
            <li>arbitrum - Arbitrum One</li>
            <li>optimism - Optimism</li>
            <li>base - Base (Coinbase L2)</li>
            <li>sepolia - Sepolia Testnet</li>
            <li>localhost - Local Development</li>
            <li>solana-mainnet - Solana (SOL)</li>
            <li>bitcoin-mainnet - Bitcoin (BTC)</li>
            <li>bitcoin-cash-mainnet - Bitcoin Cash (BCH)</li>
            <li>polkadot-mainnet - Polkadot (DOT)</li>
            <li>cosmoshub-mainnet - Cosmos Hub (ATOM)</li>
            <li>icp-mainnet - Internet Computer (ICP)</li>
          </ul>
        </div>
      </div>
    )
  }

  // Note: Totals removed as they don't make sense when summing across different networks
  // with different gas reserves and potentially negative available amounts

  return (
    <div className="card">
      <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
        <label>Fund Source:</label>
        <select
          value={
            scope === 'GLOBAL'
              ? 'GLOBAL'
              : scope === 'REGION_EU'
                ? 'EU'
                : selectedCountry
          }
          onChange={(e) => {
            const val = e.target.value;
            if (val === 'GLOBAL') {
              setScope('GLOBAL');
            } else if (val === 'EU') {
              setScope('REGION_EU');
            } else {
              setScope('COUNTRY');
              setSelectedCountry(val);
            }
          }}
          style={{ padding: '0.5rem', borderRadius: '4px', maxWidth: '300px' }}
        >
          <option value="GLOBAL">Global Fund</option>
          <option value="EU">European Union Fund</option>
          <optgroup label="Countries">
            {countries.map(c => (
              <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
            ))}
          </optgroup>
        </select>
      </div>

      {/* Summary */}
      <div style={{
        padding: '1rem',
        background: 'linear-gradient(135deg, #f0f9ff, #e0f2fe)',
        borderRadius: '8px',
        borderLeft: '4px solid #0ea5e9',
        marginBottom: '1.5rem'
      }}>
        <p style={{ margin: 0, color: '#0c4a6e', fontWeight: '600' }}>
          📊 <strong>Network Summary</strong>
        </p>
        <p style={{ margin: '0.5rem 0 0 0', color: '#0c4a6e', fontSize: '0.9rem' }}>
          {networkStatus.totalNetworks} networks enabled: {networkStatus.enabledNetworks.join(', ')}
        </p>
      {latestQuoteTime && (
        <p style={{ margin: '0.5rem 0 0 0', color: '#075985', fontSize: '0.8rem' }}>
          USD quotes from CoinGecko. Last update: {new Date(latestQuoteTime).toLocaleString()}
        </p>
      )}
      {fundingStatusMessage && (
        <p style={{ margin: '0.5rem 0 0 0', color: '#065f46', fontSize: '0.85rem', fontWeight: 600 }}>
          {fundingStatusMessage}
        </p>
      )}
    </div>

      {/* Network Details */}
      <div style={{ display: 'grid', gap: '1rem' }} data-nosnippet="data-nosnippet">
        {networkStatus.enabledNetworks.map((networkName) => {
          const networkInfo = networkStatus.networks[networkName] ?? {}
          const isNetworkLoading = loadingNetworks[networkName]
          const lastDistribution = networkInfo.lastDistribution

          const displayName =
            networkInfo.baseNetworkId
              ? networkInfo.networkName ?? networkInfo.name ?? networkName
              : networkInfo.name ?? networkInfo.networkName ?? networkName
          const chainBadgeText = typeof networkInfo.chainId === 'number'
            ? `Chain ${networkInfo.chainId}`
            : networkInfo.adapterType
              ? `${networkInfo.adapterType} network`
              : 'Network'
          const tokenSymbol =
            networkInfo.tokenSymbol ??
            networkInfo.nativeTokenSymbol ??
            'N/A'
          const fallbackDecimals =
            networkInfo.tokenDecimals ??
            6
          const fallbackWalletBalance = networkInfo.walletBalance
          const balanceFormatted =
            networkInfo.balanceFormatted ??
            (typeof fallbackWalletBalance === 'number'
              ? fallbackWalletBalance.toLocaleString('en-US', {
                maximumFractionDigits: fallbackDecimals
              })
              : 'N/A')
          const gasPriceFormatted =
            networkInfo.gasPriceFormatted ??
            'N/A'
          const address = networkInfo.address ?? 'N/A'
          const shortAddress = shortenAddress(address)
          const explorerLink = getExplorerLinkForNetwork(networkName, address)
          const balanceDisplay = balanceFormatted === 'N/A'
            ? (isNetworkLoading ? 'Loading...' : 'N/A')
            : `${balanceFormatted} ${tokenSymbol}`
          const balanceUsdEstimate = formatUsdAmount(tokenSymbol, fallbackWalletBalance)
          const gasPriceDisplay = gasPriceFormatted === 'N/A'
            ? (isNetworkLoading ? 'Loading...' : 'N/A')
            : `${gasPriceFormatted} ${tokenSymbol}`
          const gasPriceNumeric = Number.parseFloat(gasPriceFormatted)
          const gasPriceUsdEstimate = Number.isFinite(gasPriceNumeric)
            ? formatUsdAmount(tokenSymbol, gasPriceNumeric)
            : null

          return (
            <div key={networkName} style={{
              padding: '1rem',
              background: '#1a1a1a',
              borderRadius: '8px',
              border: '1px solid #333',
              textAlign: 'left',
              opacity: isNetworkLoading ? 0.7 : 1,
              transition: 'opacity 0.3s ease'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <h4 style={{ margin: 0, color: '#646cff' }}>
                  🌐 {displayName}
                </h4>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {isNetworkLoading && (
                    <span className="loading-spinner" style={{ fontSize: '0.8rem', color: '#888' }}>
                      ⏳
                    </span>
                  )}
                  {chainBadgeText && (
                    <span style={{
                      padding: '0.2rem 0.6rem',
                      background: '#4caf50',
                      color: 'white',
                      borderRadius: '12px',
                      fontSize: '0.8rem',
                      fontWeight: '500',
                      textTransform: 'uppercase'
                    }}>
                      {chainBadgeText}
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem', fontSize: '0.9rem' }}>
                <div>
                  <p style={{ margin: '0.25rem 0', color: '#888' }}>
                    <strong>Balance:</strong> {balanceDisplay}
                    {balanceUsdEstimate && (
                      <span style={{ color: '#cbd5e1' }}> ({balanceUsdEstimate})</span>
                    )}
                  </p>
                  <p style={{ margin: '0.25rem 0', color: '#888' }}>
                    <strong>Gas Price:</strong> {gasPriceDisplay}
                    {gasPriceUsdEstimate && (
                      <span style={{ color: '#cbd5e1' }}> ({gasPriceUsdEstimate})</span>
                    )}
                  </p>
                  <p style={{ margin: '0.25rem 0', color: '#888' }}>
                    <strong>Address:</strong>{" "}
                    <span
                      style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
                      title={address !== 'N/A' ? address : undefined}
                    >
                      {shortAddress}
                    </span>
                    {address !== 'N/A' && (
                      <button
                        type="button"
                        onClick={() => copyAddress(address, networkName)}
                        style={{
                          marginLeft: '0.5rem',
                          padding: '0.2rem 0.5rem',
                          fontSize: '0.75rem',
                          background: copiedAddressKey === networkName ? '#10b981' : '#374151',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer'
                        }}
                      >
                        {copiedAddressKey === networkName ? 'Copied!' : 'Copy'}
                      </button>
                    )}
                </p>
                {explorerLink && (
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem' }}>
                    <a
                      href={explorerLink.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#38bdf8' }}
                      title={`Open ${displayName} address on ${explorerLink.label}`}
                    >
                      View on {explorerLink.label}
                    </a>
                  </p>
                )}
                {typeof networkInfo.chainId === 'number' && address !== 'N/A' && !isPlaceholderAddress(address) && (
                  <div style={{
                    marginTop: '0.75rem',
                    padding: '0.75rem',
                    borderRadius: '8px',
                    background: 'rgba(59, 130, 246, 0.12)',
                    border: '1px solid rgba(59, 130, 246, 0.35)'
                  }}>
                    <p style={{ margin: '0 0 0.35rem 0', color: '#dbeafe', fontWeight: 600 }}>
                      Fund from browser wallet
                    </p>
                    <p style={{ margin: '0 0 0.5rem 0', color: '#bfdbfe', fontSize: '0.8rem' }}>
                      Send the native asset directly from the injected wallet exposed by Reown.
                    </p>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="Amount"
                        value={getFundingAmount(networkName)}
                        onChange={(event) => setFundingAmount(networkName, event.target.value)}
                        style={{
                          padding: '0.45rem 0.6rem',
                          minWidth: '140px',
                          borderRadius: '6px',
                          border: '1px solid #93c5fd',
                          background: '#fff',
                          color: '#111827'
                        }}
                      />
                      <button
                        type="button"
                        disabled={activeFundingKey === networkName}
                        onClick={async () => {
                          try {
                            await handleNativeEvmFunding(networkName, networkInfo)
                          } catch (fundingError) {
                            setFundingStatusMessage(fundingError instanceof Error ? fundingError.message : String(fundingError))
                          }
                        }}
                        style={{
                          padding: '0.45rem 0.8rem',
                          borderRadius: '6px',
                          border: 'none',
                          cursor: 'pointer',
                          background: activeFundingKey === networkName ? '#64748b' : '#2563eb',
                          color: '#fff',
                          fontWeight: 600
                        }}
                      >
                        {isConnected ? (activeFundingKey === networkName ? 'Sending...' : 'Send from wallet') : 'Connect wallet'}
                      </button>
                    </div>
                  </div>
                )}
                {networkInfo.fundingAddresses && networkInfo.fundingAddresses.length > 0 && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <p style={{ margin: '0 0 0.4rem 0', color: '#d1d5db', fontWeight: 600 }}>
                      Fill from origin network
                    </p>
                    {networkInfo.fundingAddresses.map((funding, index) => {
                      const fundingKey = `${networkName}-funding-${index}`
                      const fundingAmountKey = `${networkName}-funding-${index}`
                      const tokenDecimals = Number.isFinite(networkInfo.tokenDecimals)
                        ? Number(networkInfo.tokenDecimals)
                        : 6
                      const actionLabel =
                        funding.kind === 'eth-deposit'
                          ? 'Deposit ETH'
                          : funding.kind === 'erc20-deposit'
                            ? 'Approve & deposit'
                            : null
                      return (
                        <div key={fundingKey} style={{ marginBottom: '0.5rem' }}>
                          <p style={{ margin: '0.1rem 0', color: '#9ca3af' }}>
                            <strong>{funding.network}:</strong> {funding.label}
                          </p>
                          <p
                            style={{ margin: '0.1rem 0', color: '#e5e7eb', fontFamily: 'monospace', fontSize: '0.8rem' }}
                            title={funding.address}
                          >
                            {shortenFundingAddress(funding.address)}
                            <button
                              type="button"
                              onClick={() => copyAddress(funding.address, fundingKey)}
                              style={{
                                marginLeft: '0.5rem',
                                padding: '0.2rem 0.5rem',
                                fontSize: '0.75rem',
                                background: copiedAddressKey === fundingKey ? '#10b981' : '#374151',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer'
                              }}
                            >
                              {copiedAddressKey === fundingKey ? 'Copied!' : 'Copy'}
                            </button>
                          </p>
                          {actionLabel && funding.kind !== 'manual' && (
                            <div style={{
                              margin: '0.4rem 0 0.1rem 0',
                              padding: '0.6rem',
                              borderRadius: '8px',
                              background: 'rgba(15, 23, 42, 0.55)',
                              border: '1px solid rgba(148, 163, 184, 0.25)'
                            }}>
                              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  placeholder="Amount"
                                  value={getFundingAmount(fundingAmountKey)}
                                  onChange={(event) => setFundingAmount(fundingAmountKey, event.target.value)}
                                  style={{
                                    padding: '0.4rem 0.6rem',
                                    minWidth: '120px',
                                    borderRadius: '6px',
                                    border: '1px solid #475569',
                                    background: '#fff',
                                    color: '#111827'
                                  }}
                                />
                                <button
                                  type="button"
                                  disabled={activeFundingKey === fundingAmountKey}
                                  onClick={async () => {
                                    try {
                                      if (funding.kind === 'erc20-deposit') {
                                        await handleCkErc20Funding(fundingAmountKey, funding, tokenDecimals)
                                        return
                                      }

                                      if (funding.kind === 'eth-deposit') {
                                        await handleCkEthFunding(fundingAmountKey, funding)
                                        return
                                      }

                                      setFundingStatusMessage('This funding path requires a wallet that can send BTC directly.')
                                    } catch (fundingError) {
                                      setFundingStatusMessage(fundingError instanceof Error ? fundingError.message : String(fundingError))
                                    }
                                  }}
                                  style={{
                                    padding: '0.4rem 0.75rem',
                                    borderRadius: '6px',
                                    border: 'none',
                                    cursor: 'pointer',
                                    background: activeFundingKey === fundingAmountKey ? '#64748b' : '#7c3aed',
                                    color: '#fff',
                                    fontWeight: 600
                                  }}
                                >
                                  {activeFundingKey === fundingAmountKey ? 'Working...' : actionLabel}
                                </button>
                              </div>
                            </div>
                          )}
                          {funding.note && (
                            <p style={{ margin: '0.1rem 0', color: '#9ca3af', fontSize: '0.8rem' }}>
                              {funding.note}
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {lastDistribution && (
              <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: '#666' }}>
                Last Distribution: {new Date(lastDistribution).toLocaleString()}
              </p>
            )}
          </div>
          )
        })}
      </div>

      {/* Connection Issues Warning */}
      {networkStatus.enabledNetworks.some(networkName => {
        const networkInfo = networkStatus.networks[networkName]
        if (!networkInfo) return true
        const balanceFormatted = networkInfo.balanceFormatted ?? 'N/A'
        const gasPriceFormatted = networkInfo.gasPriceFormatted ?? 'N/A'
        return balanceFormatted === 'N/A' || gasPriceFormatted === 'N/A'
      }) && (
          <div style={{
            padding: '1rem',
            background: 'linear-gradient(135deg, #fef2f2, #fee2e2)',
            borderRadius: '8px',
            borderLeft: '4px solid #ef4444',
            marginTop: '1rem'
          }}>
            <p style={{ margin: 0, color: '#dc2626', fontWeight: '600' }}>
              ⚠️ <strong>Connection Issues Detected</strong>
            </p>
            <p style={{ margin: '0.5rem 0 0 0', color: '#dc2626', fontSize: '0.9rem' }}>
              Some networks are showing connection issues. Check your RPC URL configuration and network connectivity.
            </p>
          </div>
        )}
    </div>
  )
}

export default MultiNetworkGasBalances
