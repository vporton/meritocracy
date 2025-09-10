import { TaskRunner, TaskRunnerData, TaskRunnerRegistry } from '../types/task.js';
import { PrismaClient } from '@prisma/client';

/**
 * Example Email Runner - Sends emails
 */
export class EmailRunner implements TaskRunner {
  private data: TaskRunnerData;

  constructor(data: TaskRunnerData) {
    this.data = data;
  }

  async run(taskId: number): Promise<void> {
    console.log(`📧 EmailRunner: Sending email to ${this.data.to}`);
    console.log(`   Subject: ${this.data.subject}`);
    console.log(`   Body: ${this.data.body}`);
    
    // Simulate email sending
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log(`✅ Email sent successfully for task ${taskId}`);
  }
}

/**
 * Example File Processor Runner - Processes files
 */
export class FileProcessorRunner implements TaskRunner {
  private data: TaskRunnerData;

  constructor(data: TaskRunnerData) {
    this.data = data;
  }

  async run(taskId: number): Promise<void> {
    console.log(`📁 FileProcessorRunner: Processing file ${this.data.filePath}`);
    console.log(`   Operation: ${this.data.operation}`);
    
    // Simulate file processing
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    console.log(`✅ File processed successfully for task ${taskId}`);
  }
}

/**
 * Example API Call Runner - Makes HTTP requests
 */
export class ApiCallRunner implements TaskRunner {
  private data: TaskRunnerData;

  constructor(data: TaskRunnerData) {
    this.data = data;
  }

  async run(taskId: number): Promise<void> {
    console.log(`🌐 ApiCallRunner: Making ${this.data.method} request to ${this.data.url}`);
    console.log(`   Payload:`, this.data.payload);
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log(`✅ API call completed successfully for task ${taskId}`);
  }
}

/**
 * Example Database Runner - Performs database operations
 */
export class DatabaseRunner implements TaskRunner {
  private data: TaskRunnerData;

  constructor(data: TaskRunnerData) {
    this.data = data;
  }

  async run(taskId: number): Promise<void> {
    console.log(`🗄️  DatabaseRunner: Performing ${this.data.operation} operation`);
    console.log(`   Table: ${this.data.table}`);
    console.log(`   Query: ${this.data.query}`);
    
    // Simulate database operation
    await new Promise(resolve => setTimeout(resolve, 1200));
    
    console.log(`✅ Database operation completed successfully for task ${taskId}`);
  }
}

/**
 * Example Data Processing Runner - Processes data
 */
export class DataProcessingRunner implements TaskRunner {
  private data: TaskRunnerData;

  constructor(data: TaskRunnerData) {
    this.data = data;
  }

  async run(taskId: number): Promise<void> {
    console.log(`📊 DataProcessingRunner: Processing data`);
    console.log(`   Dataset: ${this.data.dataset}`);
    console.log(`   Algorithm: ${this.data.algorithm}`);
    
    // Simulate data processing
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log(`✅ Data processing completed successfully for task ${taskId}`);
  }
}

/**
 * Example Notification Runner - Sends notifications
 */
export class NotificationRunner implements TaskRunner {
  private data: TaskRunnerData;

  constructor(data: TaskRunnerData) {
    this.data = data;
  }

  async run(taskId: number): Promise<void> {
    console.log(`🔔 NotificationRunner: Sending notification`);
    console.log(`   Type: ${this.data.type}`);
    console.log(`   Recipient: ${this.data.recipient}`);
    console.log(`   Message: ${this.data.message}`);
    
    // Simulate notification sending
    await new Promise(resolve => setTimeout(resolve, 800));
    
    console.log(`✅ Notification sent successfully for task ${taskId}`);
  }
}

/**
 * Register all example TaskRunners in the TaskRunnerRegistry
 * This function should be called before using any example runners
 */
export function registerExampleRunners(): void {
  console.log('📝 Registering example TaskRunners...');
  
  TaskRunnerRegistry.register('EmailRunner', EmailRunner);
  TaskRunnerRegistry.register('FileProcessorRunner', FileProcessorRunner);
  TaskRunnerRegistry.register('ApiCallRunner', ApiCallRunner);
  TaskRunnerRegistry.register('DatabaseRunner', DatabaseRunner);
  TaskRunnerRegistry.register('DataProcessingRunner', DataProcessingRunner);
  TaskRunnerRegistry.register('NotificationRunner', NotificationRunner);
  
  console.log('✅ Example TaskRunners registered successfully');
}

/**
 * Get list of available example runner class names
 */
export function getExampleRunnerClassNames(): string[] {
  return [
    'EmailRunner',
    'FileProcessorRunner',
    'ApiCallRunner',
    'DatabaseRunner',
    'DataProcessingRunner',
    'NotificationRunner'
  ];
}

/**
 * Get example runner data templates
 */
export function getExampleRunnerDataTemplates(): Record<string, TaskRunnerData> {
  return {
    EmailRunner: {
      to: 'user@example.com',
      subject: 'Welcome to our service!',
      body: 'Thank you for signing up. We are excited to have you on board!'
    },
    FileProcessorRunner: {
      filePath: '/uploads/document.pdf',
      operation: 'compress'
    },
    ApiCallRunner: {
      url: 'https://api.example.com/webhook',
      method: 'POST',
      payload: { event: 'task_completed', taskId: 1 }
    },
    DatabaseRunner: {
      operation: 'backup',
      table: 'users',
      query: 'SELECT * FROM users WHERE created_at > NOW() - INTERVAL 1 DAY'
    },
    DataProcessingRunner: {
      dataset: 'user_analytics',
      algorithm: 'clustering',
      parameters: { clusters: 5, iterations: 100 }
    },
    NotificationRunner: {
      type: 'email',
      recipient: 'admin@example.com',
      message: 'Task processing completed successfully'
    }
  };
}
