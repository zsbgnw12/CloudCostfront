"use client"

import { SWRConfig } from "swr"

export function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: false,
        revalidateIfStale: true,
        dedupingInterval: 10000,       // 10s dedup: same key won't fire twice
        focusThrottleInterval: 60000,  // 1 min throttle on focus
        errorRetryCount: 2,
        keepPreviousData: true,        // show stale data while revalidating
      }}
    >
      {children}
    </SWRConfig>
  )
}
