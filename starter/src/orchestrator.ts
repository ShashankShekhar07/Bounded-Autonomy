import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ReviewReportSchema, type ReviewReport } from './types/index.js';
import {
  codeQualityAnalyzer,
  testCoverageAnalyzer,
  refactoringSuggester
} from './agents/index.js';
import { buildOrchestratorPrompt } from './prompts/index.js';
import { mcpServersConfig } from './config/mcp.config.js';
import { logger } from './utils/logger.js';
import { withTimeout, withRetry } from './utils/error-handler.js';
import { RateLimiter } from './utils/rate-limiter.js';

/**
 * Load variables from the project's .env file into process.env.
 * Values already set in the environment are not overwritten.
 */
function loadDotEnv(): void {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

/**
 * Settings the orchestrator reads from the environment (.env).
 */
function getEnv() {
  return {
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || undefined,
    PROJECT_ROOT: process.env.PROJECT_ROOT || process.cwd()
  };
}

/**
 * Minimal interface the orchestrator needs from a rate limiter.
 * Lets tests inject a fake limiter.
 */
export interface RateLimiterLike {
  acquire(): Promise<void>;
}

/**
 * Orchestrator configuration options
 */
export interface OrchestratorOptions {
  timeoutMs?: number;
  maxRetries?: number;
  maxTurns?: number;
  rateLimiter?: RateLimiterLike;
}

/**
 * Tools the orchestrator (main agent) may use.
 * - Task: REQUIRED to spawn the subagents
 * - Skill: lets agents load skills from .claude/skills/
 * - Read/Grep/Glob: read-only file inspection
 * - GitHub MCP tools: fetch PR metadata, changed files and file contents
 * - ESLint MCP tool: lint JavaScript/TypeScript files
 *
 * MCP tool names follow the pattern mcp__<serverName>__<toolName>, where
 * <serverName> is the key used in mcpServersConfig ("github" / "eslint").
 */
export const ORCHESTRATOR_ALLOWED_TOOLS = [
  'Task',
  'Skill',
  'Read',
  'Grep',
  'Glob',
  'mcp__github__get_pull_request',
  'mcp__github__get_pull_request_files',
  'mcp__github__get_file_contents',
  'mcp__eslint__lint-files'
];

/**
 * JSON Schema for the final report, generated from the Zod schema so that the
 * SDK enforces the ReviewReport structure via structured outputs.
 * The cast is needed because this project uses zod 3 while zod-to-json-schema
 * is typed against zod 4; the conversion itself works at runtime.
 */
export const reviewReportJsonSchema = zodToJsonSchema(ReviewReportSchema as any, {
  $refStrategy: 'none'
}) as Record<string, unknown>;

/**
 * Main Code Review Orchestrator
 * Coordinates subagents to analyze pull requests and generate comprehensive reports
 */
export class CodeReviewOrchestrator {
  private timeoutMs: number;
  private maxRetries: number;
  private maxTurns: number;
  private rateLimiter: RateLimiterLike;

  constructor(options: OrchestratorOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 600000; // 10 minutes: multi-agent runs are slow
    this.maxRetries = options.maxRetries ?? 2;
    this.maxTurns = options.maxTurns ?? 50;
    this.rateLimiter =
      options.rateLimiter ?? new RateLimiter({ maxRequestsPerMinute: 5 });
  }

  /**
   * Build the options passed to the Agent SDK query() call.
   */
  buildQueryOptions(): Options {
    const env = getEnv();

    return {
      model: env.ANTHROPIC_MODEL, // from env, not hardcoded
      cwd: env.PROJECT_ROOT,
      // Load project settings so skills in .claude/skills/ are available
      settingSources: ['project'],
      mcpServers: mcpServersConfig,
      agents: {
        'code-quality-analyzer': codeQualityAnalyzer,
        'test-coverage-analyzer': testCoverageAnalyzer,
        'refactoring-suggester': refactoringSuggester
      },
      allowedTools: ORCHESTRATOR_ALLOWED_TOOLS,
      maxTurns: this.maxTurns,
      // Non-interactive CI/CD run: no human is there to approve tool calls
      permissionMode: 'bypassPermissions',
      outputFormat: {
        type: 'json_schema',
        schema: reviewReportJsonSchema
      }
    } as Options;
  }

  /**
   * Review a pull request using parallel subagent analysis
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @returns Complete review report
   */
  async reviewPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    const startTime = Date.now();
    logger.info(`Starting PR review for ${owner}/${repo}#${prNumber}`);

    try {
      const report = await withRetry(
        () =>
          withTimeout(
            () => this.runReview(owner, repo, prNumber),
            this.timeoutMs,
            `PR review timed out after ${this.timeoutMs}ms`
          ),
        this.maxRetries
      );

      // Record real timing info, overriding anything the model guessed
      const finalReport: ReviewReport = {
        ...report,
        metadata: {
          ...report.metadata,
          analyzedAt: new Date().toISOString(),
          duration: Date.now() - startTime
        }
      };

      logger.info(
        `PR review completed in ${finalReport.metadata.duration}ms ` +
          `(${finalReport.summary.totalFiles} files, score ${finalReport.summary.overallScore}/100)`
      );
      return finalReport;
    } catch (error) {
      logger.error(`PR review failed for ${owner}/${repo}#${prNumber}: ${error}`);
      throw error;
    }
  }

  /**
   * One full agent run: call query(), collect the result, validate it.
   */
  private async runReview(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    await this.rateLimiter.acquire();

    const prompt = buildOrchestratorPrompt(owner, repo, prNumber);
    const options = this.buildQueryOptions();

    let resultMessage: any;

    // query() returns an async iterable of SDK messages
    for await (const message of query({ prompt, options })) {
      if (message.type === 'system' && message.subtype === 'init') {
        const servers = (message as any).mcp_servers ?? [];
        for (const server of servers) {
          logger.debug(`MCP server ${server.name}: ${server.status}`);
          if (server.status !== 'connected') {
            logger.warn(`MCP server ${server.name} is not connected (${server.status})`);
          }
        }
      } else if (message.type === 'assistant') {
        logger.debug('Orchestrator turn completed');
      } else if (message.type === 'result') {
        resultMessage = message;
      }
    }

    if (!resultMessage) {
      throw new Error('Agent run ended without a result message');
    }

    if (resultMessage.subtype !== 'success') {
      throw new Error(
        `Agent run failed (${resultMessage.subtype}). ` +
          'Check that MCP servers started, GITHUB_TOKEN is valid and maxTurns is high enough.'
      );
    }

    return this.validateReport(resultMessage.structured_output ?? resultMessage.result);
  }

  /**
   * Validate the agent output against the ReviewReport Zod schema.
   * Accepts either an object (structured_output) or a JSON string (fallback).
   */
  validateReport(raw: unknown): ReviewReport {
    let candidate = raw;

    if (typeof raw === 'string') {
      candidate = extractJson(raw);
    }

    const parsed = ReviewReportSchema.safeParse(candidate);

    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      throw new Error(`Agent output does not match ReviewReport schema: ${details}`);
    }

    return parsed.data;
  }
}

/**
 * Pull the first JSON object out of a text response (handles ```json fences).
 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  if (!body) {
    throw new Error('Empty response from model: expected JSON output');
  }
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');

  if (start === -1 || end === -1) {
    throw new Error('Agent returned no JSON report');
  }

  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new Error('Agent returned malformed JSON report');
  }
}