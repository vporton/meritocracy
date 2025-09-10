import { TaskRunner, TaskRunnerData, TaskRunnerRegistry } from '../types/task';

// Example TaskRunner implementation for sending emails
export class EmailRunner implements TaskRunner {
  private data: TaskRunnerData;

  constructor(data: TaskRunnerData) {
    this.data = data;
  }

  async run(): Promise<void> {
    console.log(`📧 Sending email to: ${this.data.to}`);
    console.log(`📧 Subject: ${this.data.subject}`);
    console.log(`📧 Body: ${this.data.body}`);
    
    // Simulate email sending
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log(`✅ Email sent successfully to ${this.data.to}`);
  }
}

// Example TaskRunner implementation for processing files
export class FileProcessorRunner implements TaskRunner {
  private data: TaskRunnerData;

  constructor(data: TaskRunnerData) {
    this.data = data;
  }

  async run(): Promise<void> {
    console.log(`📁 Processing file: ${this.data.filePath}`);
    console.log(`📁 Operation: ${this.data.operation}`);
    
    // Simulate file processing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log(`✅ File ${this.data.filePath} processed successfully`);
  }
}

// Example TaskRunner implementation for API calls
export class ApiCallRunner implements TaskRunner {
  private data: TaskRunnerData;

  constructor(data: TaskRunnerData) {
    this.data = data;
  }

  async run(): Promise<void> {
    console.log(`🌐 Making API call to: ${this.data.url}`);
    console.log(`🌐 Method: ${this.data.method}`);
    console.log(`🌐 Data: ${JSON.stringify(this.data.payload)}`);
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    console.log(`✅ API call to ${this.data.url} completed successfully`);
  }
}

// Example TaskRunner implementation for database operations
export class DatabaseRunner implements TaskRunner {
  private data: TaskRunnerData;

  constructor(data: TaskRunnerData) {
    this.data = data;
  }

  async run(): Promise<void> {
    console.log(`🗄️ Executing database operation: ${this.data.operation}`);
    console.log(`🗄️ Table: ${this.data.table}`);
    console.log(`🗄️ Query: ${this.data.query}`);
    
    // Simulate database operation
    await new Promise(resolve => setTimeout(resolve, 800));
    
    console.log(`✅ Database operation completed successfully`);
  }
}

// Register all example runners
export function registerExampleRunners(): void {
  TaskRunnerRegistry.register('EmailRunner', EmailRunner);
  TaskRunnerRegistry.register('FileProcessorRunner', FileProcessorRunner);
  TaskRunnerRegistry.register('ApiCallRunner', ApiCallRunner);
  TaskRunnerRegistry.register('DatabaseRunner', DatabaseRunner);
}
