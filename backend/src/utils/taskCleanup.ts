import { PrismaClient } from '@prisma/client';

/**
 * Checks if a task is "truly orphaned" (has no active or finished dependents pointing to it)
 * and deletes it if it is effectively finished (COMPLETED or CANCELLED).
 * 
 * If the task is deleted, it recursively checks the task's dependencies (parents) 
 * to see if they have now become orphaned logic leaves and deletes them too.
 * 
 * This ensures a "leaf-first" cleanup strategy:
 * 1. A task is deleted only when nothing depends on it.
 * 2. When a task is deleted, its parents might become free to be deleted.
 * 
 * @param prisma - PrismaClient instance
 * @param taskId - ID of the task to check
 */
export async function deleteTaskIfOrphaned(prisma: PrismaClient, taskId: number): Promise<void> {
    try {
        const task = await prisma.task.findUnique({
            where: { id: taskId },
            include: {
                dependents: {
                    include: {
                        task: true
                    }
                },
                dependencies: true
            }
        });

        if (!task) return;
        if (task.isDeleted) return; // Already deleted

        // Check if task is finished
        // We use string comparison to avoid circular import of TaskStatus enum
        const isFinished = task.status === 'COMPLETED' || task.status === 'CANCELLED';

        // "No other tasks depending on it" means all dependents are deleted (or empty).
        const hasNoActiveDependents = task.dependents.every(d => d.task.isDeleted);

        if (isFinished && hasNoActiveDependents) {
            if (task.isNeverDeleted) {
                console.log(`Task ${taskId} is finished and orphaned but marked as never deleted. Skipping.`);
                return;
            }

            console.log(`Task ${taskId} is finished and has no active dependents (leaf node). Soft deleting...`);

            // Capture parent IDs (dependencies) before deleting the task.
            // We task.dependencies is an array of TaskDependency objects where 'dependencyId' is the parent task.
            // (Current task is 'taskId' in TaskDependency table, i.e., the dependent)

            // So 'task.dependencies' list items where THIS task is the consumer.
            // We want to check the PROVIDERS (parents) after we delete ourselves.
            // The providers are in 'task.dependencies'.
            const parentIds = task.dependencies.map(d => d.dependencyId);

            // Soft delete the current task instead of hard delete
            await prisma.task.update({
                where: { id: taskId },
                data: { isDeleted: true }
            });
            console.log(`✅ Soft deleted task ${taskId}`);

            // Recursively check parents
            if (parentIds.length > 0) {
                console.log(`Checking ${parentIds.length} parent tasks for cleanup...`);
                for (const parentId of parentIds) {
                    await deleteTaskIfOrphaned(prisma, parentId);
                }
            }
        }
    } catch (error) {
        console.error(`❌ Error in deleteTaskIfOrphaned for task ${taskId}:`, error);
    }
}
