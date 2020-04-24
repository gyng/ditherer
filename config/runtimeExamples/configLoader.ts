import { Configuration } from "./index.d";

export const loadConfig = (url: string): Promise<Configuration> =>
  new Promise((resolve, reject) => {
    fetch(url)
      .then((res) => res.json())
      .catch(reject)
      .then((parsedConfig) => {
        resolve(parsedConfig);
      });
  });
