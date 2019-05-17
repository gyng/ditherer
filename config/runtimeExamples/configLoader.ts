// tslint:disable

import { IConfiguration } from "./index.d";

export const loadConfig = (url: string): Promise<IConfiguration> =>
  new Promise((resolve, reject) => {
    fetch(url)
      .then(res => res.json())
      .catch(reject)
      .then(parsedConfig => {
        resolve(parsedConfig);
      });
  });
