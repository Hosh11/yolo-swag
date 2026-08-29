import type { AgentTool } from "./types";
import {
  addTask,
  captureIdea,
  completeTask,
  createProjectTool,
  listTasksTool,
  logWordsTool,
  processCapture,
  queueCheckinTool,
  updateProjectTool,
  writingStats,
} from "./tools";
import { delegateToWritingAssistant } from "@/lib/skills/writing";

/**
 * Wren's tool surface: the fast direct-manipulation tools she handles herself,
 * plus one delegation tool per sub-skill. Sub-skills get registered here as
 * they're built.
 */
export function wrenTools(state: string): AgentTool[] {
  return [
    captureIdea,
    addTask,
    completeTask,
    listTasksTool,
    createProjectTool,
    updateProjectTool,
    processCapture,
    queueCheckinTool,
    // Logging a word count is quick capture, not craft work. Routing it
    // through the sub-agent would cost a round trip and a second model call
    // to record one integer — exactly the friction the persona forbids.
    logWordsTool,
    writingStats,
    delegateToWritingAssistant(state),
  ];
}
