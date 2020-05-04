import { IConfiguration } from "@cfg";

export const loadConfig = (url: string): Promise<IConfiguration> =>
  new Promise((resolve, reject) => {
    fetch(url)
      .then((res) => res.json())
      .catch(reject)
      .then((parsedConfig) => {
        resolve(parsedConfig);
      });
  });
