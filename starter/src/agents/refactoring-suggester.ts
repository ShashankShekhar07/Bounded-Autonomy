import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
// Change this name if your prompt file exports a different constant
import { REFACTORING_SUGGESTER_PROMPT } from '../prompts/refactoring-suggester.prompt.js';

const SKILL_GUIDANCE = `
## Using Skills
- For JavaScript/TypeScript files, invoke the \`javascript-best-practices\` skill with the Skill
  tool and use its "Modern syntax" and "Structure" sections to find modernization and
  design-pattern opportunities.
`;

export const refactoringSuggester: AgentDefinition = {
  description:
    'Refactoring advisor. Use this agent for EACH changed file in a pull request to suggest ' +
    'structural improvements: modernizing syntax, extracting functions, applying design patterns ' +
    'and improving clarity, each with before/after examples. Returns a RefactoringSuggestion JSON object.',
  prompt: `${REFACTORING_SUGGESTER_PROMPT}\n${SKILL_GUIDANCE}`,
  // Least privilege: read-only tools + Skill
  tools: ['Read', 'Grep', 'Glob', 'Skill'],
  model: 'inherit'
};
