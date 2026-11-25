import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
// Change this name if your prompt file exports a different constant
import { CODE_QUALITY_ANALYZER_PROMPT } from '../prompts/code-quality-analyzer.prompt.js';

/**
 * Tells the agent when and how to use skills from .claude/skills/.
 */
const SKILL_GUIDANCE = `
## Using Skills
- For every JavaScript or TypeScript file (.js, .jsx, .ts, .tsx, .mjs, .cjs), FIRST invoke the
  \`javascript-best-practices\` skill with the Skill tool, then apply its checklist to the file.
- If the code handles user input, authentication, secrets, SQL/HTML/shell strings or file paths,
  also invoke the \`code-review-best-practices\` skill for its security checklist.
- If the mcp__eslint__lint-files tool is available, run it on JS/TS files and include real lint
  errors as issues (category "maintainability" unless they indicate a bug or vulnerability).
- Only report issues you can point to with a line number. Do not invent problems.
`;

export const codeQualityAnalyzer: AgentDefinition = {
  description:
    'Code quality reviewer. Use this agent for EACH changed file in a pull request to find ' +
    'security vulnerabilities, performance problems and maintainability issues, with severity ' +
    'and line numbers. Returns a CodeQualityResult JSON object.',
  prompt: `${CODE_QUALITY_ANALYZER_PROMPT}\n${SKILL_GUIDANCE}`,
  // Least privilege: read-only tools + Skill + ESLint
  tools: ['Read', 'Grep', 'Glob', 'Skill', 'mcp__eslint__lint-files'],
  model: 'inherit'
};
