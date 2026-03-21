import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "data.json");

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API Routes
  app.get("/api/data", async (req, res) => {
    try {
      const data = await fs.readFile(DATA_FILE, "utf-8");
      res.json(JSON.parse(data));
    } catch (error) {
      // If file doesn't exist, return default empty state
      res.json({ sessions: [], settings: { baseUrl: 'http://localhost:11434', selectedModel: '', isAgentMode: false } });
    }
  });

  app.post("/api/data", async (req, res) => {
    try {
      await fs.writeFile(DATA_FILE, JSON.stringify(req.body, null, 2));
      res.json({ status: "ok" });
    } catch (error) {
      console.error("Error saving data:", error);
      res.status(500).json({ error: "Failed to save data" });
    }
  });

  // Image Generation Proxy
  app.post("/api/generate-image", async (req, res) => {
    const start = Date.now();
    console.log(`[PROXY] Starting streaming image generation for prompt: "${req.body.prompt?.slice(0, 50)}..."`);
    
    try {
      const response = await fetch("http://192.168.1.106:5000/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
      
      console.log(`[PROXY] VM Response Status: ${response.status}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        return res.status(response.status).json({ error: `VM returned ${response.status}`, details: errorText });
      }

      // Set headers for SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      if (!response.body) {
        throw new Error("No response body from VM");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      
      const duration = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[PROXY] Streaming completed in ${duration}s`);
      res.end();
    } catch (error: any) {
      console.error("[PROXY] Connection Error:", error.message);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to connect to Image VM", details: error.message });
      } else {
        res.end();
      }
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
