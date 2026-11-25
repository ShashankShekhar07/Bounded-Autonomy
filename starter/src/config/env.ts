/**
 * Environment Configuration and Validation
 * Validates required environment variables and provides helpful error messages
 */

import * as path from 'path';
import * as fs from 'fs';

export interface EnvironmentConfig {
  // Authentication
  anthropicApiKey: string;
  anthropicBaseUrl?: string;

  // AWS Bedrock (alternative auth)
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsRegion?: string;

  // Model configuration
  anthropicModel: string;

  // Project configuration
  projectRoot: string;
  skillsPath: string;

  // Optional
  githubToken?: string;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
}

/**
 * Validate and retrieve environment configuration
 * Throws descriptive errors if required variables are missing
 */
export function validateEnvironment(): EnvironmentConfig {
  const errors: string[] = [];

  // Check authentication
  const hasAWSAuth =
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY;

  const hasAntropicAuth = process.env.ANTHROPIC_API_KEY;

  if (!hasAWSAuth && !hasAntropicAuth) {
    errors.push(
      '❌ No authentication configured. Please set up ONE of the following:\n\n' +
      '  Option 1: Anthropic API\n' +
      '    export ANTHROPIC_API_KEY=sk-ant-your-key-here\n\n' +
      '  Option 2: AWS Bedrock\n' +
      '    export AWS_ACCESS_KEY_ID=your-access-key\n' +
      '    export AWS_SECRET_ACCESS_KEY=your-secret-key\n' +
      '    export AWS_REGION=us-east-1\n'
    );
  }

  // Validate AWS configuration if using AWS auth
  if (hasAWSAuth) {
    if (!process.env.AWS_REGION) {
      errors.push(
        '❌ AWS_REGION is required when using AWS Bedrock authentication\n' +
        '    export AWS_REGION=us-east-1'
      );
    }
  }

  // Check ANTHROPIC_MODEL (required)
  if (!process.env.ANTHROPIC_MODEL) {
    errors.push(
      '❌ ANTHROPIC_MODEL environment variable is required\n\n' +
      '  For Anthropic API, use:\n' +
      '    export ANTHROPIC_MODEL=claude-sonnet-4-5-20250929\n\n' +
      '  For AWS Bedrock, use:\n' +
      '    export ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0\n'
    );
  }

  // Check PROJECT_ROOT (required)
  if (!process.env.PROJECT_ROOT) {
    errors.push(
      '❌ PROJECT_ROOT environment variable is required\n\n' +
      '  This should point to the project/starter directory containing .claude/skills/\n' +
      '  Example:\n' +
      '    export PROJECT_ROOT=/voc/work/cd14715-claude-code-classroom/project/starter'
    );
  }

  // If there are validation errors, throw them all at once
  if (errors.length > 0) {
    throw new Error(
      '\n' +
      '================================\n' +
      'ENVIRONMENT CONFIGURATION ERROR\n' +
      '================================\n\n' +
      errors.join('\n\n') +
      '\n\nFor more details, see .env.example'
    );
  }

  // Validate that PROJECT_ROOT exists and has .claude/skills directory
  const projectRoot = process.env.PROJECT_ROOT;
  const skillsPath = path.join(projectRoot, '.claude', 'skills');

  try {
    if (!fs.existsSync(projectRoot)) {
      throw new Error(
        `PROJECT_ROOT does not exist: ${projectRoot}\n` +
        'Please verify the path is correct and accessible.'
      );
    }

    if (!fs.existsSync(skillsPath)) {
      throw new Error(
        `Skills directory not found: ${skillsPath}\n` +
        'Make sure .claude/skills/ exists in your PROJECT_ROOT.'
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('PROJECT_ROOT')) {
      throw error;
    }
    throw new Error(
      `Failed to validate PROJECT_ROOT: ${projectRoot}\n` +
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Build configuration object
  const config: EnvironmentConfig = {
    // Authentication
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL,

    // AWS Bedrock (alternative)
    awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
    awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    awsRegion: process.env.AWS_REGION,

    // Model
    anthropicModel: process.env.ANTHROPIC_MODEL,

    // Project paths
    projectRoot,
    skillsPath,

    // Optional
    githubToken: process.env.GITHUB_TOKEN,
    logLevel: (process.env.LOG_LEVEL || 'info') as 'error' | 'warn' | 'info' | 'debug'
  };

  return config;
}

// Export singleton instance
let cachedConfig: EnvironmentConfig | null = null;

export function getEnvironmentConfig(): EnvironmentConfig {
  if (!cachedConfig) {
    cachedConfig = validateEnvironment();
  }
  return cachedConfig;
}
