import { useState, useEffect } from "react";

function formatTime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function RateLimitBanner({ resetSeconds = 120, onReady }) {
  const [remaining, setRemaining] = useState(resetSeconds);

  useEffect(() => {
    if (remaining <= 0) {
      onReady?.();
      return;
    }
    const timer = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) { clearInterval(timer); return 0; }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const progress = ((resetSeconds - remaining) / resetSeconds) * 100;
  const isReady = remaining === 0;

  return (
    <div style={{
      ...styles.banner,
      borderColor: isReady ? "#22c55e" : "#ff6b35",
      background: isReady ? "rgba(34,197,94,0.06)" : "rgba(255,107,53,0.06)",
    }}>
      {/* Left accent line */}
      <div style={{
        ...styles.leftBar,
        background: isReady ? "#22c55e" : "#ff6b35",
      }} />

      <div style={styles.inner}>
        {/* Icon + message */}
        <div style={styles.row}>
          <span style={{ fontSize: 20 }}>{isReady ? "✅" : "⏳"}</span>
          <div>
            <p style={styles.title}>
              {isReady ? "Model is ready!" : "Model limit reached"}
            </p>
            <p style={styles.sub}>
              {isReady
                ? "You can now send messages again."
                : `Available again in `}
              {!isReady && (
                <span style={{ ...styles.timer, color: "#ff9f1c" }}>
                  {formatTime(remaining)}
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        {!isReady && (
          <div style={styles.track}>
            <div style={{
              ...styles.fill,
              width: `${progress}%`,
            }} />
          </div>
        )}

        {/* Ready button */}
        {isReady && (
          <button style={styles.btn} onClick={onReady}>
            Continue →
          </button>
        )}
      </div>
    </div>
  );
}

const styles = {
  banner: {
    position: "relative",
    borderRadius: "10px",
    border: "1px solid",
    overflow: "hidden",
    padding: "16px 20px 16px 28px",
    fontFamily: "'system-ui', sans-serif",
    maxWidth: "480px",
    transition: "border-color 0.4s, background 0.4s",
  },
  leftBar: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: "4px",
    borderRadius: "10px 0 0 10px",
    transition: "background 0.4s",
  },
  inner: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  row: {
    display: "flex",
    alignItems: "flex-start",
    gap: "12px",
  },
  title: {
    margin: 0,
    color: "#f0ece4",
    fontWeight: "600",
    fontSize: "15px",
  },
  sub: {
    margin: "2px 0 0",
    color: "#8a8a9a",
    fontSize: "13px",
  },
  timer: {
    fontFamily: "'Courier New', monospace",
    fontWeight: "700",
    fontSize: "14px",
  },
  track: {
    height: "3px",
    background: "#1e1e2e",
    borderRadius: "4px",
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    background: "linear-gradient(90deg, #ff6b35, #ff9f1c)",
    borderRadius: "4px",
    transition: "width 1s linear",
  },
  btn: {
    alignSelf: "flex-start",
    background: "#22c55e",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    padding: "8px 20px",
    fontSize: "13px",
    fontWeight: "600",
    cursor: "pointer",
  },
};