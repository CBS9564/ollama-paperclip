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
  ChevronDown,
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
  Square,
  Download,
  HardDrive
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from './lib/utils';
import { Message, ChatSession, OllamaModel, OllamaSettings, Task, TaskStatus, Agent } from './types';
import { OllamaService } from './services/ollama';

/**
 * Extracts agent definitions from raw text using [AGENT: Name | Prompt] format.
 * Resilient to multi-line content and missing separators.
 */
const parseAgentsFromContent = (content: string): { name: string, prompt: string, model?: string, temperature?: number, num_ctx?: number }[] => {
  // Use [^|\]]+ to capture properties between pipes and closing brackets.
  const agentRegex = /\[AGENT\s*:\s*([^|\]]+?)(?:\s*\|\s*([^|\]]+?))?(?:\s*\|\s*([^|\]]+?))?(?:\s*\|\s*([^|\]]+?))?(?:\s*\|\s*([^|\]]+?))?\]/gi;
  const matches = [...content.matchAll(agentRegex)];
  return matches.map(m => ({ 
    name: m[1]?.trim() || 'Unknown', 
    prompt: m[2]?.trim() || 'You are a helpful AI assistant.',
    model: m[3]?.trim() || undefined,
    temperature: m[4]?.trim() ? parseFloat(m[4].trim()) : 0.7,
    num_ctx: m[5]?.trim() ? parseInt(m[5].trim(), 10) : 4096
  }));
};

/**
 * Extracts task definitions from raw text using [TASK: Title | Agent] format.
 * Supports optional agent assignment and case-insensitive tags.
 */
const parseTasksFromContent = (content: string): { title: string, agentName: string }[] => {
  const taskRegex = /\[TASK\s*:\s*([^|\]]+?)(?:\s*\|\s*([^|\]]+?))?\]/gi;
  const matches = [...content.matchAll(taskRegex)];
  return matches.map(m => ({ title: m[1].trim(), agentName: m[2]?.trim() || '' }));
};

/**
 * Reusable status icon component for tasks.
 */
const StatusIcon = ({ status, size = 16 }: { status: TaskStatus; size?: number }) => {
  switch (status) {
    case 'done':
      return <CheckCircle size={size} className="text-emerald-500" />;
    case 'in-progress':
      return <PlayCircle size={size} className="text-blue-500 animate-pulse" />;
    case 'failed':
      return <AlertCircle size={size} className="text-red-500" />;
    default:
      return <Circle size={size} className="text-black/10" />;
  }
};

/**
 * Specialized component to render chat message content with visual task/agent cards.
 * Defined outside App to prevent remount flickering during streaming.
 */
const MessageContent = React.memo(({ 
  content, 
  agents, 
  tasks, 
  models, 
  onApproveAgent,
  onExecuteTask 
}: { 
  content: string, 
  agents: Agent[], 
  tasks: Task[], 
  models: OllamaModel[],
  onApproveAgent: (agentId: string, updates: Partial<Agent>) => void,
  onExecuteTask: (task: Task) => void
}) => {
  // Regex for both tags
  const combinedRegex = /(\[(?:TASK|AGENT)\s*:\s*[\s\S]*?\])/gi;
  const parts = content.split(combinedRegex);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  // Form state for agent approval
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editTemp, setEditTemp] = useState<number>(0.7);
  const [editCtx, setEditCtx] = useState<number>(4096);

  return (
    <div className="space-y-4">
      {parts.map((part, index) => {
        if (part.match(/\[AGENT\s*:\s*/i)) {
          const agentDef = parseAgentsFromContent(part)[0];
          if (!agentDef) return <span key={index}>{part}</span>;
          
          // Find actual agent in state
          const liveAgent = agents.find(a => a.name.toLowerCase() === agentDef.name.toLowerCase());
          if (!liveAgent) return <span key={index}>{part}</span>;

          if (liveAgent.isPending) {
            const isEditing = editingAgentId === liveAgent.id;
            
            return (
              <motion.div 
                key={`pending-agent-${liveAgent.id}`}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="my-4 p-4 rounded-xl bg-amber-50/50 border border-amber-500/10 shadow-sm"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center">
                    <UserPlus size={18} className="text-amber-600" />
                  </div>
                  <div className="flex-1">
                    <div className="text-[10px] font-bold uppercase tracking-tight text-amber-600/60">Approval Required</div>
                    <div className="text-sm font-semibold text-amber-900">{liveAgent.name}</div>
                  </div>
                  {!isEditing && (
                    <button 
                      onClick={() => {
                        setEditingAgentId(liveAgent.id);
                        setEditPrompt(liveAgent.systemPrompt);
                        setEditModel(liveAgent.model);
                        setEditTemp(liveAgent.temperature ?? 0.7);
                        setEditCtx(liveAgent.num_ctx ?? 4096);
                      }}
                      className="p-2 hover:bg-amber-500/10 rounded-lg text-amber-600 transition-colors"
                    >
                      <Settings size={16} />
                    </button>
                  )}
                </div>

                {isEditing ? (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase text-black/40">Model</label>
                      <select 
                        value={editModel}
                        onChange={(e) => setEditModel(e.target.value)}
                        className="w-full p-2 rounded-lg bg-white border border-black/5 text-xs outline-none focus:ring-2 focus:ring-amber-500/20"
                      >
                        {models.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase text-black/40">System Prompt</label>
                      <textarea 
                        value={editPrompt}
                        onChange={(e) => setEditPrompt(e.target.value)}
                        rows={4}
                        className="w-full p-2 rounded-lg bg-white border border-black/5 text-xs outline-none focus:ring-2 focus:ring-amber-500/20 resize-none"
                      />
                    </div>
                    <div className="flex gap-4">
                      <div className="space-y-1.5 flex-1">
                        <label className="text-[10px] font-bold uppercase text-black/40 flex justify-between">
                          <span>Temperature</span>
                          <span className="text-amber-600">{editTemp.toFixed(1)}</span>
                        </label>
                        <input 
                          type="range" min="0" max="1" step="0.1" 
                          value={editTemp} onChange={(e) => setEditTemp(parseFloat(e.target.value))}
                          className="w-full accent-amber-500" 
                        />
                      </div>
                      <div className="space-y-1.5 flex-1">
                        <label className="text-[10px] font-bold uppercase text-black/40">Context Size</label>
                        <select 
                          value={editCtx} onChange={(e) => setEditCtx(parseInt(e.target.value, 10))}
                          className="w-full p-2 rounded-lg bg-white border border-black/5 text-xs outline-none focus:ring-2 focus:ring-amber-500/20"
                        >
                          <option value={2048}>2048 tokens</option>
                          <option value={4096}>4096 tokens</option>
                          <option value={8192}>8192 tokens</option>
                          <option value={16384}>16384 tokens</option>
                          <option value={32768}>32768 tokens</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-2 pt-2">
                      <button 
                        onClick={() => {
                          onApproveAgent(liveAgent.id, { systemPrompt: editPrompt, model: editModel, temperature: editTemp, num_ctx: editCtx });
                          setEditingAgentId(null);
                        }}
                        className="flex-1 py-2 rounded-lg bg-amber-500 text-white text-xs font-bold uppercase tracking-wider hover:bg-amber-600 transition-colors"
                      >
                        Validate & Provision
                      </button>
                      <button 
                        onClick={() => setEditingAgentId(null)}
                        className="px-4 py-2 rounded-lg bg-black/5 text-black/40 text-xs font-bold uppercase tracking-wider hover:bg-black/10 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="p-3 rounded-lg bg-white/50 border border-amber-500/5 text-xs text-amber-900/80 line-clamp-2 italic">
                      "{liveAgent.systemPrompt}"
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="px-2 py-1 rounded-lg bg-amber-500/10 text-[10px] font-bold text-amber-600 uppercase">
                        {liveAgent.model}
                      </div>
                      <button 
                        onClick={() => onApproveAgent(liveAgent.id, {})}
                        className="flex-1 py-2 rounded-lg bg-amber-500 text-white text-xs font-bold uppercase tracking-wider hover:bg-amber-600 transition-colors shadow-sm"
                      >
                        Quick Approve
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            );
          }

          return (
            <motion.div 
              key={`active-agent-${liveAgent.id}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="my-2 p-3 rounded-xl bg-black/[0.02] border border-black/5 flex items-center gap-3 group"
            >
              <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <UserPlus size={18} className="text-emerald-600" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-tight text-black/40">Agent Activated</span>
                </div>
                <div className="text-sm font-semibold">{liveAgent.name}</div>
              </div>
            </motion.div>
          );
        }

        if (part.match(/\[TASK\s*:\s*/i)) {
          const taskDef = parseTasksFromContent(part)[0];
          if (!taskDef) return <span key={index}>{part}</span>;

          const liveTask = tasks.find(t => t.title.trim().toLowerCase() === taskDef.title.trim().toLowerCase());
          const assignedAgent = agents.find(a => a.name.toLowerCase() === taskDef.agentName.toLowerCase());
          const isExpanded = expandedTaskId === liveTask?.id;

          return (
            <motion.div 
              key={`task-${liveTask?.id || index}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="my-2 p-4 rounded-xl bg-black/[0.02] border border-black/5 hover:border-black/20 transition-all"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-full bg-emerald-500/5">
                    <StatusIcon status={liveTask?.status || 'todo'} size={18} />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-black uppercase text-black/20 tracking-[0.1em]">Assigned to {taskDef.agentName}</span>
                      {liveTask?.status && (
                        <span className={cn(
                          "px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter",
                          liveTask.status === 'done' ? "bg-emerald-500/10 text-emerald-600" :
                          liveTask.status === 'in-progress' ? "bg-blue-500/10 text-blue-600" :
                          "bg-black/5 text-black/40"
                        )}>
                          {liveTask.status}
                        </span>
                      )}
                    </div>
                    <div className={cn(
                      "text-sm font-semibold tracking-tight",
                      liveTask?.status === 'done' && "text-black/30 line-through decoration-emerald-500/20"
                    )}>{taskDef.title}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {assignedAgent && (
                    <div className="px-2 py-1 rounded-lg bg-white border border-black/[0.03] flex items-center gap-1.5 shadow-sm">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: assignedAgent.color }} />
                      <span className="text-[10px] font-bold text-black/60 uppercase tracking-tight">{assignedAgent.name}</span>
                    </div>
                  )}
                  {liveTask?.result && (
                    <button 
                      onClick={() => setExpandedTaskId(isExpanded ? null : liveTask.id)}
                      className="p-2 rounded-lg hover:bg-black/5 text-black/20 transition-colors"
                    >
                      <ChevronDown size={14} className={cn("transition-transform", isExpanded && "rotate-180")} />
                    </button>
                  )}
                  {liveTask && liveTask.status === 'todo' && (
                    <button 
                      onClick={() => onExecuteTask(liveTask)}
                      className="p-2 rounded-lg bg-black/5 hover:bg-black text-black/40 hover:text-white transition-all shadow-sm"
                      title="Start Task"
                    >
                      <Play size={12} />
                    </button>
                  )}
                  {liveTask && liveTask.status === 'failed' && (
                    <button 
                      onClick={() => onExecuteTask(liveTask)}
                      className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white transition-all shadow-sm"
                      title="Retry Task"
                    >
                      <RefreshCw size={12} />
                    </button>
                  )}
                </div>
              </div>

              {liveTask?.isLoadingModel && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="mt-3 p-3 rounded-lg bg-blue-50/50 border border-blue-500/10 flex items-center gap-3 overflow-hidden"
                >
                  <RefreshCw size={14} className="text-blue-500 animate-spin" />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700/80">
                    Loading model into VRAM...
                  </span>
                </motion.div>
              )}

              {isExpanded && liveTask?.result && (
                <motion.div 
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  className="mt-2 p-3 rounded-lg bg-white border border-black/5 text-xs text-black/70 leading-relaxed overflow-hidden"
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{liveTask.result}</ReactMarkdown>
                </motion.div>
              )}
            </motion.div>
          );
        }

        return <span key={index} className="whitespace-pre-wrap">{part}</span>;
      })}
    </div>
  );
});
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
  const [hasLoaded, setHasLoaded] = useState(false);

  // Model Manager State
  const [pullInput, setPullInput] = useState('');
  const [isPulling, setIsPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState<import('./types').PullProgress | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const isExecutingTaskRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  
  // Memoize service to prevent it from resetting on every render
  const ollama = React.useMemo(() => new OllamaService(settings.baseUrl), [settings.baseUrl]);

  const handlePullModel = async () => {
    if (!pullInput.trim() || isPulling) return;
    setIsPulling(true);
    setPullError(null);
    setPullProgress(null);
    
    try {
      await ollama.pullModel(pullInput.trim(), (progress) => {
        setPullProgress(progress);
      });
      setPullInput('');
      
      // Refresh models
      const connected = await ollama.checkConnection();
      setIsConnected(connected);
      if (connected) {
        const modelList = await ollama.listModels();
        setModels(modelList);
      }
      setPullProgress(null);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setPullError(err.message || 'Failed to pull model. Check the tag name and connection.');
      }
    } finally {
      setIsPulling(false);
    }
  };

  const handleAbortPull = () => {
    ollama.abortPull();
    setIsPulling(false);
    setPullProgress(null);
  };

  const handleDeleteModel = async (modelName: string) => {
    if (!window.confirm(`Are you sure you want to permanently delete the model "${modelName}" from your server?`)) return;
    try {
      await ollama.deleteModel(modelName);
      
      // Refresh models
      const connected = await ollama.checkConnection();
      setIsConnected(connected);
      if (connected) {
        const modelList = await ollama.listModels();
        setModels(modelList);
        if (settings.selectedModel === modelName) {
          setSettings(prev => ({ ...prev, selectedModel: modelList.length > 0 ? modelList[0].name : '' }));
        }
      }
    } catch (err: any) {
      alert(`Failed to delete model: ${err.message}`);
    }
  };

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
      } finally {
        setHasLoaded(true);
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
    // PREVENT SAVING BEFORE INITIAL LOAD (Race condition fix)
    if (!hasLoaded) return;

    const timer = setTimeout(() => {
      saveData(sessions, settings);
    }, 1000); // Debounce save
    return () => clearTimeout(timer);
  }, [sessions, settings, hasLoaded]);

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

  const getOrchestratorPrompt = (availableModels: OllamaModel[]) => {
    const modelNames = availableModels.map(m => m.name).join(', ');
    return `CORE PRINCIPLES:
1. REFLECTION: Before creating agents or tasks, think deeply about the user's intent, the domains involved, and the most efficient way to achieve the goal. Describe your reasoning in the CLASSIFY section.
2. SPECIALIZATION: Create agents with very specific, detailed roles. Don't use generic titles.
3. IMAGE GENERATION: We have a HIGH-PERFORMANCE NVIDIA T1000 GPU dedicated to image generation. If the project requires visuals, illustrations, or photos, ALWAYS create an agent named 'Illustrateur' and assign it a task clearly describing the image to generate. The system will automatically handle the rendering.
4. MODEL INTELLIGENCE: Assign each agent the most suitable model from the available list below. Use larger models for complex reasoning/creative writing and smaller/faster models for specialized data extraction or formatting.
5. COLLABORATION: Instruct agents that they can suggest task re-attribution or request clarifications in their results if they hit a blocker.
6. LANGUAGE CONSISTENCY: ALWAYS respond and define agent prompts in the SAME LANGUAGE as the user input (e.g., if the user asks in French, everything must be in French).

AVAILABLE MODELS ON THIS SERVER:
${modelNames || 'Standard models detected.'}

REQUIRED STRUCTURED FORMAT:
You MUST use these tags exactly for the system to parse your plan:

1. CLASSIFY: [Your reasoning and domain analysis]
2. PROVISION: 
   [AGENT: Name | Detailed System Prompt | ModelName]
   (Repeat for each agent. ModelName is optional but preferred).

3. PLAN:
   [TASK: Clear Title | Agent Name]
   (Ensure tasks are sequential and cover the entire goal).

Example (French):
CLASSIFY: Étude de marché et stratégie de prix.
PROVISION: 
[AGENT: Analyste | Vous êtes un expert en économie de marché... | llama3:latest]
[AGENT: Strategiste | Vous êtes un consultant en marketing... | mistral:latest]
PLAN:
[TASK: Analyser les prix des concurrents | Analyste]
[TASK: Proposer une stratégie de pénétration | Strategiste]`;
  };

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
          systemPrompt: getOrchestratorPrompt(models),
          color: '#10b981',
          temperature: 0.7,
          num_ctx: 8192
        }
      ],
      model: settings.selectedModel,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setSessions(prev => [newSession, ...prev]);
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

    const isAgentModeAtStart = settings.isAgentMode;
    let targetSessionId = currentSessionId;
    let activeSession = currentSession;
    let tempNewSession: ChatSession | null = null;

    if (!targetSessionId || !activeSession) {
      tempNewSession = createNewSession();
      targetSessionId = tempNewSession.id;
      activeSession = tempNewSession;
    }

    const orchestrator = activeSession.agents.find(a => a.id === 'orchestrator');
    const systemPrompt = isAgentModeAtStart ? getOrchestratorPrompt(models) : undefined;

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
      const target = prev.find(s => s.id === targetSessionId);
      if (target) {
        return prev.map(s => s.id === targetSessionId ? {
          ...s,
          messages: [...s.messages, userMessage, assistantMessage],
          updatedAt: Date.now(),
          title: s.messages.length === 0 ? input.slice(0, 30) : s.title
        } : s);
      } else if (tempNewSession) {
        return [{
          ...tempNewSession,
          messages: [userMessage, assistantMessage],
          updatedAt: Date.now(),
          title: input.slice(0, 30)
        }, ...prev];
      }
      return prev;
    });

    setInput('');

    let lastUpdateTime = Date.now();
    let accumulatedContent = '';

    try {
      await ollama.chat(settings.selectedModel, [...(activeSession?.messages || []), userMessage], (chunk) => {
        accumulatedContent += chunk;
        
        const now = Date.now();
        if (now - lastUpdateTime > 100) {
          lastUpdateTime = now;
          updateAssistantMessage(targetSessionId!, accumulatedContent, isAgentModeAtStart);
        }
      }, systemPrompt, abortControllerRef.current.signal, { temperature: orchestrator?.temperature ?? 0.7, num_ctx: orchestrator?.num_ctx ?? 4096 });
      
      updateAssistantMessage(targetSessionId!, accumulatedContent, isAgentModeAtStart);
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Generation aborted');
      } else {
        console.error('Chat error:', error);
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  const updateAssistantMessage = (sessionId: string, fullContent: string, isAgentMode: boolean) => {
    setSessions(prev => prev.map(s => {
      if (s.id === sessionId) {
        const messages = [...s.messages];
        if (messages.length > 0) {
          const lastMsg = messages[messages.length - 1];
          messages[messages.length - 1] = { ...lastMsg, content: fullContent };
        }

        if (isAgentMode) {
          const suggestedAgents = parseAgentsFromContent(fullContent);
          const suggestedTasks = parseTasksFromContent(fullContent);
          
          if (suggestedAgents.length > 0) console.log('Parsed Agents:', suggestedAgents);
          if (suggestedTasks.length > 0) console.log('Parsed Tasks:', suggestedTasks);
          
          let updatedAgents = [...s.agents];
          let updatedTasks = [...s.tasks];
          const colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#ef4444'];
          
          suggestedAgents.forEach(suggested => {
            const agentName = suggested.name.trim();
            if (!updatedAgents.find(a => a.name.toLowerCase() === agentName.toLowerCase())) {
              updatedAgents.push({
                id: crypto.randomUUID(),
                name: agentName,
                model: suggested.model || settings.selectedModel,
                systemPrompt: suggested.prompt,
                color: colors[updatedAgents.length % colors.length],
                temperature: suggested.temperature ?? 0.7,
                num_ctx: suggested.num_ctx ?? 4096,
                isPending: true // New agents start as pending
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
        const agent = currentSession?.agents.find(a => a.id === pendingTask.agentId);
        // Only run if agent is NOT pending (orchestrator is never pending)
        if (!agent || !agent.isPending || pendingTask.agentId === 'orchestrator') {
          executeTask(pendingTask);
        }
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

  const approveAgent = (agentId: string, updates: Partial<Agent>) => {
    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId) {
        return {
          ...s,
          agents: s.agents.map(a => a.id === agentId ? { ...a, ...updates, isPending: false } : a)
        };
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

  /**
   * Generates a final summary once all tasks in a session are completed.
   */
  const generateFinalSummary = async (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;

    const orchestrator = session.agents.find(a => a.id === 'orchestrator');
    const resultsContext = session.tasks
      .map(t => `Task: ${t.title}\nAgent: ${session.agents.find(a => a.id === t.agentId)?.name || 'Orchestrator'}\nResult: ${t.result}`)
      .join('\n\n---\n\n');

    const prompt = `ALL ORCHESTRATED TASKS ARE NOW COMPLETE. 🎯\n\nHere are the results for each phase:\n\n${resultsContext}\n\nBased on these outcomes, please provide a comprehensive final summary for the user. Synthesize the findings, highlight key accomplishments, and offer any final recommendations or next steps. Be encouraging and clear.✨`;

    const summaryId = crypto.randomUUID();
    const summaryMsg: Message = {
      id: summaryId,
      role: 'assistant',
      content: 'All tasks are complete! Synthesizing the final results...',
      timestamp: Date.now(),
      isSummary: true
    };

    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, messages: [...s.messages, summaryMsg] } : s));
    setIsLoading(true);

    let accumulated = '';
    try {
      await ollama.chat(orchestrator?.model || settings.selectedModel, [...session.messages, { id: 'summary-user', role: 'user', content: prompt, timestamp: Date.now() }], (chunk) => {
        accumulated += chunk;
        updateAssistantMessage(sessionId, accumulated, false);
      }, orchestrator?.systemPrompt, undefined, { temperature: orchestrator?.temperature ?? 0.7, num_ctx: orchestrator?.num_ctx ?? 4096 });
    } catch (err) {
      console.error('Final summary generation failed:', err);
    } finally {
      setIsLoading(false);
    }
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
          tasks: s.tasks.map(t => t.id === task.id ? { ...t, status: 'in-progress', result: '' } : t)
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
      
      const loadedModels = await ollama.getLoadedModels();
      const isLoaded = loadedModels.includes(modelToUse) || loadedModels.some(m => m.startsWith(modelToUse));
      
      if (!isLoaded) {
        setSessions(prev => prev.map(s => s.id === currentSessionId ? {
          ...s,
          tasks: s.tasks.map(t => t.id === task.id ? { ...t, isLoadingModel: true } : t)
        } : s));
      }

      let lastUpdateTime = Date.now();
      let hasReceivedFirstChunk = false;

      // Special handling for image generation tasks
      const isImageTask = agent.name.toLowerCase().includes('illustrateur') || 
                         task.title.toLowerCase().match(/générer une image|dessiner|créer une illustration/);
      
      if (isImageTask && !isSetupTask) {
        try {
          // Update status to show generation in progress
          setSessions(prev => prev.map(s => s.id === currentSessionId ? {
            ...s,
            tasks: s.tasks.map(t => t.id === task.id ? { ...t, result: '🎨 Generant l\'image sur le GPU NVIDIA T1000...' } : t)
          } : s));

          // Call the specialized image generation API
          const imageResult = await ollama.generateImage(task.title);
          
          fullResult = `**Image générée avec succès !** 🎨\n\n![Génération](${imageResult.url})\n\n*Prompt utilisé : ${imageResult.prompt_used}*`;
          
          setSessions(prev => prev.map(s => s.id === currentSessionId ? {
            ...s,
            tasks: s.tasks.map(t => t.id === task.id ? { ...t, status: 'done', result: fullResult, completedAt: Date.now() } : t)
          } : s));
          
          return;
        } catch (imageError: any) {
          console.error('Image generation error:', imageError);
          // Fallback to standard chat if image generation fails, but alert the user
          fullResult = `❌ Erreur lors de la génération d'image : ${imageError.message}. Tentative de description textuelle...`;
        }
      }

      await ollama.chat(modelToUse, [{ id: '1', role: 'user', content: prompt, timestamp: Date.now() }], (chunk) => {
        if (!hasReceivedFirstChunk && !isLoaded) {
          hasReceivedFirstChunk = true;
          setSessions(prev => prev.map(s => s.id === currentSessionId ? {
            ...s,
            tasks: s.tasks.map(t => t.id === task.id ? { ...t, isLoadingModel: false } : t)
          } : s));
        }
        
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
      }, agent.systemPrompt, abortControllerRef.current.signal, { temperature: agent.temperature ?? 0.7, num_ctx: agent.num_ctx ?? 4096 });

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
      setSessions(prev => {
        const nextSessions = prev.map(s => {
          if (s.id === currentSessionId) {
            return {
              ...s,
              tasks: s.tasks.map(t => t.id === task.id ? { ...t, status: 'done' as TaskStatus, completedAt: Date.now() } : t)
            };
          }
          return s;
        });

        // Trigger final summary if all tasks are complete
        const targetSession = nextSessions.find(s => s.id === currentSessionId);
        if (targetSession && targetSession.tasks.length > 0 && targetSession.tasks.every(t => t.status === 'done')) {
          const hasSummary = targetSession.messages.some(m => m.isSummary);
          if (!hasSummary) {
             setTimeout(() => generateFinalSummary(currentSessionId!), 1000);
          }
        }

        return nextSessions;
      });
    } catch (error: any) {
      // Ensure loading state is cleared on error
      setSessions(prev => prev.map(s => s.id === currentSessionId ? {
        ...s,
        tasks: s.tasks.map(t => t.id === task.id ? { ...t, isLoadingModel: false } : t)
      } : s));

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
            <div className="flex-1 p-8 max-w-5xl mx-auto w-full overflow-y-auto custom-scrollbar">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-2xl font-semibold">Server Administration</h2>
                  <p className="text-sm text-black/40 mt-1">Manage your local Ollama instance, download new models, and configure connections.</p>
                </div>
                <button onClick={() => setShowSettings(false)} className="px-4 py-2 rounded-lg bg-black text-white hover:bg-black/80 transition-colors font-medium text-sm">
                  Done
                </button>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Left Column: Server Status & Pull */}
                <div className="space-y-8">
                  <div className="p-6 rounded-2xl bg-white border border-black/5 shadow-sm space-y-4">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-black/40 flex items-center gap-2">
                      <Monitor size={16} /> Connection Settings
                    </h3>
                    <div className="space-y-2">
                       <label className="text-[10px] font-bold text-black/40 uppercase tracking-wider">Ollama API URL</label>
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          value={settings.baseUrl}
                          onChange={(e) => setSettings(prev => ({ ...prev, baseUrl: e.target.value }))}
                          className="flex-1 p-2 rounded-lg border border-black/10 bg-black/[0.02] text-sm focus:outline-none focus:ring-2 focus:ring-black/5 transition-all outline-none"
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
                    </div>
                    {/* Default Model Selection */}
                    <div className="space-y-2 pt-2 border-t border-black/5">
                      <label className="text-[10px] font-bold text-black/40 uppercase tracking-wider">Global Default Model</label>
                      <select 
                        value={settings.selectedModel}
                        onChange={(e) => setSettings(prev => ({ ...prev, selectedModel: e.target.value }))}
                        className="w-full p-2 rounded-lg border border-black/10 bg-black/[0.02] text-sm appearance-none outline-none focus:ring-2 focus:ring-black/5 transition-all"
                      >
                        <option value="" disabled>Select a model...</option>
                        {models.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                      </select>
                      <p className="text-[10px] text-black/40">This model will be used as the fallback when provisioned agents don't explicitly specify one.</p>
                    </div>

                    {isConnected === false && (
                      <div className="p-3 rounded-lg bg-red-50 border border-red-100 space-y-2">
                        <p className="text-[10px] text-red-600 font-bold uppercase tracking-wider">Connection Error</p>
                        <ul className="text-[10px] text-red-700/80 list-disc ml-3 space-y-1">
                          <li>Ensure the Ollama process is running.</li>
                          <li><strong>CORS:</strong> Start Ollama with <code>OLLAMA_ORIGINS="*" ollama serve</code></li>
                        </ul>
                      </div>
                    )}
                  </div>

                  <div className="p-6 rounded-2xl border-2 border-dashed border-emerald-500/20 bg-emerald-50/30 space-y-4">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-800/60 flex items-center gap-2">
                      <Download size={16} /> Pull new model
                    </h3>
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        value={pullInput}
                        onChange={(e) => setPullInput(e.target.value)}
                        disabled={isPulling}
                        onKeyDown={(e) => { if (e.key === 'Enter') handlePullModel(); }}
                        className="flex-1 p-2 rounded-lg border border-emerald-500/20 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50 outline-none"
                        placeholder="e.g., llama3:latest or qwen2.5:0.5b"
                      />
                      {isPulling ? (
                        <button 
                          onClick={handleAbortPull}
                          className="px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors font-medium text-sm flex items-center gap-2"
                        >
                          <Square size={14} fill="currentColor" /> Stop
                        </button>
                      ) : (
                        <button 
                          onClick={handlePullModel}
                          disabled={!pullInput.trim()}
                          className="px-4 py-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Pull
                        </button>
                      )}
                    </div>
                    
                    {pullError && (
                      <div className="p-3 rounded-lg bg-red-50 border border-red-100 text-[10px] font-medium text-red-600 uppercase tracking-wider">
                        {pullError}
                      </div>
                    )}

                    <AnimatePresence>
                      {pullProgress && (
                        <motion.div 
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="space-y-2 mt-4 pt-4 border-t border-emerald-500/10"
                        >
                          <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                            <span>{pullProgress.status}</span>
                            {pullProgress.total ? (
                              <span>
                                {((pullProgress.completed || 0) / 1024 / 1024 / 1024).toFixed(2)} GB / 
                                {(pullProgress.total / 1024 / 1024 / 1024).toFixed(2)} GB
                              </span>
                            ) : null}
                          </div>
                          {pullProgress.total ? (
                            <div className="h-2 w-full bg-emerald-500/10 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-emerald-500 transition-all duration-300 ease-out"
                                style={{ width: `${Math.min(100, Math.max(0, ((pullProgress.completed || 0) / pullProgress.total) * 100))}%` }}
                              />
                            </div>
                          ) : (
                            <div className="h-2 w-full bg-emerald-500/10 rounded-full overflow-hidden relative">
                              <div className="absolute inset-0 bg-emerald-500/40 w-1/3 animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite] rounded-full" />
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Right Column: Installed Models */}
                <div className="space-y-4 border border-black/5 rounded-2xl p-6 bg-black/[0.01]">
                   <h3 className="text-sm font-bold uppercase tracking-wider text-black/40 flex items-center gap-2 mb-4">
                      <HardDrive size={16} /> Installed Models ({models.length})
                    </h3>
                    <div className="space-y-3 max-h-[600px] overflow-y-auto custom-scrollbar pr-2">
                       {models.map(m => (
                          <div key={m.name} className="p-4 rounded-xl bg-white border border-black/5 shadow-sm flex items-center justify-between group hover:border-black/20 transition-colors">
                            <div>
                               <div className="font-semibold text-sm">{m.name}</div>
                               <div className="flex items-center gap-2 mt-1 text-[10px] uppercase font-bold text-black/30 tracking-wider">
                                  <span>{(m.size / 1024 / 1024 / 1024).toFixed(2)} GB</span>
                                  <span>•</span>
                                  <span>{m.details?.parameter_size || 'Unknown'} params</span>
                               </div>
                            </div>
                            <div className="flex items-center gap-3">
                              {settings.selectedModel === m.name && (
                                <span className="px-2 py-1 rounded bg-emerald-50 text-[10px] font-bold text-emerald-600/80 uppercase tracking-widest border border-emerald-500/10">Default</span>
                              )}
                              <button 
                                onClick={() => handleDeleteModel(m.name)}
                                className="p-2 rounded-lg text-black/20 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                                title="Delete Model"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                       ))}
                       {models.length === 0 && (
                         <div className="text-sm font-medium text-black/40 text-center py-12 border-2 border-dashed border-black/5 rounded-xl">
                           {isConnected ? "No models installed yet." : "Connect to Ollama to view your models."}
                         </div>
                       )}
                    </div>
                </div>
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
                      <div className="flex gap-4">
                        <div className="space-y-1.5 flex-1">
                          <label className="text-[10px] font-bold uppercase text-black/30 flex justify-between tracking-widest">
                            <span>Temperature</span>
                            <span className="text-emerald-600">{(agent.temperature ?? 0.7).toFixed(1)}</span>
                          </label>
                          <input 
                            type="range" min="0" max="1" step="0.1" 
                            value={agent.temperature ?? 0.7} 
                            onChange={(e) => updateAgent(agent.id, { temperature: parseFloat(e.target.value) })}
                            className="w-full accent-emerald-500" 
                          />
                        </div>
                        <div className="space-y-1.5 flex-1">
                          <label className="text-[10px] font-bold uppercase text-black/30 tracking-widest">Context Size</label>
                          <select 
                            value={agent.num_ctx ?? 4096} 
                            onChange={(e) => updateAgent(agent.id, { num_ctx: parseInt(e.target.value, 10) })}
                            className="w-full p-2 rounded-lg border border-black/5 bg-black/[0.02] text-xs outline-none focus:ring-2 focus:ring-emerald-500/20"
                          >
                            <option value={2048}>2048 tokens</option>
                            <option value={4096}>4096 tokens</option>
                            <option value={8192}>8192 tokens</option>
                            <option value={16384}>16384 tokens</option>
                            <option value={32768}>32768 tokens</option>
                          </select>
                        </div>
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
                                  <StatusIcon status={task.status} />
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
                      <div className={cn("flex-1 px-4 py-2 rounded-2xl text-sm leading-relaxed", 
                        message.role === 'user' ? "bg-black/5 text-black" : "bg-transparent"
                      )}>
                        {message.type === 'agent-result' ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 mb-2">
                              {message.agentId && (
                                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/5 border border-black/5">
                                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: currentSession?.agents.find(a => a.id === message.agentId)?.color }} />
                                  <span className="text-[9px] font-bold uppercase text-black/60">
                                    {currentSession?.agents.find(a => a.id === message.agentId)?.name || 'Agent'} Result
                                  </span>
                                </div>
                              )}
                              <span className="text-[9px] font-bold uppercase text-black/20">{new Date(message.timestamp).toLocaleTimeString()}</span>
                            </div>
                            <div className="markdown-body p-4 rounded-xl bg-black/[0.02] border border-black/5">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                            </div>
                          </div>
                        ) : (
                          <MessageContent 
                            content={message.content} 
                            agents={currentSession?.agents || []} 
                            tasks={currentSession?.tasks || []}
                            models={models}
                            onApproveAgent={approveAgent}
                            onExecuteTask={executeTask}
                          />
                        )}
                      </div>
                    </div>
                  ))
                )}
                {isLoading && currentSession?.messages[currentSession.messages.length - 1]?.role !== 'assistant' && (
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
