import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, 
  Settings, 
  MessageSquare, 
  Trash2, 
  Send, 
  Cpu, 
  ChevronLeft, 
  ChevronRight,
  Monitor,
  RefreshCw,
  CheckCircle2,
  XCircle,
  LayoutGrid,
  ListTodo,
  PlayCircle,
  CheckCircle,
  Circle,
  Clock,
  Sparkles,
  UserPlus,
  Users,
  Play,
  AlertCircle,
  Square
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from './lib/utils';
import { Message, ChatSession, OllamaModel, OllamaSettings, Task, TaskStatus, Agent } from './types';
import { OllamaService } from './services/ollama';

export default function App() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [view, setView] = useState<'chat' | 'tasks' | 'agents'>('chat');
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [settings, setSettings] = useState<OllamaSettings>({
    baseUrl: 'http://localhost:11434',
    selectedModel: '',
    isAgentMode: false,
  });
  const [isConnected, setIsConnected] = useState<boolean | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const isExecutingTaskRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const ollama = new OllamaService(settings.baseUrl);

  // Load data
  useEffect(() => {
    const loadData = async () => {
      try {
        const response = await fetch('/api/data');
        if (response.ok) {
          const data = await response.json();
          if (data.sessions) {
            setSessions(data.sessions);
            if (data.sessions.length > 0) setCurrentSessionId(data.sessions[0].id);
          }
          if (data.settings) {
            setSettings(data.settings);
          }
        }
      } catch (error) {
        console.error('Failed to load data from server:', error);
      }
    };
    loadData();
  }, []);

  // Save data to server
  const saveData = async (currentSessions: ChatSession[], currentSettings: OllamaSettings) => {
    try {
      await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessions: currentSessions, settings: currentSettings }),
      });
    } catch (error) {
      console.error('Failed to save data to server:', error);
    }
  };

  // Auto-save on changes
  useEffect(() => {
    const timer = setTimeout(() => {
      saveData(sessions, settings);
    }, 1000); // Debounce save
    return () => clearTimeout(timer);
  }, [sessions, settings]);

  useEffect(() => {
    checkConnection();
  }, [settings.baseUrl]);

  const checkConnection = async () => {
    const connected = await ollama.checkConnection();
    setIsConnected(connected);
    if (connected) {
      const modelList = await ollama.listModels();
      setModels(modelList);
      if (modelList.length > 0 && !settings.selectedModel) {
        setSettings(prev => ({ ...prev, selectedModel: modelList[0].name }));
      }
    }
  };

  const currentSession = sessions.find(s => s.id === currentSessionId);

  const createNewSession = () => {
    const newSession: ChatSession = {
      id: crypto.randomUUID(),
      title: 'New Project',
      messages: [],
      tasks: [],
      agents: [
        {
          id: 'orchestrator',
          name: 'Orchestrator',
          model: settings.selectedModel,
          systemPrompt: 'You are a Multi-Agent Orchestrator (inspired by erukude/multiagent-orchestrator). Your goal is to manage a team of specialized agents to solve complex user requests.\n\n' +
            'STRUCTURED OUTPUT RULES:\n' +
            '1. CLASSIFY: Identify the domains involved.\n' +
            '2. PROVISION: Define needed specialized agents using: [AGENT: Name | System Prompt]\n' +
            '3. PLAN: Break down the request into sequential tasks using: [TASK: Title | Agent Name]\n\n' +
            'Example:\n' +
            '[AGENT: DataAnalyst | You are a data scientist...]\n' +
            '[AGENT: Reporter | You are a technical writer...]\n' +
            '[TASK: Extract statistics from CSV | DataAnalyst]\n' +
            '[TASK: Generate executive summary | Reporter]',
          color: '#10b981'
        }
      ],
      model: settings.selectedModel,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setSessions([newSession, ...sessions]);
    setCurrentSessionId(newSession.id);
    setShowSettings(false);
    setView('chat');
    return newSession;
  };

  const deleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSessions = sessions.filter(s => s.id !== id);
    setSessions(newSessions);
    if (currentSessionId === id) {
      setCurrentSessionId(newSessions.length > 0 ? newSessions[0].id : null);
    }
  };

  /**
   * Extracts agent definitions from raw text using [AGENT: Name | Prompt] format.
   * Resilient to multi-line content and missing separators.
   */
  const parseAgentsFromContent = (content: string): { name: string, prompt: string }[] => {
    const agentRegex = /\[AGENT:\s*([\s\S]*?)(?:\s*\|\s*([\s\S]*?))?\]/gi;
    const matches = [...content.matchAll(agentRegex)];
    return matches.map(m => ({ name: m[1].trim(), prompt: m[2]?.trim() || 'You are a helpful AI assistant.' }));
  };

  /**
   * Extracts task definitions from raw text using [TASK: Title | Agent] format.
   * Supports optional agent assignment and case-insensitive tags.
   */
  const parseTasksFromContent = (content: string): { title: string, agentName: string }[] => {
    const taskRegex = /\[TASK:\s*([\s\S]*?)(?:\s*\|\s*([\s\S]*?))?\]/gi;
    const matches = [...content.matchAll(taskRegex)];
    return matches.map(m => ({ title: m[1].trim(), agentName: m[2]?.trim() || '' }));
  };

  /**
   * Aborts the current LLM generation or task execution.
   */
  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    isExecutingTaskRef.current = false;
  };

  /**
   * Orchestrates the primary chat flow. 
   * In Agent Mode, it also triggers the parsing of agents and tasks from the output.
   */
  const handleSend = async () => {
    if (isLoading) {
      handleStop();
      return;
    }
    if (!input.trim() || !settings.selectedModel) return;

    setIsLoading(true);
    abortControllerRef.current = new AbortController();

    let targetSessionId = currentSessionId;
    let targetSession = sessions.find(s => s.id === targetSessionId);
    
    // If no session found, or no session selected, create a new one as part of the initial state update
    const isNewSession = !targetSessionId || !targetSession;
    let tempNewSession: ChatSession | null = null;
    if (isNewSession) {
      tempNewSession = createNewSession();
      targetSessionId = tempNewSession.id;
      targetSession = tempNewSession;
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };

    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };

    setSessions(prev => {
      // Find session in the latest state
      const target = prev.find(s => s.id === targetSessionId);
      
      if (target) {
        return prev.map(s => s.id === targetSessionId ? {
          ...s,
          messages: [...s.messages, userMessage, assistantMessage],
          updatedAt: Date.now(),
          title: s.messages.length === 0 ? input.slice(0, 30) : s.title
        } : s);
      } else if (tempNewSession) {
        // Just in case it wasn't in prev yet (though createNewSession already added it to sessions state, 
        // but that update might not have landed yet).
        return [{
          ...tempNewSession,
          messages: [userMessage, assistantMessage],
          title: input.slice(0, 30)
        }, ...prev];
      }
      return prev;
    });

    setInput('');

    const orchestrator = targetSession?.agents.find(a => a.id === 'orchestrator');
    const systemPrompt = settings.isAgentMode ? orchestrator?.systemPrompt : undefined;
    
    let lastUpdateTime = Date.now();
    let accumulatedContent = '';

    try {
      await ollama.chat(settings.selectedModel, [...(targetSession?.messages || []), userMessage], (chunk) => {
        accumulatedContent += chunk;
        
        const now = Date.now();
        if (now - lastUpdateTime > 100) { // Throttle updates to 10fps
          lastUpdateTime = now;
          updateAssistantMessage(targetSessionId!, accumulatedContent);
        }
      }, systemPrompt, abortControllerRef.current.signal);
      
      // Final update to ensure everything is captured
      updateAssistantMessage(targetSessionId!, accumulatedContent);
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Generation aborted by user');
      } else {
        console.error(error);
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  const updateAssistantMessage = (sessionId: string, fullContent: string) => {
    setSessions(prev => prev.map(s => {
      if (s.id === sessionId) {
        const messages = [...s.messages];
        if (messages.length > 0) {
          const lastMsg = messages[messages.length - 1];
          messages[messages.length - 1] = { ...lastMsg, content: fullContent };
        }

        if (settings.isAgentMode) {
          const suggestedAgents = parseAgentsFromContent(fullContent);
          const suggestedTasks = parseTasksFromContent(fullContent);
          
          let updatedAgents = [...s.agents];
          let updatedTasks = [...s.tasks];
          const colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#ef4444'];
          
          suggestedAgents.forEach(suggested => {
            const agentName = suggested.name.trim();
            if (!updatedAgents.find(a => a.name.toLowerCase() === agentName.toLowerCase())) {
              updatedAgents.push({
                id: crypto.randomUUID(),
                name: agentName,
                model: settings.selectedModel,
                systemPrompt: suggested.prompt,
                color: colors[updatedAgents.length % colors.length]
              });

              // Add agent creation task assigned to orchestrator
              const agentCreationTaskTitle = `(Setup) Initialize Agent: ${agentName}`;
              if (!updatedTasks.find(t => t.title === agentCreationTaskTitle)) {
                updatedTasks.push({
                  id: crypto.randomUUID(),
                  title: agentCreationTaskTitle,
                  status: 'todo' as TaskStatus,
                  createdAt: Date.now(),
                  agentId: 'orchestrator'
                });
              }
            }
          });

          const existingTaskTitles = updatedTasks.map(t => t.title);
          const newTasks = suggestedTasks
            .filter(st => !existingTaskTitles.includes(st.title.trim()))
            .map(st => {
              const agentName = st.agentName.trim().toLowerCase();
              const assignedAgent = updatedAgents.find(a => a.name.toLowerCase() === agentName);
              return {
                id: crypto.randomUUID(),
                title: st.title.trim(),
                status: 'todo' as TaskStatus,
                createdAt: Date.now(),
                agentId: assignedAgent?.id || 'orchestrator' // Fallback to orchestrator if unassigned
              };
            });

          return {
            ...s,
            messages,
            agents: updatedAgents,
            tasks: [...updatedTasks, ...newTasks]
          };
        }

        return { ...s, messages };
      }
      return s;
    }));
  };


  // Effect to continue running tasks if we are in agent mode
  useEffect(() => {
    if (settings.isAgentMode && !isLoading && currentSessionId) {
      const pendingTask = currentSession?.tasks.find(t => t.status === 'todo');
      if (pendingTask) {
        executeTask(pendingTask);
      } else if (currentSession?.tasks.length > 0 && currentSession.tasks.every(t => t.status === 'done' || t.status === 'failed')) {
        // All tasks done, maybe orchestrator should summarize?
        // For now, just stop.
      }
    }
  }, [sessions, settings.isAgentMode, isLoading, currentSessionId]);


  const toggleTaskStatus = (sessionId: string, taskId: string) => {
    setSessions(prev => prev.map(s => {
      if (s.id === sessionId) {
        return {
          ...s,
          tasks: s.tasks.map(t => {
            if (t.id === taskId) {
              const nextStatus: Record<TaskStatus, TaskStatus> = {
                'todo': 'in-progress',
                'in-progress': 'done',
                'done': 'todo',
                'failed': 'todo'
              };
              return { 
                ...t, 
                status: nextStatus[t.status],
                completedAt: nextStatus[t.status] === 'done' ? Date.now() : undefined
              };
            }
            return t;
          })
        };
      }
      return s;
    }));
  };

  const addAgent = () => {
    if (!currentSessionId) return;
    const colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#ef4444'];
    const newAgent: Agent = {
      id: crypto.randomUUID(),
      name: `Agent ${currentSession?.agents.length || 0}`,
      model: settings.selectedModel,
      systemPrompt: 'You are a helpful AI assistant.',
      color: colors[(currentSession?.agents.length || 0) % colors.length]
    };

    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId) {
        return { ...s, agents: [...(s.agents || []), newAgent] };
      }
      return s;
    }));
  };

  const updateAgent = (agentId: string, updates: Partial<Agent>) => {
    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId) {
        return {
          ...s,
          agents: s.agents.map(a => a.id === agentId ? { ...a, ...updates } : a)
        };
      }
      return s;
    }));
  };

  const deleteAgent = (agentId: string) => {
    if (agentId === 'orchestrator') return;
    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId) {
        return {
          ...s,
          agents: s.agents.filter(a => a.id !== agentId),
          tasks: s.tasks.map(t => t.agentId === agentId ? { ...t, agentId: undefined } : t)
        };
      }
      return s;
    }));
  };

  const assignAgentToTask = (taskId: string, agentId: string | undefined) => {
    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId) {
        return {
          ...s,
          tasks: s.tasks.map(t => t.id === taskId ? { ...t, agentId } : t)
        };
      }
      return s;
    }));
  };

  /**
   * Executes a specific task using its assigned agent's persona.
   * Injects results of previous successful tasks as context.
   */
  const executeTask = async (task: Task) => {
    if (!currentSessionId || isExecutingTaskRef.current) return;
    
    const agent = currentSession?.agents.find(a => a.id === task.agentId) || 
                  currentSession?.agents.find(a => a.id === 'orchestrator');
    
    if (!agent) return;

    isExecutingTaskRef.current = true;
    setIsLoading(true);
    abortControllerRef.current = new AbortController();
    
    // Update task status to in-progress
    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId) {
        return {
          ...s,
          tasks: s.tasks.map(t => t.id === task.id ? { ...t, status: 'in-progress' } : t)
        };
      }
      return s;
    }));

    try {
      let fullResult = '';
      
      // Get results of previous tasks for context
      const previousResults = currentSession?.tasks
        .filter(t => t.status === 'done' && t.result)
        .map(t => `Task: ${t.title}\nResult: ${t.result}`)
        .join('\n\n');

      const isSetupTask = task.title.startsWith('(Setup) Initialize Agent:');
      const prompt = isSetupTask 
        ? `TASK: ${task.title}\n\nPlease confirm that you have initialized the agent described. Briefly state its specialized role.`
        : `CONTEXT OF COMPLETED TASKS:\n${previousResults || 'No tasks completed yet.'}\n\nCURRENT TASK TO EXECUTE:\n${task.title}\n\nPlease execute this task and provide the result based on the context above if relevant.`;
      
      const modelToUse = agent.model || settings.selectedModel;
      
      let lastUpdateTime = Date.now();

      await ollama.chat(modelToUse, [{ id: '1', role: 'user', content: prompt, timestamp: Date.now() }], (chunk) => {
        fullResult += chunk;

        const now = Date.now();
        if (now - lastUpdateTime > 100) {
          lastUpdateTime = now;
          setSessions(prev => prev.map(s => {
            if (s.id === currentSessionId) {
              return {
                ...s,
                tasks: s.tasks.map(t => t.id === task.id ? { ...t, result: fullResult } : t)
              };
            }
            return s;
          }));
        }
      }, agent.systemPrompt, abortControllerRef.current.signal);

      // Final update
      setSessions(prev => prev.map(s => {
        if (s.id === currentSessionId) {
          return {
            ...s,
            tasks: s.tasks.map(t => t.id === task.id ? { ...t, result: fullResult } : t)
          };
        }
        return s;
      }));

      // Mark as done
      setSessions(prev => prev.map(s => {
        if (s.id === currentSessionId) {
          return {
            ...s,
            tasks: s.tasks.map(t => t.id === task.id ? { ...t, status: 'done', completedAt: Date.now() } : t)
          };
        }
        return s;
      }));
    } catch (error: any) {
      if (error.name === 'AbortError') {
        setSessions(prev => prev.map(s => {
          if (s.id === currentSessionId) {
            return {
              ...s,
              tasks: s.tasks.map(t => t.id === task.id ? { ...t, status: 'failed', result: (t.result || '') + '\n\n**[Stopped by User]**' } : t)
            };
          }
          return s;
        }));
      } else {
        console.error('Task execution failed:', error);
        setSessions(prev => prev.map(s => {
          if (s.id === currentSessionId) {
            return {
              ...s,
              tasks: s.tasks.map(t => t.id === task.id ? { ...t, status: 'failed', result: String(error) } : t)
            };
          }
          return s;
        }));
      }
    } finally {
      isExecutingTaskRef.current = false;
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [currentSession?.messages]);

  return (
    <div className="flex h-screen w-full bg-[#fdfdfd] overflow-hidden">
      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ width: isSidebarOpen ? 260 : 0 }}
        className={cn(
          "bg-[#f7f7f7] border-r border-black/5 flex flex-col relative",
          !isSidebarOpen && "border-none"
        )}
      >
        <div className="p-4 flex flex-col h-full overflow-hidden">
          <button 
            onClick={createNewSession}
            className="flex items-center gap-2 w-full p-2 rounded-lg border border-black/5 bg-white hover:bg-black/5 transition-colors text-sm font-medium mb-6"
          >
            <Plus size={16} />
            New Project
          </button>

          <div className="flex-1 overflow-y-auto space-y-1 pr-2 custom-scrollbar">
            <div className="text-[10px] font-bold text-black/30 uppercase tracking-widest mb-2 px-2">Projects</div>
            {sessions.map(session => (
              <div
                key={session.id}
                onClick={() => {
                  setCurrentSessionId(session.id);
                  setShowSettings(false);
                }}
                className={cn(
                  "group flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-all text-sm",
                  currentSessionId === session.id ? "bg-black/5 font-medium" : "hover:bg-black/[0.02] text-black/60"
                )}
              >
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/40" />
                <span className="truncate flex-1">{session.title}</span>
                <button 
                  onClick={(e) => deleteSession(session.id, e)}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 transition-all"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-auto pt-4 border-t border-black/5 space-y-1">
            <button 
              onClick={() => setShowSettings(!showSettings)}
              className={cn(
                "flex items-center gap-2 w-full p-2 rounded-lg transition-colors text-sm",
                showSettings ? "bg-black/5" : "hover:bg-black/5"
              )}
            >
              <Settings size={16} />
              Settings
            </button>
          </div>
        </div>

        <button 
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-white border border-black/5 rounded-full flex items-center justify-center shadow-sm z-10 hover:bg-black/5 transition-colors"
        >
          {isSidebarOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </button>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative min-w-0">
        {/* Header */}
        <header className="h-14 border-b border-black/5 flex items-center justify-between px-6 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
          <div className="flex items-center gap-3">
            {!isSidebarOpen && (
              <button onClick={() => setIsSidebarOpen(true)} className="p-1 hover:bg-black/5 rounded mr-2">
                <ChevronRight size={18} />
              </button>
            )}
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setView('chat')}
                className={cn(
                  "flex items-center gap-2 text-sm font-medium transition-colors",
                  view === 'chat' ? "text-black" : "text-black/40 hover:text-black/60"
                )}
              >
                <MessageSquare size={16} />
                Chat
              </button>
              <button 
                onClick={() => setView('tasks')}
                className={cn(
                  "flex items-center gap-2 text-sm font-medium transition-colors",
                  view === 'tasks' ? "text-black" : "text-black/40 hover:text-black/60"
                )}
              >
                <ListTodo size={16} />
                Tasks
                {currentSession?.tasks.length ? (
                  <span className="bg-black/5 px-1.5 py-0.5 rounded-full text-[10px]">
                    {currentSession.tasks.filter(t => t.status === 'done').length}/{currentSession.tasks.length}
                  </span>
                ) : null}
              </button>
              <button 
                onClick={() => setView('agents')}
                className={cn(
                  "flex items-center gap-2 text-sm font-medium transition-colors",
                  view === 'agents' ? "text-black" : "text-black/40 hover:text-black/60"
                )}
              >
                <Users size={16} />
                Agents
                {currentSession?.agents.length ? (
                  <span className="bg-black/5 px-1.5 py-0.5 rounded-full text-[10px]">
                    {currentSession.agents.length}
                  </span>
                ) : null}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4">
             <div className="flex items-center gap-1.5">
                {isConnected === true ? (
                  <div className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium uppercase tracking-wider">
                    <CheckCircle2 size={12} />
                    Ollama Online
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-[10px] text-red-500 font-medium uppercase tracking-wider">
                    <XCircle size={12} />
                    Ollama Offline
                  </div>
                )}
             </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {showSettings ? (
            <div className="flex-1 p-8 max-w-2xl mx-auto w-full">
              <h2 className="text-xl font-semibold mb-8">Settings</h2>
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-black/60 uppercase tracking-wider">Ollama Server URL</label>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      value={settings.baseUrl}
                      onChange={(e) => setSettings(prev => ({ ...prev, baseUrl: e.target.value }))}
                      className="flex-1 p-2 rounded-lg border border-black/10 bg-white text-sm focus:outline-none"
                      placeholder="http://localhost:11434"
                    />
                    <button 
                      onClick={checkConnection}
                      className="p-2 rounded-lg bg-black text-white hover:bg-black/80 transition-colors"
                      title="Refresh Connection"
                    >
                      <RefreshCw size={16} className={cn(isConnected === null && "animate-spin")} />
                    </button>
                  </div>
                  {isConnected === false && (
                    <div className="p-3 rounded-lg bg-red-50 border border-red-100 space-y-2">
                      <p className="text-[10px] text-red-600 font-medium">Impossible de contacter Ollama.</p>
                      <ul className="text-[9px] text-red-500 list-disc ml-3 space-y-1">
                        <li>Vérifie qu'Ollama est lancé.</li>
                        <li><strong>CORS :</strong> Lance Ollama avec <code>OLLAMA_ORIGINS="*" ollama serve</code></li>
                        <li><strong>Mixed Content :</strong> Ton navigateur peut bloquer HTTPS vers HTTP. Essaie d'accéder à <a href={settings.baseUrl} target="_blank" className="underline">cette URL</a> manuellement pour "autoriser" le certificat ou le contenu non sécurisé.</li>
                      </ul>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-black/60 uppercase tracking-wider">Select Model</label>
                  <select 
                    value={settings.selectedModel}
                    onChange={(e) => setSettings(prev => ({ ...prev, selectedModel: e.target.value }))}
                    className="w-full p-2 rounded-lg border border-black/10 bg-white text-sm appearance-none"
                  >
                    {models.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                  </select>
                </div>
                <button onClick={() => setShowSettings(false)} className="w-full p-2 rounded-lg bg-black text-white font-medium text-sm">Save</button>
              </div>
            </div>
          ) : view === 'agents' ? (
            <div className="flex-1 p-8 overflow-y-auto custom-scrollbar">
              <div className="max-w-4xl mx-auto">
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h2 className="text-2xl font-semibold">Agents</h2>
                    <p className="text-sm text-black/40 mt-1">Specialized agents created automatically for this project.</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  {currentSession?.agents.map(agent => (
                    <div key={agent.id} className="p-6 rounded-2xl bg-white border border-black/5 shadow-sm space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold" style={{ backgroundColor: agent.color }}>
                            {agent.name[0]}
                          </div>
                          <div>
                            <input 
                              type="text" 
                              value={agent.name}
                              onChange={(e) => updateAgent(agent.id, { name: e.target.value })}
                              className="text-lg font-semibold bg-transparent border-none focus:ring-0 p-0 w-full"
                            />
                            <div className="flex items-center gap-2 mt-1">
                              <Cpu size={12} className="text-black/40" />
                              <select 
                                value={agent.model}
                                onChange={(e) => updateAgent(agent.id, { model: e.target.value })}
                                className="text-[10px] font-bold uppercase tracking-wider text-black/40 bg-transparent border-none p-0 focus:ring-0"
                              >
                                {models.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                              </select>
                            </div>
                          </div>
                        </div>
                        {agent.id !== 'orchestrator' && (
                          <button 
                            onClick={() => deleteAgent(agent.id)}
                            className="p-2 text-black/20 hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={18} />
                          </button>
                        )}
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-black/30 uppercase tracking-widest">System Prompt</label>
                        <textarea 
                          value={agent.systemPrompt}
                          onChange={(e) => updateAgent(agent.id, { systemPrompt: e.target.value })}
                          rows={3}
                          className="w-full p-3 rounded-xl bg-black/[0.02] border border-black/5 text-sm focus:outline-none focus:border-black/10 transition-colors resize-none"
                          placeholder="Define the agent's behavior..."
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : view === 'tasks' ? (
            <div className="flex-1 p-8 overflow-y-auto custom-scrollbar">
              <div className="max-w-4xl mx-auto">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-2xl font-semibold">Project Tasks</h2>
                  <div className="flex gap-2">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/5 text-xs font-medium">
                      <Clock size={14} />
                      {currentSession?.tasks.filter(t => t.status !== 'done').length} Pending
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {['todo', 'in-progress', 'done'].map((status) => (
                    <div key={status} className="space-y-4">
                      <div className="flex items-center justify-between px-2">
                        <h3 className="text-xs font-bold uppercase tracking-widest text-black/40">{status}</h3>
                        <span className="text-[10px] font-bold text-black/20">
                          {currentSession?.tasks.filter(t => t.status === status).length || 0}
                        </span>
                      </div>
                      <div className="space-y-3">
                        {currentSession?.tasks
                          .filter(t => t.status === status)
                          .map(task => (
                            <motion.div 
                              layoutId={task.id}
                              key={task.id}
                              className="p-4 rounded-xl bg-white border border-black/5 shadow-sm hover:border-black/20 transition-all group"
                            >
                              <div className="flex items-start gap-3 mb-3">
                                <button 
                                  onClick={() => toggleTaskStatus(currentSession.id, task.id)}
                                  className="mt-0.5"
                                >
                                  {task.status === 'done' ? (
                                    <CheckCircle size={16} className="text-emerald-500" />
                                  ) : task.status === 'in-progress' ? (
                                    <PlayCircle size={16} className="text-blue-500" />
                                  ) : task.status === 'failed' ? (
                                    <AlertCircle size={16} className="text-red-500" />
                                  ) : (
                                    <Circle size={16} className="text-black/10" />
                                  )}
                                </button>
                                <div className="flex-1 min-w-0">
                                  <p className={cn(
                                    "text-sm leading-tight font-medium",
                                    task.status === 'done' && "line-through text-black/30"
                                  )}>
                                    {task.title}
                                  </p>
                                </div>
                                {task.status !== 'done' && (
                                  <button 
                                    onClick={() => executeTask(task)}
                                    disabled={isExecutingTaskRef.current || task.status === 'in-progress'}
                                    className="p-1.5 rounded-lg bg-black/5 hover:bg-black text-black/40 hover:text-white transition-all disabled:opacity-50"
                                    title="Execute Task"
                                  >
                                    <Play size={12} />
                                  </button>
                                )}
                              </div>

                              <div className="flex items-center justify-between pt-3 border-t border-black/[0.03]">
                                <div className="flex items-center gap-2">
                                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: currentSession.agents.find(a => a.id === task.agentId)?.color || '#e5e7eb' }} />
                                  <select 
                                    value={task.agentId || ''}
                                    onChange={(e) => assignAgentToTask(task.id, e.target.value || undefined)}
                                    className="text-[10px] font-bold text-black/40 bg-transparent border-none p-0 focus:ring-0 uppercase tracking-wider"
                                  >
                                    <option value="">Unassigned</option>
                                    {currentSession.agents.map(a => (
                                      <option key={a.id} value={a.id}>{a.name}</option>
                                    ))}
                                  </select>
                                </div>
                                {task.completedAt && (
                                  <span className="text-[9px] text-black/20 font-medium">
                                    {new Date(task.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                )}
                              </div>

                              {task.result && (
                                <div className="mt-3 p-3 rounded-lg bg-black/[0.02] border border-black/5 text-[11px] text-black/60 max-h-32 overflow-y-auto custom-scrollbar">
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.result}</ReactMarkdown>
                                </div>
                              )}
                            </motion.div>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
                {!currentSession || currentSession.messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-6 max-w-md mx-auto">
                    <div className="w-16 h-16 rounded-3xl bg-black/5 flex items-center justify-center">
                      <Sparkles size={32} className="text-black/20" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold">What are we building?</h3>
                      <p className="text-sm text-black/40 mt-1">
                        {settings.isAgentMode 
                          ? "Describe your goal, and I'll orchestrate the agents to get it done." 
                          : "Activate Agent Mode to automatically generate specialized agents and tasks for your project."}
                      </p>
                    </div>
                  </div>
                ) : (
                  currentSession.messages.map((message) => (
                    <div key={message.id} className={cn("max-w-3xl mx-auto flex gap-4", message.role === 'user' ? "flex-row-reverse" : "flex-row")}>
                      <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold", message.role === 'user' ? "bg-black text-white" : "bg-emerald-100 text-emerald-700")}>
                        {message.role === 'user' ? 'U' : 'AI'}
                      </div>
                      <div className={cn("flex-1 px-4 py-2 rounded-2xl text-sm leading-relaxed", message.role === 'user' ? "bg-black/5 text-black" : "bg-transparent")}>
                        <div className="markdown-body">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  ))
                )}
                {isLoading && (
                  <div className="max-w-3xl mx-auto flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 text-[10px] font-bold">AI</div>
                    <div className="flex items-center gap-1">
                      <div className="w-1.5 h-1.5 bg-black/20 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-1.5 h-1.5 bg-black/20 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-1.5 h-1.5 bg-black/20 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                )}
              </div>

              <div className="p-6">
                <div className="max-w-3xl mx-auto">
                  <div className="flex items-center gap-4 mb-3">
                    <button 
                      onClick={() => setSettings(prev => ({ ...prev, isAgentMode: !prev.isAgentMode }))}
                      className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all",
                        settings.isAgentMode ? "bg-emerald-500 text-white" : "bg-black/5 text-black/40 hover:bg-black/10"
                      )}
                    >
                      <Sparkles size={12} />
                      Agent Mode {settings.isAgentMode ? 'ON' : 'OFF'}
                    </button>
                    {settings.isAgentMode && (
                      <span className="text-[10px] text-emerald-600 font-medium animate-pulse">
                        Ready to orchestrate tasks...
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <textarea
                      rows={1}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                      placeholder={settings.isAgentMode ? "Describe a goal to generate tasks..." : "Message Paperclip..."}
                      className="w-full p-4 pr-12 rounded-2xl border border-black/10 bg-white shadow-sm focus:outline-none resize-none text-sm"
                    />
                    <button 
                      onClick={isLoading ? handleStop : handleSend} 
                      disabled={!isLoading && !input.trim()} 
                      className={cn(
                        "absolute right-3 bottom-3 p-2 rounded-xl transition-all",
                        isLoading ? "bg-red-500 text-white hover:bg-red-600" : "bg-black text-white hover:bg-black/80 disabled:opacity-20"
                      )}
                    >
                      {isLoading ? <Square size={16} fill="currentColor" /> : <Send size={16} />}
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </main>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.05); border-radius: 10px; }
      `}} />
    </div>
  );
}
