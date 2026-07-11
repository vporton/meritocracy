import type { Prisma, PrismaClient } from '@prisma/client';

export type AiResultKind =
  | 'onboarding'
  | 'worth_assessment'
  | 'prompt_injection'
  | 'prompt_randomization'
  | 'unknown';

export function aiResultKindForRunner(runnerClassName: string): AiResultKind {
  switch (runnerClassName) {
    case 'ScientistOnboardingRunner': return 'onboarding';
    case 'WorthAssessmentRunner': return 'worth_assessment';
    case 'PromptInjectionRunner': return 'prompt_injection';
    case 'RandomizePromptRunner': return 'prompt_randomization';
    default: return 'unknown';
  }
}

/** Extract durable citations without retaining the provider's response body. */
export function extractAiSources(response: any): string[] {
  const sources = new Set<string>();
  for (const item of response?.output ?? []) {
    for (const content of item?.content ?? []) {
      for (const annotation of content?.annotations ?? []) {
        if (annotation?.type === 'url_citation' && typeof annotation.url === 'string') sources.add(annotation.url);
      }
      for (const source of content?.sources ?? []) {
        if (typeof source?.url === 'string') sources.add(source.url);
      }
      if (typeof content?.text === 'string') {
        for (const url of content.text.match(/https?:\/\/[^\s)]+/g) ?? []) sources.add(url);
      }
    }
    for (const source of item?.web_search_call?.action?.sources ?? []) {
      if (typeof source?.url === 'string') sources.add(source.url);
    }
    if (typeof item?.action?.url === 'string') sources.add(item.action.url);
    for (const source of item?.action?.sources ?? []) {
      if (typeof source?.url === 'string') sources.add(source.url);
    }
  }
  return [...sources];
}

/** Convert a provider reply to the application's structured JSON result. */
export function extractAiStructuredResult(response: any): Record<string, unknown> | undefined {
  if (response && typeof response === 'object' &&
    ('why' in response || 'randomizedPrompt' in response)) {
    return response as Record<string, unknown>;
  }
  const messages = Array.isArray(response?.output) ? response.output : [];
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const content = messages[messageIndex]?.content ?? [];
    for (let contentIndex = content.length - 1; contentIndex >= 0; contentIndex--) {
      const text = content[contentIndex]?.text;
      if (typeof text !== 'string') continue;
      try {
        const result = JSON.parse(text);
        if (result && typeof result === 'object' && !Array.isArray(result)) return result;
      } catch {
        // Try an earlier text part; providers may include non-result text too.
      }
    }
  }
  return undefined;
}

export async function storeAiResult(
  prisma: PrismaClient,
  props: {
    customId: string;
    taskId: number;
    resultKind: AiResultKind;
    result?: object;
    sources?: string[];
    errorMessage?: string;
  }
): Promise<void> {
  const succeeded = props.result !== undefined;
  const aiResult = await prisma.aiResult.upsert({
    where: { customId: props.customId },
    create: {
      customId: props.customId,
      taskId: props.taskId,
      resultKind: props.resultKind,
      status: succeeded ? 'SUCCEEDED' : 'FAILED',
      result: props.result as Prisma.InputJsonValue | undefined,
      errorMessage: props.errorMessage ?? null,
      responseReceived: new Date(),
    },
    // Do not overwrite taskId: dependency readers can re-read another task's result.
    update: {
      resultKind: props.resultKind,
      status: succeeded ? 'SUCCEEDED' : 'FAILED',
      result: props.result as Prisma.InputJsonValue | undefined,
      errorMessage: props.errorMessage ?? null,
      responseReceived: new Date(),
    },
  });

  if (succeeded && props.sources) {
    await prisma.aiResultSource.deleteMany({ where: { aiResultId: aiResult.id } });
    if (props.sources.length > 0) {
      await prisma.aiResultSource.createMany({
        data: props.sources.map((url, ordinal) => ({ aiResultId: aiResult.id, ordinal, url })),
      });
    }
  }

  // flexible-batches may need its raw reply while it is delivering an output.
  // Once the validated canonical result is committed, retaining that reply is
  // both redundant and provider-specific, so reclaim it immediately.
  if (succeeded) {
    await Promise.all([
      prisma.batchMapping.updateMany({ where: { customId: props.customId }, data: { response: null } }),
      prisma.nonBatchMapping.updateMany({ where: { customId: props.customId }, data: { response: null } }),
      prisma.openAILog.updateMany({ where: { customId: props.customId }, data: { responseData: null } }),
    ]);
  }
}

export async function getStoredAiResult(prisma: PrismaClient, customId: string): Promise<Record<string, unknown> | undefined> {
  const result = await prisma.aiResult.findUnique({ where: { customId }, select: { result: true, status: true } });
  return result?.status === 'SUCCEEDED' && result.result && typeof result.result === 'object'
    ? result.result as Record<string, unknown>
    : undefined;
}
