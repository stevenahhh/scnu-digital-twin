import { MessageCircle } from "lucide-react";

export const ASSISTANT_TAB = Object.freeze({ value: "assistant", label: "도우미", icon: MessageCircle });

export const assistantTabs = (tabs) => [...tabs, ASSISTANT_TAB];
