/**
 * Utility to retry an asynchronous function if it fails with a rate limit error (429).
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options: {
        maxRetries?: number;
        baseDelay?: number;
        taskName?: string;
    } = {}
): Promise<T> {
    const { maxRetries = 5, baseDelay = 2000, taskName = 'Task' } = options;
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;
            const errorMessage = error instanceof Error ? error.message : String(error);
            // Some providers return status in different places
            const status = error.status || error.statusCode || (error.response?.status);

            const isRateLimit =
                status === 429 ||
                status === 502 ||
                status === 503;

            if (isRateLimit && attempt < maxRetries) {
                const delay = baseDelay * Math.pow(2, attempt - 1);
                console.warn(`⚠️ [${taskName}] Rate limited (429). Retrying in ${delay}ms (Attempt ${attempt}/${maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            throw error;
        }
    }
    throw lastError;
}
