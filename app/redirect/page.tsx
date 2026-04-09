"use client"

import { useEffect } from "react"
import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge"

export default function Redirect() {
  useEffect(() => {
    broadcastResponseToMainFrame().catch((error: Error) => {
      console.error("Error broadcasting response to main frame:", error)
    })
  }, [])

  return <p>Processing authentication...</p>
}
