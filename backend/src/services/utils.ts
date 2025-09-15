/**
 * Utility functions shared across the application
 */

/**
 * Check if a configuration value should be considered as "true"
 * @param value - The configuration value to check
 * @returns true if the value represents a truthy configuration, false otherwise
 */
export function isConfigValueTrue(value: string | undefined): boolean {
  return value !== undefined && value !== null && value.toLowerCase() !== 'false' && value !== '0' && value.toLowerCase() !== 'no' && value !== '0';
}
