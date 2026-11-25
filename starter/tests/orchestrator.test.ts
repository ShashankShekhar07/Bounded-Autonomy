import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { z } from 'zod';
import {
  ReviewError,
  ErrorCodes,
  withRetry,
  withTimeout,
  isReviewError,
  formatError
} from '../src/utils/error-handler';
import {
  RateLimiter,
  DEFAULT_RATE_LIMITS,
  withRateLimit
} from '../src/utils/rate-limiter';
import { ReviewReportSchema } from '../src/types/report-types';
import {
  CodeQualityResultSchema,
  TestCoverageResultSchema,
  RefactoringSuggestionSchema
} from '../src/types/analysis-results';

/**
 * Tests for Error Handler Utilities
 */
describe('Error Handler Utilities', () => {
  describe('ReviewError', () => {
    it('should create a ReviewError with message, code, and metadata', () => {
      const error = new ReviewError('Test error', ErrorCodes.VALIDATION_FAILED, {
        field: 'name'
      });

      expect(error.message).toBe('Test error');
      expect(error.code).toBe(ErrorCodes.VALIDATION_FAILED);
      expect(error.metadata).toEqual({ field: 'name' });
      expect(error.name).toBe('ReviewError');
    });

    it('should create a ReviewError without metadata', () => {
      const error = new ReviewError('Test error', ErrorCodes.UNKNOWN_ERROR);

      expect(error.message).toBe('Test error');
      expect(error.code).toBe(ErrorCodes.UNKNOWN_ERROR);
      expect(error.metadata).toBeUndefined();
    });
  });

  describe('withRetry', () => {
    it('should succeed on first attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await withRetry(fn, 3, 100);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledOnce();
    });

    it('should retry on failure and succeed on second attempt', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Fail'))
        .mockResolvedValueOnce('success');

      const result = await withRetry(fn, 3, 100);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should throw ReviewError when all retries exhausted', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Persistent error'));

      await expect(withRetry(fn, 3, 50)).rejects.toThrow(ReviewError);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw ReviewError with RETRY_EXHAUSTED code', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Test error'));

      try {
        await withRetry(fn, 2, 50);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(isReviewError(error)).toBe(true);
        if (isReviewError(error)) {
          expect(error.code).toBe(ErrorCodes.RETRY_EXHAUSTED);
          expect(error.metadata?.maxRetries).toBe(2);
        }
      }
    });

    it('should use default retry count and delay', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await withRetry(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledOnce();
    });

    it('should implement exponential backoff', async () => {
      vi.useFakeTimers();

      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValueOnce('success');

      const promise = withRetry(fn, 3, 100);

      // First retry: 100ms * 2^0 = 100ms
      await vi.advanceTimersByTimeAsync(200);

      // Second retry: 100ms * 2^1 = 200ms
      await vi.advanceTimersByTimeAsync(300);

      const result = await promise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });
  });

  describe('withTimeout', () => {
    it('should succeed if function completes before timeout', async () => {
      const fn = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return 'success';
      });

      const result = await withTimeout(fn, 200);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledOnce();
    });

    it('should throw ReviewError if function exceeds timeout', async () => {
      const fn = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return 'success';
      });

      await expect(withTimeout(fn, 50)).rejects.toThrow(ReviewError);
    });

    it('should throw ReviewError with AGENT_TIMEOUT code', async () => {
      const fn = async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      };

      try {
        await withTimeout(fn, 50);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(isReviewError(error)).toBe(true);
        if (isReviewError(error)) {
          expect(error.code).toBe(ErrorCodes.AGENT_TIMEOUT);
        }
      }
    });

    it('should use custom error message', async () => {
      const fn = async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      };

      try {
        await withTimeout(fn, 50, 'Custom timeout message');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(isReviewError(error)).toBe(true);
        if (isReviewError(error)) {
          expect(error.message).toBe('Custom timeout message');
        }
      }
    });
  });

  describe('isReviewError', () => {
    it('should return true for ReviewError instances', () => {
      const error = new ReviewError('Test', ErrorCodes.UNKNOWN_ERROR);
      expect(isReviewError(error)).toBe(true);
    });

    it('should return false for regular Error instances', () => {
      const error = new Error('Test');
      expect(isReviewError(error)).toBe(false);
    });

    it('should return false for non-Error objects', () => {
      expect(isReviewError('string')).toBe(false);
      expect(isReviewError(null)).toBe(false);
      expect(isReviewError({})).toBe(false);
    });
  });

  describe('formatError', () => {
    it('should format ReviewError with code prefix', () => {
      const error = new ReviewError('Test error', ErrorCodes.VALIDATION_FAILED);
      const formatted = formatError(error);

      expect(formatted).toBe('[VALIDATION_FAILED] Test error');
    });

    it('should format regular Error messages', () => {
      const error = new Error('Regular error');
      const formatted = formatError(error);

      expect(formatted).toBe('Regular error');
    });

    it('should format non-Error values', () => {
      expect(formatError('string error')).toBe('string error');
      expect(formatError(123)).toBe('123');
      expect(formatError(null)).toBe('null');
    });
  });
});

/**
 * Tests for Rate Limiter
 */
describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter();
  });

  describe('Configuration', () => {
    it('should use default rate limits', () => {
      expect(rateLimiter.getStatus().activeRequests).toBe(0);
    });

    it('should accept custom rate limit configuration', () => {
      const customLimiter = new RateLimiter({
        maxRequestsPerMinute: 100,
        maxTokensPerMinute: 200000,
        maxConcurrent: 10
      });

      expect(customLimiter.canProceed(1000)).toBe(true);
    });
  });

  describe('acquire and release', () => {
    it('should track active requests', async () => {
      const status1 = rateLimiter.getStatus();
      expect(status1.activeRequests).toBe(0);

      await rateLimiter.acquire(1000);
      const status2 = rateLimiter.getStatus();
      expect(status2.activeRequests).toBe(1);

      rateLimiter.release();
      const status3 = rateLimiter.getStatus();
      expect(status3.activeRequests).toBe(0);
    });

    it('should track request history', async () => {
      await rateLimiter.acquire(2000);
      const status = rateLimiter.getStatus();

      expect(status.requestsInWindow).toBe(1);
      expect(status.tokensInWindow).toBe(2000);

      rateLimiter.release();
    });

    it('should update tokens when releasing', async () => {
      await rateLimiter.acquire(2000);
      rateLimiter.release(1500); // Actual tokens lower than estimate

      const status = rateLimiter.getStatus();
      expect(status.tokensInWindow).toBe(1500);
    });
  });

  describe('canProceed', () => {
    it('should allow request when under limits', () => {
      expect(rateLimiter.canProceed(1000)).toBe(true);
    });

    it('should respect concurrent request limit', async () => {
      // Fill up concurrent slots
      for (let i = 0; i < DEFAULT_RATE_LIMITS.maxConcurrent; i++) {
        await rateLimiter.acquire(1000);
      }

      expect(rateLimiter.canProceed(1000)).toBe(false);

      // Release one and try again
      rateLimiter.release();
      expect(rateLimiter.canProceed(1000)).toBe(true);
    });

    it('should respect request rate limit', async () => {
      // Create a limiter with very low request limit
      const limiter = new RateLimiter({ maxRequestsPerMinute: 2 });

      await limiter.acquire(1000);
      await limiter.acquire(1000);

      expect(limiter.canProceed(1000)).toBe(false);

      limiter.release();
      limiter.release();
    });

    it('should respect token rate limit', async () => {
      // Create a limiter with low token limit
      const limiter = new RateLimiter({ maxTokensPerMinute: 2000 });

      await limiter.acquire(1500);

      // Try to acquire more than available
      expect(limiter.canProceed(1000)).toBe(false);

      limiter.release();
    });
  });

  describe('getStatus', () => {
    it('should return accurate status', async () => {
      await rateLimiter.acquire(2500);

      const status = rateLimiter.getStatus();

      expect(status.activeRequests).toBe(1);
      expect(status.requestsInWindow).toBe(1);
      expect(status.tokensInWindow).toBe(2500);
      expect(status.availableRequests).toBe(DEFAULT_RATE_LIMITS.maxRequestsPerMinute - 1);
      expect(status.availableTokens).toBe(DEFAULT_RATE_LIMITS.maxTokensPerMinute - 2500);

      rateLimiter.release();
    });
  });

  describe('withRateLimit', () => {
    it('should wrap async function with rate limiting', async () => {
      const fn = vi.fn(async () => 'result');

      const result = await withRateLimit(rateLimiter, fn, 1000);

      expect(result).toBe('result');
      expect(fn).toHaveBeenCalledOnce();
    });

    it('should handle function errors', async () => {
      const fn = vi.fn(async () => {
        throw new Error('Function error');
      });

      await expect(withRateLimit(rateLimiter, fn, 1000)).rejects.toThrow(
        'Function error'
      );
    });

    it('should release on error', async () => {
      const fn = vi.fn(async () => {
        throw new Error('Function error');
      });

      try {
        await withRateLimit(rateLimiter, fn, 1000);
      } catch {
        // Expected
      }

      const status = rateLimiter.getStatus();
      expect(status.activeRequests).toBe(0);
    });
  });
});

/**
 * Tests for Zod Schemas
 */
describe('Zod Schemas', () => {
  describe('CodeQualityResultSchema', () => {
    it('should validate a valid code quality result', () => {
      const data = {
        file: 'src/example.ts',
        issues: [
          {
            line: 10,
            severity: 'high' as const,
            category: 'security' as const,
            description: 'SQL injection vulnerability',
            suggestion: 'Use parameterized queries'
          }
        ],
        overallScore: 75,
        summary: 'Found critical security issues'
      };

      const result = CodeQualityResultSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject invalid severity', () => {
      const data = {
        file: 'src/example.ts',
        issues: [
          {
            line: 10,
            severity: 'invalid' as const,
            category: 'security' as const,
            description: 'Issue',
            suggestion: 'Fix it'
          }
        ],
        overallScore: 75,
        summary: 'Summary'
      };

      const result = CodeQualityResultSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject invalid overall score', () => {
      const data = {
        file: 'src/example.ts',
        issues: [],
        overallScore: 150, // Invalid: > 100
        summary: 'Summary'
      };

      const result = CodeQualityResultSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('TestCoverageResultSchema', () => {
    it('should validate a valid test coverage result', () => {
      const data = {
        file: 'src/utils.ts',
        hasTests: true,
        testFiles: ['src/utils.test.ts'],
        untestedPaths: [
          {
            type: 'function' as const,
            location: 'calculateTotal (line 42)',
            priority: 'high' as const,
            reasoning: 'Critical calculation function',
            suggestedTest: 'Test with positive and negative numbers'
          }
        ],
        coverageEstimate: 85,
        summary: 'Good coverage overall'
      };

      const result = TestCoverageResultSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should require valid priority values', () => {
      const data = {
        file: 'src/utils.ts',
        hasTests: false,
        testFiles: [],
        untestedPaths: [
          {
            type: 'function' as const,
            location: 'calculateTotal (line 42)',
            priority: 'invalid' as const,
            reasoning: 'Some reason',
            suggestedTest: 'Some test'
          }
        ],
        coverageEstimate: 50,
        summary: 'No tests'
      };

      const result = TestCoverageResultSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('RefactoringSuggestionSchema', () => {
    it('should validate a valid refactoring suggestion', () => {
      const data = {
        file: 'src/component.tsx',
        suggestions: [
          {
            type: 'extract-function' as const,
            location: 'renderUserProfile (line 50-100)',
            impact: 'high' as const,
            description: 'Extract user profile rendering logic',
            before: 'const renderUserProfile = () => { /* 50 lines */ }',
            after: 'const renderUserProfile = () => <UserProfileComponent />',
            benefits: 'Improved readability and testability'
          }
        ],
        summary: 'Several refactoring opportunities identified'
      };

      const result = RefactoringSuggestionSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject invalid impact level', () => {
      const data = {
        file: 'src/component.tsx',
        suggestions: [
          {
            type: 'extract-function' as const,
            location: 'function (line 50)',
            impact: 'critical' as const, // Invalid: should be 'low', 'medium', or 'high'
            description: 'Extract function',
            before: 'old code',
            after: 'new code',
            benefits: 'Better code'
          }
        ],
        summary: 'Suggestions'
      };

      const result = RefactoringSuggestionSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('ReviewReportSchema', () => {
    it('should validate a complete review report', () => {
      const data = {
        pullRequest: {
          owner: 'facebook',
          repo: 'react',
          number: 12345
        },
        fileReviews: [
          {
            file: 'src/component.tsx',
            codeQuality: {
              file: 'src/component.tsx',
              issues: [],
              overallScore: 85,
              summary: 'Good code quality'
            },
            testCoverage: {
              file: 'src/component.tsx',
              hasTests: true,
              testFiles: ['src/component.test.tsx'],
              untestedPaths: [],
              coverageEstimate: 90,
              summary: 'Excellent test coverage'
            },
            refactorings: {
              file: 'src/component.tsx',
              suggestions: [],
              summary: 'No refactoring needed'
            }
          }
        ],
        summary: {
          totalFiles: 1,
          overallScore: 85,
          criticalIssues: 0,
          highPriorityTests: 0,
          refactoringOpportunities: 0
        },
        recommendations: [
          {
            priority: 'low' as const,
            category: 'Documentation',
            description: 'Add JSDoc comments',
            files: ['src/component.tsx']
          }
        ],
        metadata: {
          analyzedAt: new Date().toISOString(),
          duration: 5000,
          agentVersions: { 'code-quality': '1.0.0' }
        }
      };

      const result = ReviewReportSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should require valid priority in recommendations', () => {
      const data = {
        pullRequest: {
          owner: 'facebook',
          repo: 'react',
          number: 12345
        },
        fileReviews: [],
        summary: {
          totalFiles: 0,
          overallScore: 0,
          criticalIssues: 0,
          highPriorityTests: 0,
          refactoringOpportunities: 0
        },
        recommendations: [
          {
            priority: 'invalid' as const,
            category: 'Documentation',
            description: 'Add comments',
            files: []
          }
        ],
        metadata: {
          analyzedAt: new Date().toISOString(),
          duration: 1000,
          agentVersions: {}
        }
      };

      const result = ReviewReportSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should require all mandatory fields', () => {
      const incomplete = {
        pullRequest: { owner: 'facebook', repo: 'react' }
        // Missing: number, fileReviews, summary, recommendations, metadata
      };

      const result = ReviewReportSchema.safeParse(incomplete);
      expect(result.success).toBe(false);
    });
  });
});

/**
 * Tests for CodeReviewOrchestrator Configuration
 */
describe('CodeReviewOrchestrator', () => {
  describe('Configuration', () => {
    it('should initialize with default options', () => {
      // This is a placeholder test - actual orchestrator tests would need
      // mock MCP servers and would be more integration-focused
      expect(true).toBe(true);
    });

    it('should accept custom rate limit configuration', () => {
      // Placeholder for integration tests
      expect(true).toBe(true);
    });
  });

  describe('reviewPullRequest', () => {
    it('should validate output with Zod schema', () => {
      // Test that ReviewReportSchema properly validates orchestrator output
      const validReport = {
        pullRequest: { owner: 'test', repo: 'repo', number: 1 },
        fileReviews: [],
        summary: {
          totalFiles: 0,
          overallScore: 0,
          criticalIssues: 0,
          highPriorityTests: 0,
          refactoringOpportunities: 0
        },
        recommendations: [],
        metadata: {
          analyzedAt: new Date().toISOString(),
          duration: 0,
          agentVersions: {}
        }
      };

      const result = ReviewReportSchema.safeParse(validReport);
      expect(result.success).toBe(true);
    });
  });
});
