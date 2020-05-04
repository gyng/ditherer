export type HistoryType = "browser" | "hash";

export interface UrlConfig {
  url_basePath: string; // React router base path
  url_historyType: HistoryType; // React router history type
}

export interface BuildConfig {
  url_publicPath: string; // Webpack output.publicPath
  url_configPath: string; // Where to load config.json at runtime
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface ExampleConfig {}

/**
 * `IConfig` is the overall configuration for the app and describes the
 * shape of the config file that will be loaded at runtime.
 */
export interface Configuration extends UrlConfig, ExampleConfig {}
