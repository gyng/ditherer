// This generates a config JSON, mostly for development work. Using it from the
// CLI will read config values from `configValues.js`.
//
// Usage:
//   node generateJson.js (prints to stdout)
//   node generateJson.js path/to/config.js
//   node generateJson.js path/to/config.js wx (wx = write flags)
//
//   As an import:
//     const { generate } = require("generateJson");

const generate = (config) => JSON.stringify(config, null, 2);

if (require.main === module) {
  const configFile = process.env.CONFIG_FILE || "./configValues";
  const { appConfig } = require(configFile);

  const path = process.argv[2];
  const flag = process.argv[3] || "wx";
  const json = generate(appConfig);

  if (path) {
    const fs = require("fs");
    fs.writeFile(path, json, { flag }, (err) => {
      if (err) {
        console.error(err);
      }
    });
  } else {
    console.log(json);
  }
}

module.exports = {
  generate,
};
