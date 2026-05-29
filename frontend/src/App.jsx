import React, { useState } from 'react'
import { ChatProvider } from './context/ChatContext'
import Home from './pages/Home'
import RateLimitBanner from "./components/RateLimitBanner";

export default function App() {
  const [limited, setLimited] = useState(false);
  const [resetSeconds, setResetSeconds] = useState(3600);

  return (
    <ChatProvider setLimited={setLimited} setResetSeconds={setResetSeconds}>
      <Home />
      {limited && (
        <RateLimitBanner
          resetSeconds={resetSeconds}
          onReady={() => setLimited(false)}
        />
      )}
    </ChatProvider>
  )
}