import { IConfig } from "@cfg/index.d";

export const loadConfig = (url: string): Promise<IConfig<any>> =>
  new Promise((resolve, reject) => {
    fetch(url)
      .then(res => res.json())
      .then(parsedConfig => {
        resolve(parsedConfig);
      })
      .catch(reject);
  });
