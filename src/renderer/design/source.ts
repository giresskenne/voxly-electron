import {
  Activity,
  Brain,
  History,
  Keyboard,
  Mic,
  Settings,
  ShieldCheck,
  Sparkles,
  Wand2,
  type LucideIcon,
} from "lucide-react";

export const brand = {
  name: "Voxly",
  tagline: "Voice-first AI writing assistant",
  gradient: "var(--gradient-brand)",
};

export const shellNav: Array<{ id: string; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "dictation", label: "Dictation", icon: Mic },
  { id: "models", label: "Models", icon: Brain },
  { id: "cleanup", label: "Cleanup", icon: Wand2 },
  { id: "hotkeys", label: "Hotkeys", icon: Keyboard },
  { id: "history", label: "History", icon: History },
  { id: "permissions", label: "Permissions", icon: ShieldCheck },
  { id: "settings", label: "Settings", icon: Settings },
];

export const modelOptions = [
  { id: "tiny", label: "Tiny", speed: "Fastest", quality: "Draft" },
  { id: "base", label: "Base", speed: "Fast", quality: "Balanced" },
  { id: "small", label: "Small", speed: "Steady", quality: "Sharper" },
  { id: "medium", label: "Medium", speed: "Slower", quality: "High" },
  { id: "large-v3", label: "Large v3", speed: "Slow", quality: "Best" },
  { id: "large-v3-turbo", label: "Turbo", speed: "Fast", quality: "Best" },
];

export const writingModes = [
  { id: "cleanup", label: "Cleanup", icon: Sparkles, description: "Punctuation, casing, and filler cleanup." },
  { id: "agent", label: "Agent", icon: Brain, description: "Command Voxly by saying the assistant name first." },
  { id: "raw", label: "Raw", icon: Mic, description: "Paste the transcript exactly as Whisper returns it." },
];

export const overviewStats = [
  { value: "300ms", label: "target handoff", detail: "The UI is ready for persistent whisper.cpp inference." },
  { value: "2", label: "windows", detail: "Always-on overlay plus the control panel." },
  { value: "1", label: "design source", detail: "Tokens, materials, and controls are centralized." },
];
