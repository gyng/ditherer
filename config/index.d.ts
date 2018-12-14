export type Environment = "development" | "github" | "production" | "test";
export type EnvironmentEnum = { [k in Environment]: k };
export type getEnvironment = (s: string) => Environment;

export type HistoryType = "browser" | "hash";

export interface IUrlConfig {
  basePath: string;
  publicPath: string;
  historyType: HistoryType;
}

export interface IAppConfig {
  url: IUrlConfig;
}

/**
 * `IFullConfiguration describes the complete configuration for *all* environments.
 */
export type IFullConfiguration<T> = { [k in Environment]: T };

/**
 * `IConfiguration is the per-environment configuration for the app, and is augmented
 * to contain the current environment.
 * It describes the actual app configuration and is not aware of other environments.
 */
export interface IConfiguration extends IAppConfig {
  environment: Environment;
}

export const config: IConfiguration;
