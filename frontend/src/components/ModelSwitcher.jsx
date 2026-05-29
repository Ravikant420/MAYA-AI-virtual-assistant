// src/components/ModelSwitcher.jsx
import { useState, useEffect } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import clsx from "clsx";

const MODELS = [
  { id: "ollama",  label: "🖥️ Ollama",  desc: "Local / Offline" },
  { id: "gemini",  label: "✨ Gemini",  desc: "Google AI"       },
  { id: "chatgpt", label: "🤖 ChatGPT", desc: "OpenAI"          },
];

const SERVER = "http://localhost:8000";

export default function ModelSwitcher({ isRomantic }) {
  const [current, setCurrent] = useState("ollama");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    axios.get(`${SERVER}/api/model/current`)
      .then(r => setCurrent(r.data.model))
      .catch(() => {});
  }, []);

  const switchModel = async (model) => {
    if (model === current) return;
    setLoading(true);
    try {
      await axios.post(`${SERVER}/api/model/switch`, { model });
      setCurrent(model);
      toast.success(`Switched to ${model}`);
    } catch (e) {
      toast.error(`Failed to switch: ${e.response?.data?.error || e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const accent = isRomantic ? "border-rom text-rom" : "border-pro text-pro";
  const accentBg = isRomantic ? "bg-rom/10" : "bg-pro/10";

  return (
    <div className="px-3 py-2">
      <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
        AI Model
      </p>
      <div className="flex flex-col gap-1">
        {MODELS.map(m => (
          <button
            key={m.id}
            onClick={() => switchModel(m.id)}
            disabled={loading}
            className={clsx(
              "flex items-center justify-between px-3 py-2 rounded-xl border text-xs transition-all",
              current === m.id
                ? clsx("border", accent, accentBg, "font-semibold")
                : "border-border text-ink-muted hover:text-ink-secondary hover:bg-muted",
              loading && "opacity-50 cursor-not-allowed"
            )}
          >
            <span>{m.label}</span>
            <span className="text-ink-muted" style={{ fontSize: "10px" }}>
              {current === m.id ? "● Active" : m.desc}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
