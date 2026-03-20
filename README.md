# 🖇️ Ollama Paperclip v1.0.0

A powerful Multi-Agent Orchestration UI powered by **Ollama**. Seamlessly generate specialized agents and autonomous task lists from a single prompt.

## ✨ Features

- **🤖 Multi-Agent Orchestration**: Automatically classifies requests and provisions specialized agents (inspired by `multiagent-orchestrator`).
- **📋 Autonomous Task System**: Sequential task execution with context sharing between steps.
- **⚡ High Performance**: Throttled UI updates (10fps) and request guarding for a smooth streaming experience.
- **🛑 Real-time Control**: Stop button to halt generation or task execution at any time.
- **💾 Auto-Save**: Persistent projects and settings via local `data.json`.
- **🔌 Ollama Integration**: Compatible with any local Ollama model.

## 🚀 Getting Started

### Prerequisites
- [Ollama](https://ollama.com/) installed and running.
- Node.js (v18+)

### Setup

1. **Clone and Install**
   ```bash
   npm install
   ```

2. **Configure Ollama CORS**
   To allow the web UI to talk to Ollama, you must set the `OLLAMA_ORIGINS` environment variable:
   ```powershell
   # Windows PowerShell
   $env:OLLAMA_ORIGINS="*"; ollama serve
   ```

3. **Run the App**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000)

## 🛠️ Tech Stack
- **Frontend**: React 19, Vite, Tailwind CSS (Vanilla CSS components)
- **Icons**: Lucide React
- **Animations**: Motion (framer-motion)
- **Backend**: Express + TSX

---
*Created with ❤️ by Antigravity*
