import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { getEnvironmentConfig } from './config/env';
import { CodeReviewOrchestrator } from './orchestrator';
import { ReportGenerator } from './utils/report-generator';
import { logger, logReviewStart, logReviewComplete, logReviewError } from './utils/logger';

// Load environment variables
dotenv.config();

/**
 * Main entry point for the Claude Multi-Agent Code Review System
 * Usage: npm run dev <owner> <repo> <pr-number>
 */
async function main() {
  const [owner, repo, prStr] = process.argv.slice(2);

  try {
    // Validate environment configuration
    const config = getEnvironmentConfig();

    // Validate command line arguments
    if (!owner || !repo || !prStr) {
      console.error('❌ Error: Missing required arguments');
      console.error('Usage: npm run dev <owner> <repo> <pr-number>');
      console.error('Example: npm run dev facebook react 12345');
      process.exit(1);
    }

    // Convert and validate PR number
    const prNumber = parseInt(prStr, 10);
    if (isNaN(prNumber) || prNumber <= 0) {
      console.error(`❌ Error: PR number must be a valid positive integer, got "${prStr}"`);
      process.exit(1);
    }

    // Log which authentication method is being used
    if (config.awsAccessKeyId) {
      console.log('🔐 Using AWS Bedrock authentication');
    } else {
      console.log('🔐 Using Anthropic API authentication');
    }

    console.log(`📋 Analyzing PR: ${owner}/${repo}#${prNumber}`);
    console.log(`🤖 Using model: ${config.anthropicModel}`);

    // Log review start
    logReviewStart(owner, repo, prNumber);

    // Create orchestrator instance
    const orchestrator = new CodeReviewOrchestrator({
      timeoutMs: 300000, // 5 minutes
      maxRetries: 3
    });

    // Run the review
    const startTime = Date.now();
    const report = await orchestrator.reviewPullRequest(owner, repo, prNumber);
    const duration = Date.now() - startTime;

    // Generate formatted reports
    const reportGenerator = new ReportGenerator();
    const markdownReport = reportGenerator.generateMarkdownReport(report);
    const htmlReport = reportGenerator.generateHTMLReport(report);
    const jsonReport = reportGenerator.generateJSONReport(report);

    // Create reports directory if it doesn't exist
    const reportsDir = path.join(process.cwd(), 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    // Save reports with appropriate filenames
    const baseFilename = `${owner}-${repo}-${prNumber}`;
    const mdPath = path.join(reportsDir, `${baseFilename}.md`);
    const htmlPath = path.join(reportsDir, `${baseFilename}.html`);
    const jsonPath = path.join(reportsDir, `${baseFilename}.json`);

    fs.writeFileSync(mdPath, markdownReport);
    fs.writeFileSync(htmlPath, htmlReport);
    fs.writeFileSync(jsonPath, jsonReport);

    console.log('');
    console.log('✅ Code review completed successfully!');
    console.log('');
    console.log('📄 Generated reports:');
    console.log(`  - ${mdPath}`);
    console.log(`  - ${htmlPath}`);
    console.log(`  - ${jsonPath}`);
    console.log('');
    console.log(`📊 Overall Score: ${report.summary.overallScore}/100`);
    console.log(`⏱️  Duration: ${duration}ms`);

    // Log review complete
    logReviewComplete(owner, repo, prNumber, report.summary.overallScore, duration);
  } catch (error) {
    // Log the error
    if (error instanceof Error) {
      logReviewError(
        process.argv[2] || 'unknown',
        process.argv[3] || 'unknown',
        parseInt(process.argv[4] || '0', 10),
        error
      );
      console.error('❌ Error:', error.message);
      if (process.env.DEBUG) {
        console.error(error.stack);
      }
    } else {
      console.error('❌ Error:', error);
    }
    process.exit(1);
  }
}

main();
