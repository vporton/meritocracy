import { prerenderToNodeStream } from 'react-dom/static'
import App from './App'
import { getApiOrigin } from './config/origins'
import type { MultiNetworkStatus, NetworkInfo } from './components/MultiNetworkGasBalances'
import type { PrerenderData } from './prerenderData'

type HelmetData = {
  title?: { toString(): string }
  priority?: { toString(): string }
  meta?: { toString(): string }
  link?: { toString(): string }
  script?: { toString(): string }
  style?: { toString(): string }
  base?: { toString(): string }
  noscript?: { toString(): string }
}

const helmetToString = (helmet: HelmetData | undefined) => [
  helmet?.title?.toString(),
  helmet?.priority?.toString(),
  helmet?.meta?.toString(),
  helmet?.link?.toString(),
  helmet?.script?.toString(),
  helmet?.style?.toString(),
  helmet?.base?.toString(),
  helmet?.noscript?.toString(),
].filter(Boolean).join('\n')

type NetworkDetail = NetworkInfo & { networkId: string }

const cache = new Map<string, { expires: number; data: unknown }>()

async function fetchApiData<T>(path: string): Promise<T | undefined> {
  const cached = cache.get(path)
  if (cached && cached.expires > Date.now()) return cached.data as T

  try {
    const response = await fetch(`${getApiOrigin()}${path}`, {
      signal: AbortSignal.timeout(8_000),
      headers: { accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    const payload = await response.json() as { success?: boolean; data?: T }
    if (!payload.success || !payload.data) throw new Error('API returned no data')
    cache.set(path, { expires: Date.now() + 30_000, data: payload.data })
    return payload.data
  } catch (error) {
    if (import.meta.env.PROD) {
      throw new Error(`Required prerender data request failed for ${path}`, { cause: error })
    }
    console.warn(`Could not preload ${path}:`, error)
    return undefined
  }
}

async function loadInitialData(url: string): Promise<PrerenderData> {
  const pathname = new URL(url, 'http://localhost').pathname
  if (pathname === '/') {
    const worldGdp = await fetchApiData<PrerenderData['worldGdp']>('/api/global/gdp')
    return worldGdp ? { worldGdp } : {}
  }

  if (pathname === '/treasury') {
    const list = await fetchApiData<{
      networkDetails: NetworkDetail[]
    }>('/api/multi-network-gas/list')
    if (!list) return {}

    const details = list.networkDetails.filter(network => !network.country && !network.region)
    const networks = Object.fromEntries(details.map(network => [
      network.networkId,
      {
        ...network,
        address: network.walletAddress,
        balanceFormatted: 'Loading…',
        gasPriceFormatted: 'Loading…',
      },
    ]))
    const treasury: MultiNetworkStatus = {
      enabledNetworks: details.map(network => network.networkId),
      networks,
      totalNetworks: details.length,
      totalAvailable: 0,
      totalReserve: 0,
    }
    return { treasury }
  }

  return {}
}

export async function render(url: string) {
  const helmetContext: { helmet?: HelmetData } = {}
  const initialData = await loadInitialData(url)
  const { prelude } = await prerenderToNodeStream(
    <App
      location={url}
      helmetContext={helmetContext as Record<string, unknown>}
      initialData={initialData}
    />,
  )

  let html = ''
  for await (const chunk of prelude) {
    html += chunk.toString()
  }

  return {
    html,
    head: helmetToString(helmetContext.helmet),
    data: initialData,
  }
}
