export type Environment = "development" | "github" | "production" | "test";
export type EnvironmentEnum = { [k in Environment]: k };
export type getEnvironment = (s: string) => Environment;

export type HistoryType = "browser" | "hash";

export interface UrlConfig {
  basePath: string;
  publicPath: string;
  historyType: HistoryType;
}

export interface AppConfig {
  url: UrlConfig;
}

/**
 * `FullConfiguration describes the complete configuration for *all* environments.
 */
export type FullConfiguration<T> = { [k in Environment]: T };

/**
 * `Configuration is the per-environment configuration for the app, and is augmented
 * to contain the current environment.
 * It describes the actual app configuration and is not aware of other environments.
 */
export interface Configuration extends AppConfig {
  environment: Environment;
}

export const config: Configuration;
