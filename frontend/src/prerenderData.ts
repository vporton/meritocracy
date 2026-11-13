import type { WorldGdpData } from './hooks/useWorldGdp'
import type { MultiNetworkStatus } from './components/MultiNetworkGasBalances'

export interface PrerenderData {
  worldGdp?: WorldGdpData
  treasury?: MultiNetworkStatus
}
