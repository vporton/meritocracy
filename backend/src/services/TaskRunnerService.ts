// This service is disabled because it uses non-existent taskRunner model
// The current schema uses embedded runner data instead of separate models
//
// The original implementation tried to use a separate TaskRunner model
// that doesn't exist in the current Prisma schema. The current schema
// uses embedded runner data (JSON string) directly in the Task model.

export class TaskRunnerService {
  // This class is disabled - use embedded runner data in Task model instead
}