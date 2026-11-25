/**
 * Model Context Protocol (MCP) server configurations
 *
 * Required MCP Servers:
 * 1. GitHub - For PR/repo operations
 * 2. ESLint - For code linting and style analysis
 *
 * Documentation:
 * - MCP Protocol: https://modelcontextprotocol.io
 * - GitHub MCP: https://github.com/github/github-mcp-server
 * - ESLint MCP: https://eslint.org/docs/latest/use/mcp
 */

export const mcpServersConfig = {
  /**
   * GitHub MCP Server
   * Provides tools for GitHub API operations
   *
   * Configuration:
   * - type: 'stdio' - Communicates with server via standard I/O
   * - command: 'npx' - Execute via npm
   * - args: ['-y', '@modelcontextprotocol/server-github'] - Install and run latest version
   * - env: Maps GITHUB_TOKEN to GITHUB_PERSONAL_ACCESS_TOKEN as expected by server
   *
   * Note: GITHUB_TOKEN is optional (recommended for private repos and higher rate limits).
   * The GitHub MCP server expects GITHUB_PERSONAL_ACCESS_TOKEN as the env var name.
   * We map our GITHUB_TOKEN from .env to this expected name.
   */
  github: {
    type: 'stdio' as const,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: {
      GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN || ''
    }
  },

  /**
   * ESLint MCP Server
   * Provides tools for linting and code quality analysis
   *
   * Configuration:
   * - type: 'stdio' - Communicates with server via standard I/O
   * - command: 'npx' - Execute via npm
   * - args: ['-y', '@eslint/mcp@latest'] - Install and run latest ESLint MCP version
   * - env: {} - No special environment variables needed
   */
  eslint: {
    type: 'stdio' as const,
    command: 'npx',
    args: ['-y', '@eslint/mcp@latest'],
    env: {}
  }
};
