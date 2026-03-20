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
   * Initiates a streaming chat request to Ollama.
   * @param model - The name of the model to use (e.g., 'llama3').
   * @param messages - The message history including the current user prompt.
   * @param onChunk - Callback function triggered for each received text fragment.
   * @param systemPrompt - Optional system instructions to guide the model's persona.
   * @param signal - Optional AbortSignal to cancel the request.
   */
  async chat(model: string, messages: Message[], onChunk: (chunk: string) => void, systemPrompt?: string, signal?: AbortSignal): Promise<void> {
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
        }),
        signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
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

  async checkConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
