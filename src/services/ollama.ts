import { OllamaModel, Message } from '../types';

/**
 * Service to interact with a local Ollama instance.
 * Handles model listing, streaming chat, and connection health checks.
 */
export class OllamaService {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:11434') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /**
   * Fetches the list of available models from the Ollama server.
   * @returns A promise that resolves to an array of OllamaModel objects.
   */
  async listModels(): Promise<OllamaModel[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        mode: 'cors',
        headers: { 'Accept': 'application/json' }
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      console.log('Ollama models loaded:', data.models);
      return data.models || [];
    } catch (error) {
      console.error('Ollama listModels error:', error);
      throw error; // Re-throw to handle in UI
    }
  }

  /**
   * Retrieves the list of models currently loaded in Ollama's memory.
   * @returns A promise that resolves to an array of model names.
   */
  async getLoadedModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/ps`, {
        mode: 'cors',
        headers: { 'Accept': 'application/json' }
      });
      if (!response.ok) return [];
      const data = await response.json();
      return (data.models || []).map((m: any) => m.name);
    } catch (e) {
      return [];
    }
  }

  /**
   * Initiates a streaming chat request to Ollama.
   * @param model - The name of the model to use (e.g., 'llama3').
   * @param messages - The message history including the current user prompt.
   * @param onChunk - Callback function triggered for each received text fragment.
   * @param systemPrompt - Optional system instructions to guide the model's persona.
   * @param signal - Optional AbortSignal to cancel the request.
   * @param options - Optional advanced parameters like temperature and context size.
   */
  async chat(model: string, messages: Message[], onChunk: (chunk: string) => void, systemPrompt?: string, signal?: AbortSignal, options?: { temperature?: number, num_ctx?: number }): Promise<void> {
    const formattedMessages = messages.map(({ role, content }) => ({ role, content }));
    
    if (systemPrompt) {
      formattedMessages.unshift({ role: 'system', content: systemPrompt });
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: formattedMessages,
          stream: true,
          options
        }),
        signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (errorData.error?.includes('does not support chat')) {
          console.warn(`Model ${model} does not support /api/chat. Falling back to /api/generate.`);
          return this.generateFallback(model, messages, onChunk, systemPrompt, signal, options);
        }
        throw new Error(errorData.error || `Failed to communicate with Ollama (${response.status})`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);
            if (json.message?.content) {
              onChunk(json.message.content);
            }
            if (json.done) return;
          } catch (e) {
            console.error('Error parsing JSON chunk:', e);
          }
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      throw error;
    }
  }

  /**
   * Generates an image using a backend proxy.
   * @param prompt The text prompt for image generation.
   * @returns A promise that resolves to an object containing the image URL and the prompt used.
   */
  async generateImage(prompt: string): Promise<{ url: string, prompt_used: string }> {
    const response = await fetch("/api/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });
    
    if (!response.ok) {
      throw new Error(`Image generation failed: ${response.statusText}`);
    }
    
    return await response.json();
  }

  /**
   * Private helper for models that don't support the /api/chat endpoint.
   * Flattens history and uses /api/generate.
   */
  private async generateFallback(model: string, messages: Message[], onChunk: (chunk: string) => void, systemPrompt?: string, signal?: AbortSignal, options?: any): Promise<void> {
    // Flatten messages into a single prompt string
    let prompt = systemPrompt ? `System: ${systemPrompt}\n\n` : '';
    prompt += messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
    prompt += '\n\nASSISTANT:';

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          stream: true,
          options
        }),
        signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(`Ollama generate error: ${response.status} - ${err.error || ''}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body for /api/generate');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);
            
            if (json.response) {
              onChunk(json.response);
            }
            
            // Handle experimental text-to-image base64 payloads
            if (json.image && typeof json.image === 'string') {
              onChunk(`\n\n![Generated Image](data:image/png;base64,${json.image})\n\n`);
            }
            if (json.images && Array.isArray(json.images)) {
              json.images.forEach((imgBase64: string) => {
                onChunk(`\n\n![Generated Image](data:image/png;base64,${imgBase64})\n\n`);
              });
            }

            if (json.done) return;
          } catch (e) {
            console.error('Error parsing JSON chunk from /api/generate:', e);
          }
        }
      }
    } catch (error) {
      console.error('Generate fallback error:', error);
      throw error;
    }
  }

  async checkConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  private pullAbortController: AbortController | null = null;

  /**
   * Pulls a new model from the Ollama registry (e.g., 'llama3').
   * Emits progress updates via a callback.
   */
  async pullModel(model: string, onProgress: (progress: import('../types').PullProgress) => void): Promise<void> {
    this.pullAbortController = new AbortController();
    
    try {
      const response = await fetch(`${this.baseUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model, stream: true }),
        signal: this.pullAbortController.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to pull model (${response.status})`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);
            onProgress(json);
            if (json.status === 'success') {
              this.pullAbortController = null;
              return;
            }
          } catch (e) {
            console.error('Error parsing JSON chunk during pull:', e);
          }
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Model pull aborted by user');
      } else {
        console.error('Pull model error:', error);
        throw error;
      }
    } finally {
      this.pullAbortController = null;
    }
  }

  /**
   * Aborts an ongoing model pull operation.
   */
  abortPull() {
    if (this.pullAbortController) {
      this.pullAbortController.abort();
      this.pullAbortController = null;
    }
  }

  /**
   * Deletes a model from the local Ollama instance.
   */
  async deleteModel(model: string): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to delete model (${response.status})`);
      }
    } catch (error) {
      console.error('Delete model error:', error);
      throw error;
    }
  }
}
