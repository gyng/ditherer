export type Environment = 'development' | 'github' | 'production';
export type EnvironmentEnum = {[k in Environment]: k};
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

export type IConfig<T> = {[k in Environment]: T};

export interface ExportedConfiguration extends IAppConfig {
  environment: Environment;
}

export const __WEBPACK_DEFINE_APP_ENV__: string;

export const config: ExportedConfiguration;
