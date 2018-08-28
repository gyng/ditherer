export type Environment = "development" | "github" | "production" | "test";
export type EnvironmentEnum = { [k in Environment]: k };
export type getEnvironment = (s: string) => Environment;

export type HistoryType = "browser" | "hash";

export type IUrlConfig = {
  basePath: string;
  publicPath: string;
  historyType: HistoryType;
};

export type IAppConfig = {
  url: IUrlConfig;
};

export type IConfig<T> = { [k in Environment]: T };

// This is the exported configuration so it's named simply
export interface Configuration extends IAppConfig {
  environment: Environment;
}

export const config: Configuration;
