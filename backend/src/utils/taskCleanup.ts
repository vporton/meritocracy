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
                dependents: true,
                dependencies: true
            }
        });

        if (!task) return;

        // Check if task is finished
        // We use string comparison to avoid circular import of TaskStatus enum
        const isFinished = task.status === 'COMPLETED' || task.status === 'CANCELLED';

        // "No other tasks depending on it" means dependents array is empty.
        const hasNoDependents = task.dependents.length === 0;

        if (isFinished && hasNoDependents) {
            console.log(`Task ${taskId} is finished and has no dependents (leaf node). Deleting...`);

            // Capture parent IDs (dependencies) before deleting the task.
            // We task.dependencies is an array of TaskDependency objects where 'dependencyId' is the parent task.
            // (Current task is 'taskId' in TaskDependency table, i.e., the dependent)
            // Wait, let's verify schema intuition.
            // If Task A depends on Task B.
            // Dependency Record: taskId: A, dependencyId: B.
            // In Task A object: 'dependencies' points to records where taskId = A.
            // In Task B object: 'dependents' points to records where dependencyId = B.

            // So 'task.dependencies' list items where THIS task is the consumer.
            // We want to check the PROVIDERS (parents) after we delete ourselves.
            // The providers are in 'task.dependencies'.
            const parentIds = task.dependencies.map(d => d.dependencyId);

            // Delete the current task
            await prisma.task.delete({
                where: { id: taskId }
            });
            console.log(`✅ Deleted task ${taskId}`);

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
