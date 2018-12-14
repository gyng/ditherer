export type HistoryType = "browser" | "hash";

export interface IUrlConfig {
  url_basePath: string; // React router base path
  url_historyType: HistoryType; // React router history type
}

export interface IBuildConfig {
  url_publicPath: string; // Webpack output.publicPath
}

export interface IExampleConfig {} // tslint:disable-line

/**
 * `IConfig` is the overall configuration for the app and describes the
 * shape of the config file that will be loaded at runtime.
 */
export interface IConfiguration extends IUrlConfig, IExampleConfig {}
