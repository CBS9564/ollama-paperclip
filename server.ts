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
    console.log(`[PROXY] Request: "${req.body.prompt?.slice(0, 50)}..."`);
    
    try {
      const response = await fetch("http://192.168.1.106:5000/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });

      // Forward headers from VM to client
      response.headers.forEach((value, key) => {
        // Skip some headers that might interfere with compression or transfer
        if (['content-encoding', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) return;
        res.setHeader(key, value);
      });
      
      res.status(response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[PROXY] VM Error ${response.status}:`, errorText);
        // If it's already application/json, we just sent the header above
        return res.send(errorText);
      }

      if (!response.body) {
        return res.end();
      }

      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      
      const duration = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[PROXY] Success in ${duration}s`);
      res.end();
    } catch (error: any) {
      console.error("[PROXY] Fatal Error:", error.message);
      if (!res.headersSent) {
        res.status(500).json({ error: "Proxy Error", details: error.message });
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
