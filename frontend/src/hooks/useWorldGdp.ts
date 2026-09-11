import { useEffect, useState } from 'react'
import { worldGdpApi } from '../services/api'

export interface WorldGdpData {
  worldGdp: number
  formatted: string
  currency: string
  lastUpdated: string
}

export function useWorldGdp() {
  const [worldGdp, setWorldGdp] = useState<WorldGdpData | null>(null)

  useEffect(() => {
    let cancelled = false

    const fetchWorldGdp = async () => {
      try {
        const response = await worldGdpApi.get()
        if (!cancelled && response.data.success) {
          setWorldGdp(response.data.data)
        }
      } catch (error) {
        console.error('Failed to fetch world GDP:', error)
      }
    }

    fetchWorldGdp()

    return () => {
      cancelled = true
    }
  }, [])

  return worldGdp
}
