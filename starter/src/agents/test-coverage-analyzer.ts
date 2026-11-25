import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
// Change this name if your prompt file exports a different constant
import { TEST_COVERAGE_ANALYZER_PROMPT } from '../prompts/test-coverage-analyzer.prompt.js';

const SKILL_GUIDANCE = `
## Using Skills
- For JavaScript/TypeScript files, invoke the \`javascript-best-practices\` skill with the Skill
  tool and use its "Testing" section to decide which test cases are missing.
`;

export const testCoverageAnalyzer: AgentDefinition = {
  description:
    'Test coverage analyst. Use this agent for EACH changed source file in a pull request to ' +
    'find its test files, estimate coverage by comparing functions/branches with existing tests, ' +
    'and suggest specific missing test cases. Returns a TestCoverageResult JSON object.',
  prompt: `${TEST_COVERAGE_ANALYZER_PROMPT}\n${SKILL_GUIDANCE}`,
  // Least privilege: read-only tools + Skill
  tools: ['Read', 'Grep', 'Glob', 'Skill'],
  model: 'inherit'
};

